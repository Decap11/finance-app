import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  // No fallback to the anon key -- see the note on the same function in platform/route.js.
  // The stake here is the authorization check below: this client answers "is the caller
  // the admin of this SACCO", and an anonymous one reads no sacco_memberships rows, so it
  // would answer "no" for everybody and lock admins out of their own dividend cycles.
  if (!supabaseServiceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Dividend authorization checks membership rows '
      + 'that only the service role can read across a SACCO.'
    );
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Answers "who is this", and nothing about what they may touch.
//
// Split from the authorization check below so a handler can establish identity before it
// validates input. Both handlers used to check their parameters first, which meant an
// anonymous caller sending a malformed request was told which parameters it should have
// sent instead of being told to sign in. Not a hole -- a well-formed anonymous request
// was still refused with 401 -- but it put the input validation in front of the auth
// check, and every other route in the app answers 401 first.
//
// Returns a JWT-forwarding client so RPC calls resolve auth.uid() correctly.
async function authenticate(request) {
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

  return { user, jwtClient };
}

// Verifies an already-authenticated caller is the admin of this particular SACCO.
async function authorizeSaccoAdmin(user, saccoId) {
  const admin = getSupabaseAdmin();

  // Both tests name saccoId. There used to be a third, checked first, which did not:
  //
  //     let isAdminOfSacco = profile?.role === 'admin';
  //
  // profiles.role is global -- it says the caller administers *a* SACCO, not this one --
  // and the two scoped tests below only ran when it failed. So any SACCO admin could pass
  // any sacco_id in the query string and be authorized for it. GET ?action=history then
  // read that SACCO's dividend_cycles through the service-key client, which bypasses RLS:
  // a cross-tenant read of another group's payout history by anyone who could edit a URL.
  // preview and POST happened to survive it only because they forward the caller's JWT and
  // the RPC guards itself.
  const { data: membership } = await admin
    .from('sacco_memberships')
    .select('role')
    .eq('sacco_id', saccoId)
    .eq('profile_id', user.id)
    .maybeSingle();

  let isAdminOfSacco = membership?.role === 'admin';

  // A SACCO whose membership rows never materialised still has a founder, and
  // resolveAdministeredSacco in sacco-settings treats that as the same authority.
  if (!isAdminOfSacco) {
    const { data: saccoRow } = await admin
      .from('saccos')
      .select('id')
      .eq('id', saccoId)
      .eq('admin_profile_id', user.id)
      .maybeSingle();
    isAdminOfSacco = !!saccoRow;
  }

  if (!isAdminOfSacco) {
    return { error: 'Unauthorized. Only the admin of this SACCO can manage dividends.', status: 403 };
  }

  return {};
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const saccoId = searchParams.get('sacco_id');
    const profitPool = searchParams.get('profit_pool');
    const action = searchParams.get('action') || 'preview';

    const auth = await authenticate(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!saccoId) {
      return NextResponse.json({ error: 'sacco_id is required' }, { status: 400 });
    }

    const authz = await authorizeSaccoAdmin(auth.user, saccoId);
    if (authz.error) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    if (action === 'preview') {
      const poolAmount = Number(profitPool || 0);
      // Forward the caller's JWT so auth.uid() resolves inside calculate_dividend_preview.
      const { data, error } = await auth.jwtClient.rpc('calculate_dividend_preview', {
        p_sacco_id: saccoId,
        p_profit_pool: poolAmount
      });

      if (error) throw error;
      return NextResponse.json({ success: true, preview: data });
    }

    if (action === 'history') {
      const { data: cycles, error } = await getSupabaseAdmin()
        .from('dividend_cycles')
        .select('*')
        .eq('sacco_id', saccoId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return NextResponse.json({ success: true, cycles: cycles || [] });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // Ahead of reading the body: an anonymous caller sending malformed JSON should be told
    // to sign in, not have the parse failure surface as a 500 from the catch below.
    const auth = await authenticate(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { sacco_id, cycle_year, profit_pool, distribution_mode } = body;

    if (!sacco_id || !profit_pool || Number(profit_pool) <= 0) {
      return NextResponse.json({ error: 'Valid sacco_id and profit_pool > 0 are required' }, { status: 400 });
    }

    const authz = await authorizeSaccoAdmin(auth.user, sacco_id);
    if (authz.error) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    const currentYear = cycle_year || new Date().getFullYear();
    const mode = distribution_mode || 'shares';

    // Forward the caller's JWT so auth.uid() resolves inside execute_dividend_payout.
    const { data, error } = await auth.jwtClient.rpc('execute_dividend_payout', {
      p_sacco_id: sacco_id,
      p_cycle_year: Number(currentYear),
      p_profit_pool: Number(profit_pool),
      p_distribution_mode: mode
    });

    if (error) throw error;

    return NextResponse.json({ success: true, result: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
