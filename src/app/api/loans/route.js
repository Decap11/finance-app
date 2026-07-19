import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

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
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    const body = await request.json();
    const { action, amount, purpose, termMonths, loanType, interestRate, dueDate } = body;

    // Validation
    if (action === 'request_loan') {
      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return Response.json({ error: 'Loan amount must be a positive number greater than 0.' }, { status: 400 });
      }

      const parsedTerm = Number(termMonths);
      if (termMonths !== undefined && (isNaN(parsedTerm) || parsedTerm <= 0 || !Number.isInteger(parsedTerm))) {
        return Response.json({ error: 'Term months must be a positive integer.' }, { status: 400 });
      }

      // 1. Fetch the user's SACCO ID from profiles (which bypasses recursive membership SELECT checks)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      if (profileErr || !profile) {
        return Response.json({ error: 'Could not find your SACCO profile.' }, { status: 400 });
      }

      const cleanGroupCode = (profile.group_id || '').trim();

      // Fetch matching Sacco ID (case-insensitive with fallback)
      const { data: saccoRows } = await supabase
        .from('saccos')
        .select('id')
        .ilike('group_code', cleanGroupCode)
        .limit(1);

      let saccoData = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;

      if (!saccoData) {
        const { data: fallbackRows } = await supabase
          .from('saccos')
          .select('id')
          .limit(1);
        if (fallbackRows && fallbackRows.length > 0) {
          saccoData = fallbackRows[0];
        }
      }

      if (!saccoData) {
        return Response.json({ error: 'Could not find your SACCO group.' }, { status: 400 });
      }

      // 2. Call the RPC to request loan
      const { error: rpcError } = await supabase.rpc('request_loan', {
        p_sacco_id: saccoData.id,
        p_amount: parsedAmount,
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
