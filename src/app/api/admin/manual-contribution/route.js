import { verifyAdmin } from '../../../../lib/auth';

export async function POST(request) {
  try {
    // 1. Authenticate caller and verify admin role
    const auth = await verifyAdmin(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // Load request body
    const body = await request.json();
    const { memberId, amount, category, weekNum, termMonths, purpose, loanType } = body;

    // Server-side validation
    if (!memberId || !amount || !category || !weekNum) {
      return Response.json({ error: 'Missing required fields: memberId, amount, category, weekNum.' }, { status: 400 });
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return Response.json({ error: 'Amount must be a positive number greater than 0.' }, { status: 400 });
    }

    const parsedWeekNum = Number(weekNum);
    if (isNaN(parsedWeekNum) || parsedWeekNum < 1 || parsedWeekNum > 52 || !Number.isInteger(parsedWeekNum)) {
      return Response.json({ error: 'Week number must be an integer between 1 and 52.' }, { status: 400 });
    }

    if (category === 'loan_disbursement') {
      const parsedTerm = Number(termMonths);
      if (termMonths !== undefined && (isNaN(parsedTerm) || parsedTerm <= 0 || !Number.isInteger(parsedTerm))) {
        return Response.json({ error: 'Term months must be a positive integer.' }, { status: 400 });
      }
    }

    // 2. Retrieve caller's profile to get group_id
    const { data: callerProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !callerProfile) {
      return Response.json({ error: 'Could not find your SACCO admin profile.' }, { status: 400 });
    }

    // 3. Retrieve SACCO ID matching caller's group_id
    const { data: sacco, error: saccoErr } = await supabase
      .from('saccos')
      .select('id')
      .eq('group_code', callerProfile.group_id)
      .limit(1)
      .single();

    if (saccoErr || !sacco) {
      return Response.json({ error: 'Could not find active SACCO group for this admin.' }, { status: 400 });
    }

    // 4. Duplicate Check: Ensure member has no existing completed/approved transaction of this type in this week
    const weekPattern = `%| Week ${parsedWeekNum}`;
    const { data: existingTx, error: checkErr } = await supabase
      .from('transactions')
      .select('id')
      .eq('profile_id', memberId)
      .eq('category', category)
      .in('status', ['completed', 'approved'])
      .ilike('description', weekPattern)
      .limit(1);

    if (checkErr) {
      return Response.json({ error: 'Database check failed: ' + checkErr.message }, { status: 500 });
    }

    if (existingTx && existingTx.length > 0) {
      return Response.json({
        error: `Member already has a completed ${
          category === 'shares'
            ? 'shares'
            : category === 'development_fund'
            ? 'development fund'
            : category === 'social_fund'
            ? 'social fund'
            : 'loan disbursement'
        } contribution logged for Week ${parsedWeekNum}.`
      }, { status: 400 });
    }

    // 5. Check if we are logging a loan disbursement
    if (category === 'loan_disbursement') {
      // Ensure member does not have an active or issued loan
      const { data: activeLoan, error: activeLoanErr } = await supabase
        .from('loans')
        .select('id')
        .eq('profile_id', memberId)
        .in('status', ['issued', 'active'])
        .limit(1);

      if (activeLoan && activeLoan.length > 0) {
        return Response.json({ error: 'Member already has an active or issued loan.' }, { status: 400 });
      }

      // Get member's loan account
      const { data: account, error: accErr } = await supabase
        .from('accounts')
        .select('id, balance')
        .eq('profile_id', memberId)
        .eq('account_type', 'loan')
        .limit(1)
        .single();

      if (accErr || !account) {
        return Response.json({ error: 'Could not find an initialized loan account for the selected member.' }, { status: 400 });
      }

      // Calculate parameters
      const parsedTerm = Number(termMonths) || 1;
      const parsedPurpose = purpose || 'Onboarded historical loan';
      const parsedLoanType = loanType || 'normal';
      const interestRate = parsedLoanType === 'social_fund' ? 0.00 : 5.00;

      // Insert Loan record
      const { data: newLoan, error: loanInsertErr } = await supabase
        .from('loans')
        .insert({
          sacco_id: sacco.id,
          profile_id: memberId,
          amount_requested: parsedAmount,
          amount_approved: parsedAmount,
          outstanding_balance: parsedAmount,
          interest_rate: interestRate,
          term_months: parsedTerm,
          purpose: parsedPurpose,
          loan_type: parsedLoanType,
          status: 'issued',
          requested_at: new Date().toISOString(),
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          disbursed_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (loanInsertErr || !newLoan) {
        return Response.json({ error: 'Failed to create loan record: ' + (loanInsertErr?.message || 'Unknown error') }, { status: 500 });
      }

      // Insert corresponding Completed Transaction
      const newTx = {
        sacco_id: sacco.id,
        profile_id: memberId,
        account_id: account.id,
        loan_id: newLoan.id,
        amount: parsedAmount,
        direction: 'debit',
        category: 'loan_disbursement',
        status: 'completed',
        description: `Manual loan onboarding: ${parsedLoanType === 'social_fund' ? 'Social Fund' : 'Normal'} | Week ${parsedWeekNum}`,
        requested_by: user.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        completed_at: new Date().toISOString()
      };

      const { data: txResult, error: insertErr } = await supabase
        .from('transactions')
        .insert(newTx)
        .select('id')
        .single();

      if (insertErr) {
        return Response.json({ error: 'Failed to record loan disbursement transaction: ' + insertErr.message }, { status: 500 });
      }

      // Update loan balance
      const newBalance = Number(account.balance) + parsedAmount;
      const { error: balanceErr } = await supabase
        .from('accounts')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', account.id);

      if (balanceErr) {
        return Response.json({ error: 'Failed to update member loan balance: ' + balanceErr.message }, { status: 500 });
      }

      return Response.json({ success: true, transactionId: txResult.id, loanId: newLoan.id });
    } else {
      // 5. Get member's account ID for the target category (shares, dev, social)
      const { data: account, error: accErr } = await supabase
        .from('accounts')
        .select('id, balance')
        .eq('profile_id', memberId)
        .eq('account_type', category)
        .limit(1)
        .single();

      if (accErr || !account) {
        return Response.json({ error: `Could not find an initialized ${category} account for the selected member.` }, { status: 400 });
      }

      // 6. Insert dynamic completed transaction
      const newTx = {
        sacco_id: sacco.id,
        profile_id: memberId,
        account_id: account.id,
        amount: parsedAmount,
        direction: 'credit',
        category: category,
        status: 'completed',
        description: `Manual contribution log by admin: ${category === 'shares' ? 'Shares' : category === 'development_fund' ? 'Development Fund' : 'Social Fund'} | Week ${parsedWeekNum}`,
        requested_by: user.id
      };

      const { data: txResult, error: insertErr } = await supabase
        .from('transactions')
        .insert(newTx)
        .select('id')
        .single();

      if (insertErr) {
        return Response.json({ error: 'Failed to record transaction: ' + insertErr.message }, { status: 500 });
      }

      // 7. Update member's account balance atomically
      const newBalance = Number(account.balance) + parsedAmount;
      const { error: balanceErr } = await supabase
        .from('accounts')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', account.id);

      if (balanceErr) {
        return Response.json({ error: 'Failed to update member balance ledger: ' + balanceErr.message }, { status: 500 });
      }

      return Response.json({ success: true, transactionId: txResult.id });
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
