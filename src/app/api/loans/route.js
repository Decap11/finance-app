import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// `loans` has no created_at column -- it records requested_at. Ordering by created_at
// made PostgREST answer 400, so this GET never returned a loan, and the request flow
// used the same ordering to re-find the loan it had just created.
const LOAN_ORDER_COLUMN = 'requested_at';

const OPEN_LOAN_STATUSES = [
  'pending_fee',
  'pending_guarantors',
  'pending',
  'approved',
  'disbursed',
  'issued',
  'active',
  'overdue'
];

const REPAYABLE_STATUSES = ['issued', 'active', 'disbursed', 'overdue'];

function clientFor(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

async function authenticate(request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    return { error: Response.json({ error: 'No authorization token provided.' }, { status: 401 }) };
  }

  const supabase = clientFor(token);
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { error: Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 }) };
  }

  return { supabase, user };
}

async function resolveSacco(supabase, userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('group_id, role')
    .eq('id', userId)
    .single();

  if (!profile?.group_id) return { error: 'Could not find your SACCO profile.' };

  const { data: sacco } = await supabase
    .from('saccos')
    .select('id, group_code, loan_application_fee, loan_late_fee_amount, loan_min_guarantors')
    .ilike('group_code', profile.group_id.trim())
    .limit(1)
    .maybeSingle();

  if (!sacco) return { error: 'Could not find your SACCO group.' };

  return { sacco, profile };
}

export async function GET(request) {
  try {
    const { supabase, user, error } = await authenticate(request);
    if (error) return error;

    // No limit(1). A member may hold a normal loan and a Social Fund emergency loan at
    // the same time, so returning only the newest would hide the other one entirely --
    // including from the repayment form.
    const { data: loans, error: loanErr } = await supabase
      .from('loans')
      .select('*')
      .eq('profile_id', user.id)
      .in('status', OPEN_LOAN_STATUSES)
      .order(LOAN_ORDER_COLUMN, { ascending: false });

    if (loanErr) {
      return Response.json({ error: loanErr.message }, { status: 500 });
    }

    const activeLoans = loans || [];
    const activeLoan = activeLoans.length > 0 ? activeLoans[0] : null;

    // Who has signed and who has not, so a member waiting on approval can see which of
    // their guarantors is holding it up rather than staring at "pending".
    let guarantors = [];
    let repayments = [];

    if (activeLoans.length > 0) {
      const loanIds = activeLoans.map((l) => l.id);

      const [{ data: gRows }, { data: rRows }] = await Promise.all([
        supabase
          .from('loan_guarantors')
          .select('id, loan_id, status, guaranteed_amount, responded_at, guarantor:profiles!guarantor_profile_id(full_name, member_number)')
          .in('loan_id', loanIds),
        supabase
          .from('loan_repayments')
          .select('id, loan_id, amount, paid_at')
          .in('loan_id', loanIds)
          .order('paid_at', { ascending: false })
      ]);

      // Each loan carries its own, so a caller showing two loans side by side cannot
      // credit one loan's installments to the other.
      for (const loan of activeLoans) {
        loan.guarantors = (gRows || []).filter((g) => g.loan_id === loan.id);
        loan.repayments = (rRows || []).filter((r) => r.loan_id === loan.id);
      }

      guarantors = activeLoan.guarantors;
      repayments = activeLoan.repayments;
    }

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', user.id)
      .in('category', ['loan_disbursement', 'loan_repayment'])
      .order('created_at', { ascending: false })
      .limit(5);

    const { sacco } = await resolveSacco(supabase, user.id);

    return Response.json({
      activeLoans,
      // The newest of them. Kept because a caller that only ever shows one loan is still
      // correct for the common case of a member holding exactly one.
      activeLoan,
      guarantors,
      repayments,
      recentTransactions: transactions || [],
      rules: sacco
        ? {
            applicationFee: Number(sacco.loan_application_fee) || 0,
            lateFeeAmount: Number(sacco.loan_late_fee_amount) || 0,
            minGuarantors: Number(sacco.loan_min_guarantors) || 3
          }
        : null
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { supabase, user, error } = await authenticate(request);
    if (error) return error;

    const body = await request.json();
    const { action, amount, purpose, termMonths, loanType, interestRate, dueDate, guarantors, loanId } = body;

    if (action === 'request_loan') {
      const { sacco, error: saccoError } = await resolveSacco(supabase, user.id);
      if (saccoError) return Response.json({ error: saccoError }, { status: 400 });

      const minGuarantors = Number(sacco.loan_min_guarantors) || 3;
      const chosen = Array.isArray(guarantors)
        ? [...new Set(guarantors.filter((g) => g && g !== user.id))]
        : [];

      // Repeated here only for a clearer message. request_loan enforces it for real --
      // a rule about who carries someone else's liability cannot live in the browser.
      if (chosen.length < minGuarantors) {
        return Response.json({
          error: `This loan needs at least ${minGuarantors} guarantors from your SACCO. You selected ${chosen.length}.`
        }, { status: 400 });
      }

      // Guarantors go in with the loan, in one call. They used to be inserted afterwards
      // by a statement that re-found the loan through a column that does not exist, so
      // every nomination was silently dropped.
      const { data: result, error: rpcError } = await supabase.rpc('request_loan', {
        p_sacco_id: sacco.id,
        p_amount: Number(amount),
        p_term_months: termMonths ? Number(termMonths) : null,
        p_purpose: purpose,
        p_loan_type: loanType || 'normal',
        p_interest_rate: Number(interestRate) || 0,
        p_due_date: dueDate || null,
        p_guarantors: chosen
      });

      if (rpcError) {
        return Response.json({ error: rpcError.message }, { status: 400 });
      }

      const fee = Number(result?.application_fee) || 0;

      return Response.json({
        success: true,
        ...result,
        message: fee > 0
          ? `Request submitted. An application fee of UGX ${fee.toLocaleString()} is due — once an admin confirms it, your ${chosen.length} guarantors are asked to approve.`
          : `Request submitted. Your ${chosen.length} guarantors have been asked to approve.`
      });
    }

    if (action === 'repay_loan') {
      let targetLoanId = loanId;

      if (!targetLoanId) {
        const { data: loans } = await supabase
          .from('loans')
          .select('id, loan_type')
          .eq('profile_id', user.id)
          .in('status', REPAYABLE_STATUSES)
          .order(LOAN_ORDER_COLUMN, { ascending: false });

        if (!loans || loans.length === 0) {
          return Response.json({ error: 'You have no loan open for repayment.' }, { status: 400 });
        }

        // A member may be repaying a normal loan and a Social Fund emergency loan at the
        // same time. Guessing the newest would credit money to the wrong debt, so an
        // unspecified repayment is refused rather than misapplied.
        if (loans.length > 1) {
          return Response.json({
            error: 'You have more than one loan open. Choose which one this installment is for.'
          }, { status: 400 });
        }

        targetLoanId = loans[0].id;
      }

      const { data: result, error: rpcError } = await supabase.rpc('record_loan_repayment', {
        p_loan_id: targetLoanId,
        p_amount: Number(amount)
      });

      if (rpcError) {
        return Response.json({ error: rpcError.message }, { status: 400 });
      }

      return Response.json({
        success: true,
        ...result,
        message: 'Installment submitted. Your balance drops once an admin confirms it.'
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// Staff actions: confirming an application fee, and sweeping for late charges.
export async function PATCH(request) {
  try {
    const { supabase, user, error } = await authenticate(request);
    if (error) return error;

    const { action, loanId } = await request.json();

    if (action === 'confirm_fee') {
      if (!loanId) {
        return Response.json({ error: 'Missing loanId.' }, { status: 400 });
      }

      const { error: rpcErr } = await supabase.rpc('confirm_loan_application_fee', {
        p_loan_id: loanId
      });

      if (rpcErr) {
        return Response.json({ error: rpcErr.message }, { status: 400 });
      }

      return Response.json({
        success: true,
        message: 'Application fee confirmed. The guarantors have been asked to approve.'
      });
    }

    if (action === 'apply_late_fees') {
      const { sacco, error: saccoError } = await resolveSacco(supabase, user.id);
      if (saccoError) return Response.json({ error: saccoError }, { status: 400 });

      const { data: result, error: rpcErr } = await supabase.rpc('apply_loan_late_fees', {
        p_sacco_id: sacco.id
      });

      if (rpcErr) {
        return Response.json({ error: rpcErr.message }, { status: 400 });
      }

      return Response.json({ success: true, ...result });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
