import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * POST /api/admin/join-dates
 *
 *   { memberId, joinedOn }            -> set (or clear, with joinedOn: null) one member
 *   { scope: 'all', joinedOn? }       -> fill every member whose date is still blank
 *
 * When a member joined the SACCO is the fact the whole arrears calculation rests on. Without
 * it src/utils/duesEngine.js has to infer a start from the member's earliest record, and that
 * inference cannot tell "joined in week 20" from "was here since week 1 and paid nothing until
 * week 20" -- it forgives the unpaid weeks. Stating the date closes that.
 *
 * Anon key plus the caller's JWT, never the service role: both RPCs are SECURITY DEFINER and
 * resolve the caller through auth.uid(), so a service-role client would leave auth.uid() null
 * and every authorization check inside them would have nothing to check.
 */
const ACTIONS = {
  one: 'set_member_join_date',
  all: 'set_all_member_join_dates'
};

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1] || null;
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
    const bulk = body.scope === 'all';

    // null is a legitimate value on both paths and must survive the trip: on the single-member
    // path it clears the date and hands the member back to the inference, and on the bulk path
    // it means "use the SACCO's Week 1". Neither is a missing argument.
    const joinedOn = body.joinedOn === undefined || body.joinedOn === null || body.joinedOn === ''
      ? null
      : String(body.joinedOn);

    if (joinedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(joinedOn)) {
      return Response.json(
        { error: 'joinedOn must be a date in YYYY-MM-DD form.' },
        { status: 400 }
      );
    }

    if (!bulk && !body.memberId) {
      return Response.json(
        { error: 'Name the member, or pass scope: "all" to set every member at once.' },
        { status: 400 }
      );
    }

    const fn = bulk ? ACTIONS.all : ACTIONS.one;
    const args = bulk
      ? {
          p_sacco_id: body.saccoId || null,
          p_joined_on: joinedOn,
          // Blanks only, so an admin who has already corrected a late joiner does not lose
          // that correction by pressing the button again.
          p_only_missing: body.onlyMissing === false ? false : true
        }
      : { p_member_id: body.memberId, p_joined_on: joinedOn };

    const { data, error: rpcErr } = await supabase.rpc(fn, args);

    if (rpcErr) {
      // Every RAISE EXCEPTION in both functions is written to be shown to the admin as-is.
      // A missing function means 0031 has not been applied; anything else is a refusal of
      // what was asked, which is a 400 rather than a server fault.
      const message = rpcErr.message || '';
      const missing =
        rpcErr.code === 'PGRST202' ||
        (rpcErr.code === '42883' && new RegExp(fn, 'i').test(message));

      return Response.json(
        {
          error: missing
            ? 'Member join dates are not available yet: migration 0031 has not been applied to this database.'
            : message,
          ...(missing ? {} : { code: rpcErr.code, details: rpcErr.details, hint: rpcErr.hint })
        },
        { status: missing ? 503 : 400 }
      );
    }

    return Response.json({ success: true, ...(data || {}) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
