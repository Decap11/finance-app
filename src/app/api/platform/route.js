import { createClient } from '@supabase/supabase-js';
import { PLAN_IDS } from '../../../utils/subscriptionPlans';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// A subscription in one of these states is paid up; a billing hold is not justified.
const GOOD_STANDING = ['trial', 'active'];
const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'expired', 'cancelled'];
// The plan catalogue, not a second copy of it. These ids are what
// saccos_subscription_plan_check allows (migration 0036), so a plan the app does not sell
// is rejected here rather than by the database.
const SUBSCRIPTION_PLANS = PLAN_IDS;

// saccos.status_reason is shown verbatim to the tenant admin in the payment reminder, so
// the default message written on a hold is phrased for them, not for the operator.
const SUBSCRIPTION_LABELS = {
  trial: 'on trial',
  active: 'paid up',
  past_due: 'past due',
  expired: 'expired',
  cancelled: 'cancelled'
};

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
}

function getAllowedEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function authorizePlatformAdmin(request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return { error: 'No authorization token provided.', status: 401 };
  }

  const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authErr } = await jwtClient.auth.getUser();
  if (authErr || !user) {
    return { error: authErr?.message || 'Authentication failed.', status: 401 };
  }

  const allowedEmails = getAllowedEmails();
  const callerEmail = (user.email || '').trim().toLowerCase();

  // Strict security check: Caller email MUST be explicitly listed in PLATFORM_ADMIN_EMAILS
  if (!callerEmail || allowedEmails.length === 0 || !allowedEmails.includes(callerEmail)) {
    return { error: `Access Denied: '${callerEmail}' is not listed in PLATFORM_ADMIN_EMAILS (.env).`, status: 403 };
  }

  return { user, email: callerEmail };
}

// A subscription that ran past its expiry date is treated as past_due even if nobody has
// got round to flipping the stored status yet. This is what "hold based on subscription
// status" keys off, both here and in the portal UI.
function subscriptionSnapshot(sacco) {
  const stored = sacco?.subscription_status || 'trial';
  const expiresAt = sacco?.subscription_expires_at ? new Date(sacco.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;

  const effective = isExpired && GOOD_STANDING.includes(stored) ? 'past_due' : stored;
  const daysOverdue = isExpired && expiresAt
    ? Math.floor((Date.now() - expiresAt.getTime()) / 86400000)
    : 0;

  return {
    stored,
    effective,
    daysOverdue,
    inGoodStanding: GOOD_STANDING.includes(effective)
  };
}

async function logPlatformEvent(supabase, { saccoId, entityId, action, actorEmail, description, metadata = {} }) {
  // Audit logging must never take down the action it is recording.
  // A purge passes saccoId: null on purpose -- audit_events.sacco_id cascades, so a row
  // still pointing at the deleted SACCO would be destroyed along with it. entityId keeps
  // the id readable as plain data.
  const { error } = await supabase.from('audit_events').insert({
    sacco_id: saccoId,
    actor_profile_id: null,
    entity_type: 'sacco',
    entity_id: entityId !== undefined ? entityId : saccoId,
    action,
    metadata: { description, platform_admin: actorEmail, ...metadata }
  });

  if (error) {
    console.warn('Platform audit log notice:', error.message);
  }
}

// Tenant-owned tables, ordered so that every ON DELETE RESTRICT foreign key is satisfied
// before its target is removed. A bare `DELETE FROM saccos` is not enough: cascades fire in
// an unspecified order, and transactions.loan_id, transactions.account_id and
// loan_repayments.transaction_id are all RESTRICT, so the cascade can abort part-way.
const PURGE_ORDER = [
  'loan_guarantors',
  'dividend_allocations',
  'dividend_cycles',
  'savings_vaults',
  'transactions',
  'loans',
  'accounts',
  'sacco_settings',
  'audit_events',
  'sacco_memberships'
];

async function deleteBySacco(supabase, table, saccoId) {
  const { error } = await supabase.from(table).delete().eq('sacco_id', saccoId);

  // A table that this database never had (an optional migration that was not applied) is
  // not a purge failure -- there is nothing in it to erase.
  if (error && !/does not exist|could not find|schema cache/i.test(error.message)) {
    throw new Error(`Failed clearing ${table}: ${error.message}`);
  }
}

// Counts and balances are read before anything is destroyed. Once the purge runs this
// snapshot in the audit log is the only remaining evidence the tenant existed.
async function captureTenantSnapshot(supabase, saccoId) {
  const snapshot = {};

  for (const table of ['sacco_memberships', 'accounts', 'transactions', 'loans', 'savings_vaults']) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('sacco_id', saccoId);

    snapshot[table] = error ? null : count || 0;
  }

  const { data: accounts } = await supabase.from('accounts').select('balance').eq('sacco_id', saccoId);
  snapshot.total_balance = (accounts || []).reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  return snapshot;
}

// Erases a tenant and everything belonging to it. Irreversible by design.
async function purgeTenant(supabase, sacco, actorEmail, reason) {
  const saccoId = sacco.id;
  const snapshot = await captureTenantSnapshot(supabase, saccoId);

  // Members are collected up front: sacco_memberships is the record of who belonged here
  // and it is deleted long before we get to the profiles themselves.
  const { data: memberships, error: memberErr } = await supabase
    .from('sacco_memberships')
    .select('profile_id')
    .eq('sacco_id', saccoId);

  if (memberErr) throw new Error(`Failed reading members: ${memberErr.message}`);

  const memberIds = [...new Set([
    ...(memberships || []).map((m) => m.profile_id),
    ...(sacco.admin_profile_id ? [sacco.admin_profile_id] : [])
  ].filter(Boolean))];

  // loan_repayments carries no sacco_id and holds an ON DELETE RESTRICT reference to
  // transactions, so it has to be cleared by loan id before anything else moves.
  const { data: loanRows } = await supabase.from('loans').select('id').eq('sacco_id', saccoId);
  const loanIds = (loanRows || []).map((l) => l.id);
  if (loanIds.length > 0) {
    const { error } = await supabase.from('loan_repayments').delete().in('loan_id', loanIds);
    if (error) throw new Error(`Failed clearing loan_repayments: ${error.message}`);
  }

  for (const table of PURGE_ORDER) {
    await deleteBySacco(supabase, table, saccoId);
  }

  // saccos.admin_profile_id references profiles, so the tenant row goes before any profile.
  const { error: saccoErr } = await supabase.from('saccos').delete().eq('id', saccoId);
  if (saccoErr) throw new Error(`Failed deleting the SACCO: ${saccoErr.message}`);

  // Members who belong to another SACCO are kept -- only their stale pointer at the
  // deleted group is cleared, so ProtectedRoute cannot self-heal the tenant back into
  // existence from a leftover group_id.
  const removedMembers = [];
  const retainedMembers = [];

  for (const profileId of memberIds) {
    const { data: elsewhere } = await supabase
      .from('sacco_memberships')
      .select('id')
      .eq('profile_id', profileId)
      .limit(1);

    if (elsewhere && elsewhere.length > 0) {
      retainedMembers.push(profileId);
      continue;
    }

    // Removing the auth user cascades to profiles (profiles.id references auth.users
    // ON DELETE CASCADE). If the admin API is unavailable, drop the profile row directly.
    const { error: authErr } = await supabase.auth.admin.deleteUser(profileId);
    if (authErr) {
      const { error: profileErr } = await supabase.from('profiles').delete().eq('id', profileId);
      if (profileErr) {
        console.warn(`Could not remove profile ${profileId}: ${profileErr.message}`);
        continue;
      }
    }
    removedMembers.push(profileId);
  }

  if (retainedMembers.length > 0 && sacco.group_code) {
    await supabase
      .from('profiles')
      .update({ group_id: null })
      .in('id', retainedMembers)
      .ilike('group_id', sacco.group_code);
  }

  await logPlatformEvent(supabase, {
    saccoId: null,
    entityId: saccoId,
    action: 'PURGE_TENANT',
    actorEmail,
    description: `${sacco.name} (${sacco.group_code}) erased by ${actorEmail}. ${removedMembers.length} member account(s) deleted, ${retainedMembers.length} kept for other SACCOs. Reason: ${reason || 'none supplied'}.`,
    metadata: {
      sacco_name: sacco.name,
      group_code: sacco.group_code,
      reason: reason || null,
      members_deleted: removedMembers.length,
      members_retained: retainedMembers.length,
      erased_at: new Date().toISOString(),
      snapshot
    }
  });

  return { snapshot, membersDeleted: removedMembers.length, membersRetained: retainedMembers.length };
}

async function fetchSacco(supabase, saccoId) {
  const { data, error } = await supabase
    .from('saccos')
    .select('*')
    .eq('id', saccoId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function applyLifecycleChange(supabase, { sacco, status, reason, actorEmail, action, description, extraUpdates = {} }) {
  const { data: updated, error } = await supabase
    .from('saccos')
    .update({
      status,
      status_reason: reason || null,
      status_changed_at: new Date().toISOString(),
      status_changed_by: actorEmail,
      updated_at: new Date().toISOString(),
      ...extraUpdates
    })
    .eq('id', sacco.id)
    .select()
    .single();

  if (error) throw error;

  await logPlatformEvent(supabase, {
    saccoId: sacco.id,
    action,
    actorEmail,
    description,
    metadata: {
      previous_status: sacco.status,
      new_status: status,
      reason: reason || null,
      subscription_status: updated.subscription_status
    }
  });

  return updated;
}

export async function GET(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'tenants';
  const supabase = getSupabaseAdmin();

  try {
    if (action === 'tenants') {
      const { data: saccos, error: saccoErr } = await supabase
        .from('saccos')
        .select('*')
        .order('created_at', { ascending: false });

      if (saccoErr) throw saccoErr;

      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, role');

      if (profErr) throw profErr;

      // Attach the derived billing view so the portal and this route agree on what
      // counts as overdue.
      const enriched = (saccos || []).map((sacco) => ({
        ...sacco,
        subscription: subscriptionSnapshot(sacco)
      }));

      return Response.json({ success: true, saccos: enriched, profiles: profiles || [] });
    }

    if (action === 'audit-log') {
      const { data: events, error: auditErr } = await supabase
        .from('audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (auditErr) {
        return Response.json({ success: true, events: [] });
      }

      return Response.json({ success: true, events: events || [] });
    }

    return Response.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabaseAdmin();
  const actorEmail = auth.email;

  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);

    // Accept the action from either the query string or the body so a caller can't
    // silently no-op by putting it in the wrong place.
    const action = body.action || searchParams.get('action');
    const saccoId = body.sacco_id || body.id;
    const reason = (body.reason || '').trim();

    const lifecycleActions = ['suspend-tenant', 'purge-tenant', 'hold-tenant', 'reactivate-tenant', 'update-subscription', 'record-payment', 'update_sacco'];

    if (!lifecycleActions.includes(action)) {
      return Response.json({ error: 'Invalid action.' }, { status: 400 });
    }

    if (!saccoId) {
      return Response.json({ error: 'sacco_id is required' }, { status: 400 });
    }

    const sacco = await fetchSacco(supabase, saccoId);
    if (!sacco) {
      return Response.json({ error: 'SACCO not found.' }, { status: 404 });
    }

    // ---- Action 1: suspend, which erases the tenant ----------------------------------
    // Suspension is destructive and final: the SACCO, its members and every financial
    // record belonging to it are deleted. There is no undo and no archive to restore
    // from -- only the audit entry written below survives. Because of that the caller
    // has to echo the SACCO name back before anything is touched.
    if (action === 'suspend-tenant' || action === 'purge-tenant') {
      const confirmName = (body.confirm_name || '').trim();

      if (confirmName.toLowerCase() !== (sacco.name || '').trim().toLowerCase()) {
        return Response.json({
          error: `Confirmation failed. To erase this tenant, confirm_name must exactly match the SACCO name '${sacco.name}'.`
        }, { status: 400 });
      }

      const result = await purgeTenant(supabase, sacco, actorEmail, reason);

      return Response.json({
        success: true,
        purged: true,
        sacco_id: sacco.id,
        members_deleted: result.membersDeleted,
        members_retained: result.membersRetained,
        snapshot: result.snapshot,
        message: `${sacco.name} has been erased. ${result.membersDeleted} member account(s) deleted`
          + (result.membersRetained > 0 ? `, ${result.membersRetained} kept because they belong to another SACCO` : '')
          + `. This cannot be undone.`
      });
    }

    // ---- Action 2: billing hold, gated on subscription state ------------------------
    if (action === 'hold-tenant') {
      if (sacco.status === 'on_hold') {
        return Response.json({ error: `${sacco.name} is already on hold.` }, { status: 409 });
      }

      if (sacco.status === 'suspended' || sacco.status === 'closed') {
        return Response.json({
          error: `${sacco.name} is ${sacco.status}, which is already stricter than a hold. Reinstate it first if you want a billing hold instead.`
        }, { status: 409 });
      }

      const billing = subscriptionSnapshot(sacco);

      // A hold is a billing measure. If the subscription is paid up there is nothing to
      // hold against -- suspension is the lever for non-billing problems.
      if (billing.inGoodStanding) {
        return Response.json({
          error: `Cannot hold ${sacco.name}: its subscription is in good standing (${billing.effective}). A hold requires a past_due, expired or cancelled subscription. Use suspend for non-billing enforcement.`
        }, { status: 409 });
      }

      const overdueNote = billing.daysOverdue > 0 ? ` (${billing.daysOverdue} days overdue)` : '';
      const label = SUBSCRIPTION_LABELS[billing.effective] || billing.effective;
      const updated = await applyLifecycleChange(supabase, {
        sacco,
        status: 'on_hold',
        reason: reason || `Your PEWOSA subscription is ${label}${overdueNote}. Settle it to restore access for your members.`,
        actorEmail,
        action: 'HOLD_TENANT',
        description: `${sacco.name} placed on billing hold by ${actorEmail} -- subscription ${billing.effective}${overdueNote}.`,
        extraUpdates: billing.effective !== billing.stored ? { subscription_status: billing.effective } : {}
      });

      return Response.json({
        success: true,
        sacco: updated,
        message: `${sacco.name} placed on billing hold. Its members cannot enter the app, and its admin is now shown a payment reminder.`
      });
    }

    // ---- Release / reinstate --------------------------------------------------------
    if (action === 'reactivate-tenant') {
      if (sacco.status === 'active') {
        return Response.json({ error: `${sacco.name} is already active.` }, { status: 409 });
      }

      const wasHeld = sacco.status === 'on_hold';
      const updated = await applyLifecycleChange(supabase, {
        sacco,
        status: 'active',
        reason: null,
        actorEmail,
        action: wasHeld ? 'RELEASE_HOLD' : 'REINSTATE_TENANT',
        description: wasHeld
          ? `Billing hold released on ${sacco.name} by ${actorEmail}.`
          : `${sacco.name} reinstated by ${actorEmail}. ${reason || ''}`.trim()
      });

      return Response.json({
        success: true,
        sacco: updated,
        message: `${sacco.name} is active again.`
      });
    }

    // ---- Subscription bookkeeping ---------------------------------------------------
    if (action === 'update-subscription') {
      const updates = { updated_at: new Date().toISOString() };

      if (body.subscription_status) {
        if (!SUBSCRIPTION_STATUSES.includes(body.subscription_status)) {
          return Response.json({ error: `Invalid subscription_status. Expected one of: ${SUBSCRIPTION_STATUSES.join(', ')}.` }, { status: 400 });
        }
        updates.subscription_status = body.subscription_status;
      }

      if (body.subscription_plan) {
        if (!SUBSCRIPTION_PLANS.includes(body.subscription_plan)) {
          return Response.json({ error: `Invalid subscription_plan. Expected one of: ${SUBSCRIPTION_PLANS.join(', ')}.` }, { status: 400 });
        }
        updates.subscription_plan = body.subscription_plan;
      }

      if (body.subscription_amount !== undefined) {
        updates.subscription_amount = Number(body.subscription_amount) || 0;
      }

      if (body.subscription_expires_at) {
        const expiry = new Date(body.subscription_expires_at);
        if (Number.isNaN(expiry.getTime())) {
          return Response.json({ error: 'Invalid subscription_expires_at date.' }, { status: 400 });
        }
        updates.subscription_expires_at = expiry.toISOString();
      }

      if (Object.keys(updates).length === 1) {
        return Response.json({ error: 'No subscription fields supplied.' }, { status: 400 });
      }

      const { data: updated, error: updateErr } = await supabase
        .from('saccos')
        .update(updates)
        .eq('id', saccoId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      await logPlatformEvent(supabase, {
        saccoId,
        action: 'UPDATE_SUBSCRIPTION',
        actorEmail,
        description: `Subscription updated for ${sacco.name} by ${actorEmail}: ${Object.entries(updates).filter(([k]) => k !== 'updated_at').map(([k, v]) => `${k}=${v}`).join(', ')}`,
        metadata: updates
      });

      return Response.json({ success: true, sacco: updated, message: `Subscription updated for ${sacco.name}.` });
    }

    // ---- Payment received: renews the term, and lifts a billing hold -----------------
    if (action === 'record-payment') {
      const months = Math.max(1, Number(body.months) || 1);
      const amount = body.amount !== undefined ? Number(body.amount) || 0 : Number(sacco.subscription_amount) || 0;

      // Renew from the current expiry when the tenant is paying early, otherwise from today.
      const currentExpiry = sacco.subscription_expires_at ? new Date(sacco.subscription_expires_at) : null;
      const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
      const nextExpiry = new Date(base);
      nextExpiry.setMonth(nextExpiry.getMonth() + months);

      const updates = {
        subscription_status: 'active',
        subscription_expires_at: nextExpiry.toISOString(),
        last_payment_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Payment clears a billing hold automatically. It deliberately does NOT clear a
      // suspension -- that is an administrative decision, not a billing one.
      const releasedHold = sacco.status === 'on_hold';
      if (releasedHold) {
        updates.status = 'active';
        updates.status_reason = null;
        updates.status_changed_at = new Date().toISOString();
        updates.status_changed_by = actorEmail;
      }

      const { data: updated, error: payErr } = await supabase
        .from('saccos')
        .update(updates)
        .eq('id', saccoId)
        .select()
        .single();

      if (payErr) throw payErr;

      await logPlatformEvent(supabase, {
        saccoId,
        action: releasedHold ? 'PAYMENT_RELEASE_HOLD' : 'RECORD_PAYMENT',
        actorEmail,
        description: `Subscription payment of Shs ${amount.toLocaleString()} recorded for ${sacco.name} (${months} month${months > 1 ? 's' : ''}) by ${actorEmail}.${releasedHold ? ' Billing hold lifted.' : ''}`,
        metadata: { amount, months, paid_through: updates.subscription_expires_at, released_hold: releasedHold }
      });

      return Response.json({
        success: true,
        sacco: updated,
        message: releasedHold
          ? `Payment recorded for ${sacco.name}. Billing hold lifted and the subscription runs to ${nextExpiry.toISOString().split('T')[0]}.`
          : `Payment recorded for ${sacco.name}. Subscription now runs to ${nextExpiry.toISOString().split('T')[0]}.`
      });
    }

    // ---- Legacy generic update (member limit / direct status set) --------------------
    if (action === 'update_sacco') {
      const updates = { updated_at: new Date().toISOString() };
      if (body.status) {
        if (!['active', 'on_hold', 'suspended', 'closed'].includes(body.status)) {
          return Response.json({ error: 'Invalid status.' }, { status: 400 });
        }
        updates.status = body.status;
        updates.status_changed_at = new Date().toISOString();
        updates.status_changed_by = actorEmail;
      }
      if (body.member_limit) updates.member_limit = Number(body.member_limit);

      const { data: updatedSacco, error: updateErr } = await supabase
        .from('saccos')
        .update(updates)
        .eq('id', saccoId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return Response.json({ success: true, sacco: updatedSacco });
    }

    return Response.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
