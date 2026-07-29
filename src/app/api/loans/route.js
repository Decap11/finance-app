import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    // 1. Fetch active loan
    const { data: loans } = await supabase
      .from('loans')
      .select('*')
      .eq('profile_id', user.id)
      .eq('status', 'issued')
      .limit(1);

    const activeLoan = loans && loans.length > 0 ? loans[0] : null;

    const savingsBalance = 0;

    // 3. Fetch recent loan transactions
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', user.id)
      .in('category', ['loan_disbursement', 'loan_repayment'])
      .order('created_at', { ascending: false })
      .limit(5);

    return Response.json({
      activeLoan,
      savingsBalance,
      recentTransactions: transactions || []
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const body = await request.json();
    const { action, amount, purpose, termMonths, loanType, interestRate, dueDate } = body;

    if (action === 'request_loan') {
      // 1. Fetch the user's SACCO ID from profiles (which bypasses recursive membership SELECT checks)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      if (profileErr || !profile) {
        return Response.json({ error: 'Could not find your SACCO profile.' }, { status: 400 });
      }

      // Fetch matching Sacco ID
      const { data: saccoData, error: saccoErr } = await supabase
        .from('saccos')
        .select('id')
        .eq('group_code', profile.group_id)
        .limit(1)
        .single();

      if (saccoErr || !saccoData) {
        return Response.json({ error: 'Could not find your SACCO group.' }, { status: 400 });
      }

      // 2. Call the RPC to request loan
      const { error: rpcError } = await supabase.rpc('request_loan', {
        p_sacco_id: saccoData.id,
        p_amount: Number(amount),
        p_term_months: termMonths ? Number(termMonths) : null,
        p_purpose: purpose,
        p_loan_type: loanType || 'normal',
        p_interest_rate: Number(interestRate) || 0.00,
        p_due_date: dueDate
      });

      if (rpcError) {
        return Response.json({ error: rpcError.message }, { status: 500 });
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
