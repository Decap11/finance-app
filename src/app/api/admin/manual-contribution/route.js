import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

// Everything a SACCO could plausibly have on paper before it was onboarded. Kept in
// step with the CHECK inside log_historical_record so a bad value is rejected here with
// a readable message rather than as a raw Postgres exception.
const BACKFILLABLE = new Set([
  'shares',
  'development_fund',
  'social_fund',
  'savings',
  'fines',
  'loan_disbursement',
  'loan_repayment',
  'dividend'
]);

// The anon key plus the caller's JWT, deliberately. log_historical_record is
// SECURITY DEFINER and resolves the caller through auth.uid(); handing it a service-role
// client would leave auth.uid() null and every call would abort on the first check.
function clientFor(token) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function bearer(request) {
  return request.headers.get('authorization')?.split(' ')[1] || null;
}

export async function POST(request) {
  try {
    const token = bearer(request);
    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = clientFor(token);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const body = await request.json();
    const {
      memberId,
      amount,
      category,
      occurredOn,
      description,
      fineType,
      loanId,
      loanType,
      termMonths,
      purpose,
      interestRate
    } = body;

    if (!memberId || !category || !occurredOn) {
      return Response.json(
        { error: 'Missing required fields: memberId, category and occurredOn (the date it happened).' },
        { status: 400 }
      );
    }

    if (!BACKFILLABLE.has(category)) {
      return Response.json({ error: `Cannot backfill a record of type "${category}".` }, { status: 400 });
    }

    // Checked before the round trip because `Number(undefined)` is NaN, which Postgres
    // would reject with a message about types rather than about the amount.
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return Response.json({ error: 'Amount must be a number greater than zero.' }, { status: 400 });
    }

    // Postgres will take any date it can parse, including '2026-13-45' style nonsense
    // that JS coerces. Pin the shape here so the error names the real problem.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(occurredOn))) {
      return Response.json({ error: 'occurredOn must be a date in YYYY-MM-DD form.' }, { status: 400 });
    }

    // Authorization, same-SACCO checks, atomicity, balances and loan side effects all
    // live in the function -- see migration 0028 for why none of it can be done from
    // here under RLS.
    const { data, error: rpcErr } = await supabase.rpc('log_historical_record', {
      p_member_id: memberId,
      p_category: category,
      p_amount: parsedAmount,
      p_occurred_on: occurredOn,
      p_description: description || null,
      p_fine_type: fineType || null,
      p_loan_id: loanId || null,
      p_loan_type: loanType || 'normal',
      p_term_months: termMonths ? Number(termMonths) : 1,
      p_purpose: purpose || null,
      p_interest_rate: interestRate === undefined || interestRate === null ? null : Number(interestRate)
    });

    if (rpcErr) {
      // Every RAISE EXCEPTION in the function is written to be shown to the admin as-is,
      // so the message is passed straight through. 400 rather than 500: these are
      // rejections of what was typed, not server faults.
      // Only claim the migration is missing when the function itself cannot be found.
      // This used to test the message for "does not exist" alone, which also matches
      // every undefined column or relation raised from *inside* a function that is
      // present -- so a missing transactions.reference column (see 0029) was reported
      // for days as an unapplied 0028, sending everyone to re-run a migration that had
      // already been applied. PGRST202 is PostgREST failing to resolve the function;
      // 42883 is Postgres's undefined_function, which needs the name checked too.
      const message = rpcErr.message || '';
      const missing =
        rpcErr.code === 'PGRST202' ||
        (rpcErr.code === '42883' && /log_historical_record/i.test(message));

      return Response.json(
        {
          error: missing
            ? 'Historical onboarding is not available yet: migration 0028 has not been applied to this database.'
            : message,
          // Surfaced so the next schema gap names itself instead of hiding behind a
          // generic failure. Postgres puts the offending column in `details`/`hint`.
          ...(missing ? {} : { code: rpcErr.code, details: rpcErr.details, hint: rpcErr.hint })
        },
        { status: missing ? 503 : 400 }
      );
    }

    return Response.json({ success: true, ...(data || {}) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// The repayment picker needs the member's open loans, and needs exactly the set
// log_historical_record will accept a repayment against.
export async function GET(request) {
  try {
    const token = bearer(request);
    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = clientFor(token);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const memberId = new URL(request.url).searchParams.get('memberId');
    if (!memberId) {
      return Response.json({ error: 'memberId is required.' }, { status: 400 });
    }

    const { data: loans, error: rpcErr } = await supabase.rpc('get_member_open_loans', {
      p_member_id: memberId
    });

    if (rpcErr) {
      // A missing function here only costs the picker its options, so it degrades to an
      // empty list rather than blocking the rest of the form.
      if (/does not exist/i.test(rpcErr.message || '')) {
        return Response.json({ loans: [] });
      }
      return Response.json({ error: rpcErr.message }, { status: 400 });
    }

    return Response.json({ loans: loans || [] });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
