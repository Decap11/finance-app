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
    const status = searchParams.get('status') || 'pending';

    if (!profileId) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: requests, error } = await supabase
      .from('loan_guarantors')
      .select(`
        *,
        borrower:profiles!borrower_profile_id(full_name, member_number, phone),
        loan:loans(amount, term_months, interest_rate, status)
      `)
      .eq('guarantor_profile_id', profileId)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, requests: requests || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, guarantor_id, response, loan_id, guarantor_profile_ids, guaranteed_amount, borrower_id, sacco_id } = body;

    const supabase = getSupabaseAdmin();

    if (action === 'nominate') {
      if (!loan_id || !guarantor_profile_ids || !Array.isArray(guarantor_profile_ids) || guarantor_profile_ids.length === 0) {
        return NextResponse.json({ error: 'Valid loan_id and guarantor_profile_ids array required' }, { status: 400 });
      }

      const records = guarantor_profile_ids.map(gId => ({
        loan_id,
        sacco_id,
        borrower_profile_id: borrower_id,
        guarantor_profile_id: gId,
        status: 'pending',
        guaranteed_amount: Number(guaranteed_amount || 0)
      }));

      const { data, error } = await supabase
        .from('loan_guarantors')
        .insert(records)
        .select();

      if (error) throw error;

      // Update loan guarantor status
      await supabase
        .from('loans')
        .update({ guarantor_status: 'pending_guarantors', status: 'pending_guarantors' })
        .eq('id', loan_id);

      return NextResponse.json({ success: true, guarantors: data });
    }

    if (action === 'respond') {
      if (!guarantor_id || !['approved', 'rejected'].includes(response)) {
        return NextResponse.json({ error: 'Valid guarantor_id and response (approved/rejected) required' }, { status: 400 });
      }

      const { data, error } = await supabase.rpc('process_guarantor_response', {
        p_guarantor_id: guarantor_id,
        p_response: response
      });

      if (error) throw error;

      return NextResponse.json({ success: true, result: data });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
