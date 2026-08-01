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
    const profileId = searchParams.get('profile_id');
    const saccoId = searchParams.get('sacco_id');

    if (!profileId) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase.from('savings_vaults').select('*').eq('profile_id', profileId);

    if (saccoId) {
      query = query.eq('sacco_id', saccoId);
    }

    const { data: vaults, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({ success: true, vaults: vaults || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, profile_id, sacco_id, vault_name, target_amount, category, target_date, vault_id, amount } = body;

    if (!profile_id || !sacco_id) {
      return NextResponse.json({ error: 'profile_id and sacco_id are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (action === 'create') {
      if (!vault_name || !target_amount || Number(target_amount) <= 0) {
        return NextResponse.json({ error: 'Valid vault_name and target_amount > 0 are required' }, { status: 400 });
      }

      const { data: newVault, error } = await supabase
        .from('savings_vaults')
        .insert({
          sacco_id,
          profile_id,
          vault_name: vault_name.trim(),
          category: category || 'general',
          target_amount: Number(target_amount),
          current_balance: 0,
          target_date: target_date || null,
          status: 'active'
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, vault: newVault });
    }

    if (action === 'deposit') {
      if (!vault_id || !amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'Valid vault_id and deposit amount > 0 are required' }, { status: 400 });
      }

      const { data: vault, error: fetchErr } = await supabase
        .from('savings_vaults')
        .select('*')
        .eq('id', vault_id)
        .single();

      if (fetchErr || !vault) {
        return NextResponse.json({ error: 'Savings vault not found' }, { status: 404 });
      }

      const newBalance = Number(vault.current_balance || 0) + Number(amount);
      const isCompleted = newBalance >= Number(vault.target_amount);

      const { data: updatedVault, error: updateErr } = await supabase
        .from('savings_vaults')
        .update({
          current_balance: newBalance,
          status: isCompleted ? 'completed' : 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', vault_id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Log transaction record
      await supabase.from('transactions').insert({
        sacco_id,
        profile_id,
        direction: 'debit',
        category: 'savings_vault',
        amount: Number(amount),
        status: 'completed',
        description: `Deposit to Goal Vault: ${vault.vault_name}`,
        created_at: new Date().toISOString()
      });

      return NextResponse.json({ success: true, vault: updatedVault });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
