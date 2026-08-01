import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, serviceKey);
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

    const supabase = getSupabaseAdmin();

    if (action === 'preview') {
      const poolAmount = Number(profitPool || 0);
      const { data, error } = await supabase.rpc('calculate_dividend_preview', {
        p_sacco_id: saccoId,
        p_profit_pool: poolAmount
      });

      if (error) throw error;
      return NextResponse.json({ success: true, preview: data });
    }

    if (action === 'history') {
      const { data: cycles, error } = await supabase
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

    const supabase = getSupabaseAdmin();
    const currentYear = cycle_year || new Date().getFullYear();
    const mode = distribution_mode || 'shares';

    const { data, error } = await supabase.rpc('execute_dividend_payout', {
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
