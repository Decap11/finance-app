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

  return { user, jwtClient };
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const admin = getSupabaseAdmin();

    // guarantor_profile_id is always the authenticated caller's own id, never client-supplied.
    const { data: requests, error } = await admin
      .from('loan_guarantors')
      .select(`
        *,
        borrower:profiles!borrower_profile_id(full_name, member_number, phone),
        loan:loans(loan_number, loan_type, amount_requested, total_repayable, term_months, interest_rate, status, purpose)
      `)
      .eq('guarantor_profile_id', auth.user.id)
      .eq('status', status)
      .order('created_at', { ascending: false });

    // Reporting a query failure as an empty success is what hid the broken column
    // selection here for as long as it lasted: a guarantor with requests waiting saw the
    // same blank panel as a guarantor with none, and nothing said which it was.
    if (error) {
      return NextResponse.json(
        { error: 'Could not load your guarantee requests: ' + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, requests: requests || [] });
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
    const { action, guarantor_id, response, loan_id, guarantor_profile_ids, guaranteed_amount } = body;

    const admin = getSupabaseAdmin();

    if (action === 'nominate') {
      if (!loan_id || !guarantor_profile_ids || !Array.isArray(guarantor_profile_ids) || guarantor_profile_ids.length === 0) {
        return NextResponse.json({ error: 'Valid loan_id and guarantor_profile_ids array required' }, { status: 400 });
      }

      // The caller may only nominate guarantors for their own loan — sacco_id/borrower_id are
      // resolved server-side from the loan row, never trusted from the request body.
      const { data: loan, error: loanErr } = await admin
        .from('loans')
        .select('id, sacco_id, profile_id')
        .eq('id', loan_id)
        .single();

      if (loanErr || !loan || loan.profile_id !== auth.user.id) {
        return NextResponse.json({ error: 'Unauthorized. You may only nominate guarantors for your own loan.' }, { status: 403 });
      }

      const records = guarantor_profile_ids.map((gId) => ({
        loan_id,
        sacco_id: loan.sacco_id,
        borrower_profile_id: auth.user.id,
        guarantor_profile_id: gId,
        status: 'pending',
        guaranteed_amount: Number(guaranteed_amount || 0)
      }));

      const { data, error } = await admin
        .from('loan_guarantors')
        .insert(records)
        .select();

      if (error) throw error;

      await admin
        .from('loans')
        .update({ guarantor_status: 'pending_guarantors', status: 'pending_guarantors' })
        .eq('id', loan_id);

      return NextResponse.json({ success: true, guarantors: data });
    }

    if (action === 'respond') {
      if (!guarantor_id || !['approved', 'rejected'].includes(response)) {
        return NextResponse.json({ error: 'Valid guarantor_id and response (approved/rejected) required' }, { status: 400 });
      }

      // The caller may only respond to a guarantee request addressed to them.
      const { data: guarantorRow, error: fetchErr } = await admin
        .from('loan_guarantors')
        .select('guarantor_profile_id')
        .eq('id', guarantor_id)
        .single();

      if (fetchErr || !guarantorRow) {
        return NextResponse.json({ error: 'Guarantor record not found.' }, { status: 404 });
      }

      if (guarantorRow.guarantor_profile_id !== auth.user.id) {
        return NextResponse.json({ error: 'Unauthorized. This guarantee request was not addressed to you.' }, { status: 403 });
      }

      // Forward the caller's JWT so auth.uid() resolves inside process_guarantor_response.
      const { data, error } = await auth.jwtClient.rpc('process_guarantor_response', {
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
