import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * The one way fines are created, collected and waived.
 *
 * Every write goes through a SECURITY DEFINER RPC that re-checks the caller is staff of
 * the target member's own SACCO, so the client is built from the caller's JWT rather than
 * the service role -- auth.uid() inside those functions has to be the admin, or their
 * authorization check has nothing to check (ai-context security invariant 4).
 *
 * Absenteeism is not a general fine. Both live here because both are money owed to the
 * SACCO and the collection mechanics are identical, but `fine_type` keeps them apart and
 * `?type=` / `?exclude=` let a caller ask for one without the other.
 */
function clientFor(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

async function authenticate(request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    return { error: Response.json({ error: 'No authorization token provided.' }, { status: 401 }) };
  }

  const supabase = clientFor(token);
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { error: Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 }) };
  }

  return { supabase, user };
}

// GET /api/admin/fines?week=4&status=pending&type=absenteeism|exclude=absenteeism
//
// Reads are left to RLS rather than an explicit role check: the transactions SELECT
// policy already scopes a member to their own rows and staff to their own SACCO, so the
// worst a member can do here is list their own fines, which they can already see.
export async function GET(request) {
  try {
    const { supabase, error } = await authenticate(request);
    if (error) return error;

    const params = new URL(request.url).searchParams;

    let query = supabase
      .from('transactions')
      .select('id, profile_id, full_name, amount, status, fine_type, description, week_number, created_at, completed_at')
      .eq('category', 'fines')
      .order('created_at', { ascending: false });

    if (params.get('week')) query = query.eq('week_number', Number(params.get('week')));
    if (params.get('status')) query = query.eq('status', params.get('status'));
    if (params.get('type')) query = query.eq('fine_type', params.get('type'));
    if (params.get('exclude')) query = query.neq('fine_type', params.get('exclude'));

    const { data, error: readErr } = await query;
    if (readErr) {
      return Response.json({ error: readErr.message }, { status: 500 });
    }

    return Response.json({ fines: data || [] });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error reading fines.' }, { status: 500 });
  }
}

// POST /api/admin/fines
//   { profileId, amount, fineType, description?, weekNumber? }
//   { members: [id, ...], amount, fineType, description?, weekNumber? }
//
// The array form exists for the attendance engine, which levies one absence fine per
// absentee in a single action. Failures are collected per member rather than aborting the
// batch: one member missing a SACCO membership should not cost the other nine their fine.
export async function POST(request) {
  try {
    const { supabase, error } = await authenticate(request);
    if (error) return error;

    const body = await request.json();
    const { profileId, members, amount, fineType, description, weekNumber } = body;

    const targets = Array.isArray(members) ? members : (profileId ? [profileId] : []);

    if (targets.length === 0) {
      return Response.json({ error: 'No member specified for this fine.' }, { status: 400 });
    }
    if (!amount || Number(amount) <= 0) {
      return Response.json({ error: 'A fine must be greater than zero.' }, { status: 400 });
    }
    if (!fineType || !String(fineType).trim()) {
      return Response.json({ error: 'A fine must say what it is for.' }, { status: 400 });
    }

    const args = {
      p_amount: Number(amount),
      p_fine_type: String(fineType).trim(),
      p_description: description || null,
      p_week_number: weekNumber ? Number(weekNumber) : null
    };

    // One statement for the whole register (migration 0039). Closing a meeting with thirty
    // absentees used to be thirty sequential round trips, and a failure partway through
    // left half the register fined with nothing to roll back to.
    const { data: bulk, error: bulkErr } = await supabase.rpc('levy_member_fines_bulk', {
      p_profile_ids: targets,
      ...args
    });

    if (!bulkErr) {
      const ids = bulk?.transaction_ids || [];
      return Response.json({
        success: true,
        issued: targets.map((profileId, i) => ({ profileId, transactionId: ids[i] || null })),
        failed: []
      });
    }

    // 42883 is undefined_function; PGRST202 is PostgREST not finding it in its schema
    // cache. Anything else is the function refusing the request on its merits -- an
    // unauthorised caller, a mixed-SACCO list -- and must be reported, not retried a
    // slower way that would fail identically thirty times over.
    const missingFn = bulkErr.code === '42883' || bulkErr.code === 'PGRST202';
    if (!missingFn) {
      return Response.json({ error: bulkErr.message, failed: [] }, { status: 400 });
    }

    console.warn(
      'Fines: levy_member_fines_bulk missing — apply migration 0039. Falling back to the '
      + `per-member loop for ${targets.length} member(s).`
    );

    const issued = [];
    const failed = [];

    for (const target of targets) {
      const { data, error: rpcErr } = await supabase.rpc('levy_member_fine', {
        p_profile_id: target,
        ...args
      });

      if (rpcErr) {
        failed.push({ profileId: target, error: rpcErr.message });
      } else {
        issued.push({ profileId: target, transactionId: data?.transaction_id });
      }
    }

    // Nothing landed at all -- report it as a failure rather than a partial success, or
    // the caller shows a green toast for an action that did nothing.
    if (issued.length === 0) {
      return Response.json({
        error: `Could not issue the fine: ${failed[0]?.error || 'unknown error'}`,
        failed
      }, { status: 400 });
    }

    return Response.json({ success: true, issued, failed });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error issuing fine.' }, { status: 500 });
  }
}

// PATCH /api/admin/fines
//   { transactionId, action: 'collect' }        -> approve_member_transaction
//   { transactionId, action: 'waive', reason? } -> waive_member_fine
//
// Collecting is the ordinary approval path, which is what moves the amount into the
// member's fines account. Waiving marks the row rejected and never deletes it.
export async function PATCH(request) {
  try {
    const { supabase, error } = await authenticate(request);
    if (error) return error;

    const { transactionId, action, reason } = await request.json();

    if (!transactionId) {
      return Response.json({ error: 'Missing transactionId.' }, { status: 400 });
    }

    if (action === 'collect') {
      const { error: rpcErr } = await supabase
        .rpc('approve_member_transaction', { p_transaction_id: transactionId });

      if (rpcErr) {
        return Response.json({ error: 'Failed to record the payment: ' + rpcErr.message }, { status: 500 });
      }
      return Response.json({ success: true, message: 'Fine marked as paid.' });
    }

    if (action === 'waive') {
      const { error: rpcErr } = await supabase
        .rpc('waive_member_fine', { p_transaction_id: transactionId, p_reason: reason || null });

      if (rpcErr) {
        return Response.json({ error: 'Failed to waive the fine: ' + rpcErr.message }, { status: 500 });
      }
      return Response.json({ success: true, message: 'Fine waived.' });
    }

    return Response.json({ error: "action must be 'collect' or 'waive'." }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error updating fine.' }, { status: 500 });
  }
}
