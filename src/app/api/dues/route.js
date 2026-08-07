import { createClient } from '@supabase/supabase-js';
import { computeMemberDues, summariseDues, MANDATORY_FUNDS } from '../../../utils/duesEngine';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// PostgREST caps a single response (1000 rows by default). A SACCO with a few years of
// backfilled history passes that easily, and a truncated read here does not just make a
// total slightly wrong -- the missing payments come back as arrears, so the page would
// accuse members of not paying money they did pay. Paging is the only safe way to read a
// whole ledger.
const PAGE = 1000;

async function fetchAllTransactions(supabase, saccoId) {
  const rows = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('transactions')
      // week_number carries an admin's statement that this money settles a NAMED week --
      // see settle_mandatory_weeks (0038). Without it in the select the dues engine falls
      // back to inferring the week from the date, which is exactly what it does for every
      // ordinary contribution, so an arrears payment would silently lose its attribution.
      .select('id, profile_id, amount, category, status, direction, created_at, week_number')
      .eq('sacco_id', saccoId)
      .in('status', ['completed', 'approved', 'pending'])
      // Ordered by the primary key, not by created_at. created_at is a DATE, so a busy
      // meeting day produces dozens of ties, and paging through a non-unique sort order
      // silently duplicates and drops rows at the page boundaries -- a dropped payment here
      // comes back as arrears against a member who actually paid.
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE) break;
  }

  return rows;
}

// profiles.joined_on is added by migration 0031. Selecting a column that does not exist fails
// the whole query, so a database still on 0030 would lose its dues screens entirely over a
// field that is optional by design. Asking for it and retrying without it keeps this route
// working before the migration is applied -- every member simply falls back to the inference,
// which is exactly the behaviour 0031 replaces.
async function selectProfiles(supabase, groupCode, profileId = null) {
  const columns = 'id, full_name, email, member_number';

  const run = (select) => {
    let q = supabase.from('profiles').select(select);
    q = profileId ? q.eq('id', profileId) : q.ilike('group_id', groupCode);
    return q.order('full_name', { ascending: true });
  };

  const withJoinedOn = await run(`${columns}, joined_on`);
  if (!withJoinedOn.error) return withJoinedOn.data || [];

  // 42703 is Postgres's undefined_column; PGRST204 is PostgREST failing to find it in the
  // schema cache. Anything else is a real failure and must not be swallowed.
  const code = withJoinedOn.error.code;
  if (code !== '42703' && code !== 'PGRST204') {
    throw new Error(withJoinedOn.error.message);
  }

  const { data, error } = await run(columns);
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * GET /api/dues
 *
 * What each member still owes in weekly mandatory funds (development + social). Nothing is
 * stored -- see utils/duesEngine.js for why arrears are derived on every read and for the
 * three rules that decide the figures.
 *
 * Built from the anon key plus the caller's JWT, never the service role, so RLS scopes the
 * answer: `transactions_select_own_or_staff` (migration 0019) returns a member only their own
 * rows and staff their whole SACCO. One query therefore serves both audiences and a member
 * cannot read anybody else's position by calling this directly.
 *
 * The role check below decides only the SHAPE of the reply -- staff get a row per member,
 * enumerated from profiles so that somebody with zero records still appears, which is exactly
 * the member an admin most needs to see.
 */
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1];
    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    // profiles.group_id holds a group CODE; most tables key off sacco_id. Resolving one to
    // the other through saccos.group_code is the standard pattern in this codebase.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, group_id, full_name, member_number')
      .eq('id', user.id)
      .maybeSingle();

    const groupCode = (profile?.group_id || '').trim();
    if (!groupCode) {
      return Response.json({ error: 'Your account is not linked to a SACCO yet.' }, { status: 400 });
    }

    const { data: sacco } = await supabase
      .from('saccos')
      .select('id, group_code, created_at, admin_profile_id')
      .ilike('group_code', groupCode)
      .maybeSingle();

    if (!sacco?.id) {
      return Response.json({ error: 'Could not find your SACCO.' }, { status: 404 });
    }

    // sacco_memberships is the authoritative source for role checks; the owner and the
    // profiles role are consulted as fallbacks for the same reason the admin dashboard does
    // -- pre-0009 groups and bulk-added members do not always have a membership row.
    const { data: membership } = await supabase
      .from('sacco_memberships')
      .select('role')
      .eq('sacco_id', sacco.id)
      .eq('profile_id', user.id)
      .maybeSingle();

    const roles = ['admin', 'loan_officer'];
    const isStaff =
      roles.includes(String(membership?.role || '').toLowerCase()) ||
      roles.includes(String(profile?.role || '').toLowerCase()) ||
      String(sacco.admin_profile_id || '') === String(user.id);

    // One call gives the weekly rates, the meeting day, the derived active week and the
    // anchor. Reusing it is what keeps the dues arithmetic on the same week scale as every
    // other screen. Imported dynamically, as contribution-habits does, rather than statically
    // pulling one route module into another.
    const { getActiveSaccoSettings } = await import('../sacco-settings/route.js');
    const settings = await getActiveSaccoSettings(sacco.group_code || groupCode);

    const rates = {
      development_fund: Number(settings.devtFund) || 0,
      social_fund: Number(settings.socialFund) || 0
    };

    // Where a member with NO records starts counting. The anchor is the SACCO's own Week 1;
    // before it is set (no historical onboarding) the day the group registered is the
    // earliest point any obligation could plausibly run from.
    const fallbackStart = settings.weekAnchorDate || sacco.created_at || settings.onboardingDate || null;
    const meetingDay = settings.meetingDay || 'Wednesday';

    const transactions = await fetchAllTransactions(supabase, sacco.id);

    const byMember = new Map();
    transactions.forEach((tx) => {
      const key = String(tx.profile_id);
      if (!byMember.has(key)) byMember.set(key, []);
      byMember.get(key).push(tx);
    });

    // Staff see everybody, including members with nothing on file. A member sees only
    // themselves -- and RLS has already made sure that is all they were given.
    let roster;
    if (isStaff) {
      const profiles = await selectProfiles(supabase, groupCode);

      roster = (profiles || []).map((p) => ({
        id: p.id,
        name: p.full_name || p.email || 'Member',
        memberNumber: p.member_number || null,
        joinedOn: p.joined_on || null
      }));
    } else {
      // Re-read through the same tolerant helper rather than the select above, which does not
      // ask for joined_on -- a member's own banner has to honour their stated join date too.
      const own = (await selectProfiles(supabase, groupCode, user.id))[0];
      roster = [{
        id: user.id,
        name: own?.full_name || profile?.full_name || user.email || 'You',
        memberNumber: own?.member_number || profile?.member_number || null,
        joinedOn: own?.joined_on || null
      }];
    }

    const today = new Date();

    const rows = roster.map((member) => {
      const dues = computeMemberDues({
        transactions: byMember.get(String(member.id)) || [],
        rates,
        meetingDay,
        joinedOn: member.joinedOn,
        fallbackStart,
        weekAnchor: settings.weekAnchorDate || null,
        today
      });

      // The full ledger is one entry per elapsed week per member -- for a SACCO deep into
      // its cycle that is tens of thousands of objects across a roster, and staff screens
      // only ever draw the short weeks. A member reading their own row gets the whole
      // thing, because their history is one member long and the banner explains it.
      const { weeks, ...totals } = dues;

      return {
        profileId: member.id,
        name: member.name,
        memberNumber: member.memberNumber,
        joinedOn: member.joinedOn || null,
        ...totals,
        ...(isStaff ? {} : { weeks })
      };
    });

    // Worst first: this list exists to tell an admin who to chase.
    rows.sort((a, b) => b.totalOwed - a.totalOwed);

    return Response.json({
      scope: isStaff ? 'sacco' : 'member',
      rows,
      totals: summariseDues(rows),
      rates,
      funds: MANDATORY_FUNDS,
      activeWeek: Number(settings.currentWeek) || 1,
      weekAnchorDate: settings.weekAnchorDate || null,
      meetingDay
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error computing dues.' }, { status: 500 });
  }
}

/** Postgres cannot find the function, or PostgREST cannot find it in its schema cache. */
function isMissingFunction(error) {
  if (!error) return false;
  if (error.code === '42883' || error.code === 'PGRST202') return true;
  return /settle_mandatory_weeks/i.test(error.message || '') && /does not exist|could not find/i.test(error.message || '');
}

/**
 * POST /api/dues
 *
 * Registers a member's arrears payment against the specific weeks it clears.
 *
 * The GET above derives what is owed and, since the week ledger, WHICH weeks are short.
 * This is the other half: the admin has the cash in hand and says which of those weeks it
 * settles. settle_mandatory_weeks (migration 0038) writes one completed transaction per
 * week, each stamped with `week_number`, which is what lets the dues ledger and the
 * contribution heatmap agree afterwards on what the money was for.
 *
 * Built from the anon key plus the caller's JWT, never the service role -- the RPC is
 * SECURITY DEFINER and does its own staff check against the MEMBER's SACCO, so authority
 * is decided in one place rather than trusted from here.
 */
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1];
    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { memberId, category, weeks, note } = body;

    if (!memberId) {
      return Response.json({ error: 'Say which member this payment is for.' }, { status: 400 });
    }
    if (!MANDATORY_FUNDS.includes(category)) {
      return Response.json(
        { error: 'Only the development and social funds are owed weekly.' },
        { status: 400 }
      );
    }

    // Coerced and bounded here as well as in the function. This route is not the only way
    // to reach the RPC, but it is the only one a mistyped client can reach.
    const weekList = Array.from(new Set(
      (Array.isArray(weeks) ? weeks : [])
        .map((w) => Number(w))
        .filter((w) => Number.isInteger(w) && w >= 1 && w <= 52)
    )).sort((a, b) => a - b);

    if (weekList.length === 0) {
      return Response.json({ error: 'Choose at least one week to register.' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('settle_mandatory_weeks', {
      p_member_id: memberId,
      p_category: category,
      p_weeks: weekList,
      p_note: typeof note === 'string' && note.trim() ? note.trim() : null
    });

    if (error) {
      // 501, not 500: the request was well formed and the database simply has not had
      // 0038 applied. Three features in this repository have looked broken for days over
      // exactly this, so it says which file to run rather than reporting a server error.
      if (isMissingFunction(error)) {
        return Response.json({
          error: 'This database has not had migration 0038 applied, so payments cannot be '
            + 'registered against a week yet. Run supabase/migrations/'
            + '0038_20260807_settle-mandatory-weeks.sql.',
          code: 'MIGRATION_0038_MISSING'
        }, { status: 501 });
      }
      // The RPC raises for a caller who is not staff of this member's SACCO.
      const denied = /only an admin|authentication required/i.test(error.message || '');
      return Response.json({ error: error.message }, { status: denied ? 403 : 400 });
    }

    const settled = Number(data?.settled_weeks) || 0;

    return Response.json({
      ...data,
      // Weeks asked for that were already settled. Reported so the admin is told plainly
      // rather than shown a success message for money that was never banked.
      skipped: Math.max(0, weekList.length - settled)
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error registering payment.' }, { status: 500 });
  }
}
