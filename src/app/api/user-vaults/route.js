import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
}

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

  return { user };
}

async function resolveSaccoId(admin, userId) {
  const { data: profile } = await admin
    .from('profiles')
    .select('group_id')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.group_id) return null;

  const { data: sacco } = await admin
    .from('saccos')
    .select('id')
    .ilike('group_code', profile.group_id.trim())
    .maybeSingle();

  return sacco?.id || null;
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = getSupabaseAdmin();
    const saccoId = await resolveSaccoId(admin, auth.user.id);

    // profile_id is always the authenticated caller's own id, never client-supplied.
    let query = admin.from('savings_vaults').select('*').eq('profile_id', auth.user.id);
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
    const auth = await authenticate(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { action, vault_name, target_amount, category, target_date, vault_id, amount } = body;

    const admin = getSupabaseAdmin();
    const saccoId = await resolveSaccoId(admin, auth.user.id);
    if (!saccoId) {
      return NextResponse.json({ error: 'Could not resolve your SACCO group.' }, { status: 400 });
    }

    if (action === 'create') {
      if (!vault_name || !target_amount || Number(target_amount) <= 0) {
        return NextResponse.json({ error: 'Valid vault_name and target_amount > 0 are required' }, { status: 400 });
      }

      const { data: newVault, error } = await admin
        .from('savings_vaults')
        .insert({
          sacco_id: saccoId,
          profile_id: auth.user.id,
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

      const { data: vault, error: fetchErr } = await admin
        .from('savings_vaults')
        .select('*')
        .eq('id', vault_id)
        .single();

      if (fetchErr || !vault) {
        return NextResponse.json({ error: 'Savings vault not found' }, { status: 404 });
      }

      if (vault.profile_id !== auth.user.id) {
        return NextResponse.json({ error: 'Unauthorized. You can only deposit into your own vault.' }, { status: 403 });
      }

      const newBalance = Number(vault.current_balance || 0) + Number(amount);
      const isCompleted = newBalance >= Number(vault.target_amount);

      const { data: updatedVault, error: updateErr } = await admin
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
      await admin.from('transactions').insert({
        sacco_id: vault.sacco_id,
        profile_id: auth.user.id,
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
