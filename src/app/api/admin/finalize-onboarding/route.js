import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// Both actions this route exposes, and the RPC each maps to. Kept as a map so an unknown
// action is refused here by name rather than reaching Postgres as a missing function.
const ACTIONS = {
  finish: 'finalize_historical_onboarding',
  start_new_cycle: 'start_new_sacco_cycle'
};

// The anon key plus the caller's JWT, deliberately -- same reasoning as
// /api/admin/manual-contribution. Both RPCs are SECURITY DEFINER and resolve the caller
// through auth.uid(); a service-role client would leave auth.uid() null and every call
// would abort on the first authorization check.
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
    const action = body.action || 'finish';
    const fn = ACTIONS[action];

    if (!fn) {
      return Response.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }

    // saccoId is optional: the RPC resolves the caller's own SACCO when it is omitted,
    // which is the only case the settings screen has. Staff membership is checked inside
    // either way, so passing an id is not a way around it.
    const { data, error: rpcErr } = await supabase.rpc(fn, {
      p_sacco_id: body.saccoId || null
    });

    if (rpcErr) {
      // Every RAISE EXCEPTION in both functions is written to be shown to the admin
      // as-is, so the message is passed straight through. 400 rather than 500: these are
      // refusals, not server faults.
      const message = rpcErr.message || '';
      const missing =
        rpcErr.code === 'PGRST202' ||
        (rpcErr.code === '42883' && new RegExp(fn, 'i').test(message));

      return Response.json(
        {
          error: missing
            ? 'Week cycles are not available yet: migration 0030 has not been applied to this database.'
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
