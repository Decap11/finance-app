import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
}

// Verifies the caller is authenticated AND is the admin of the target SACCO.
// Returns a JWT-forwarding client so RPC calls resolve auth.uid() correctly.
async function authorizeSaccoAdmin(request, saccoId) {
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

  const admin = getSupabaseAdmin();

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  let isAdminOfSacco = profile?.role === 'admin';

  if (!isAdminOfSacco) {
    const { data: membership } = await admin
      .from('sacco_memberships')
      .select('role')
      .eq('sacco_id', saccoId)
      .eq('profile_id', user.id)
      .maybeSingle();
    isAdminOfSacco = membership?.role === 'admin';
  }

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

  return { user, jwtClient };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const saccoId = searchParams.get('sacco_id');
    const profitPool = searchParams.get('profit_pool');
    const action = searchParams.get('action') || 'preview';

    if (!saccoId) {
      return NextResponse.json({ error: 'sacco_id is required' }, { status: 400 });
    }

    const auth = await authorizeSaccoAdmin(request, saccoId);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
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
    const body = await request.json();
    const { sacco_id, cycle_year, profit_pool, distribution_mode } = body;

    if (!sacco_id || !profit_pool || Number(profit_pool) <= 0) {
      return NextResponse.json({ error: 'Valid sacco_id and profit_pool > 0 are required' }, { status: 400 });
    }

    const auth = await authorizeSaccoAdmin(request, sacco_id);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
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
