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

    // Call the SECURITY DEFINER RPCs to bypass RLS and aggregate securely across all
    // members. Both read the same ledger, so they are issued together.
    const [
      { data: accounts, error: rpcErr },
      { data: trendRows, error: trendErr },
      { data: positionRows, error: positionErr }
    ] = await Promise.all([
      supabase.rpc('get_sacco_total_balances', { p_profile_id: user.id }),
      supabase.rpc('get_sacco_capital_trend', { p_profile_id: user.id }),
      supabase.rpc('get_sacco_capital_position', { p_profile_id: user.id })
    ]);

    if (rpcErr) {
      return Response.json({ error: rpcErr.message }, { status: 500 });
    }

    // The trend is the small print under one card; the balances are the page. A database
    // that has not had 0027 applied yet fails this RPC with "function does not exist",
    // and blanking every fund total over a missing percentage would be the wrong trade.
    // The card falls back to showing no change indicator at all.
    let trend = null;
    if (trendErr) {
      console.warn('Capital trend unavailable (is migration 0027 applied?):', trendErr.message);
    } else if (trendRows?.length) {
      const row = trendRows[0];
      const opening = Number(row.opening_capital) || 0;
      const currentNet = Number(row.current_week_net) || 0;

      trend = {
        openingCapital: opening,
        currentWeekNet: currentNet,
        previousWeekNet: Number(row.previous_week_net) || 0,
        weekStart: row.week_start,
        // A SACCO in its first week has nothing to grow from. Dividing by zero would
        // report an infinite rise off a zero base, so the percentage is withheld and
        // the card says so rather than inventing a figure.
        percentChange: opening > 0 ? (currentNet / opening) * 100 : null
      };
    }

    // Fallback/Format output to match frontend expectations
    const formattedAccounts = [
      { account_type: 'shares', balance: 0 },
      { account_type: 'development_fund', balance: 0 },
      { account_type: 'social_fund', balance: 0 },
      // Collected fines of every kind -- absence, late arrival, anything else. The pool
      // is one pot because the cash is; the breakdown by reason lives in the fines
      // manager, which is where anyone asking "what were these for" will look.
      { account_type: 'fines', balance: 0 }
    ];

    if (accounts) {
      accounts.forEach(acc => {
        const match = formattedAccounts.find(fa => fa.account_type === acc.account_type);
        if (match) {
          match.balance = Math.max(0, Number(acc.balance) || 0);
        }
      });
    }

    // The pools above say what was contributed by category. They do not say what is left:
    // a loan leaves the box as a 'loan_disbursement' row, which is in none of those
    // categories, so the four figures keep climbing whether or not the money is still
    // there. This is the cash position -- what the SACCO actually holds today, and how
    // much of the pot is currently sitting with borrowers.
    //
    // Degraded the same way as the trend, and for the same reason: a database without
    // 0034 fails this RPC with "function does not exist", and blanking the funds page
    // over it would be the wrong trade. The card falls back to the contributed total.
    let capital = null;
    if (positionErr) {
      console.warn('Capital position unavailable (is migration 0034 applied?):', positionErr.message);
    } else if (positionRows?.length) {
      const row = positionRows[0];
      capital = {
        contributed: Number(row.contributed) || 0,
        disbursedTotal: Number(row.disbursed_total) || 0,
        repaidTotal: Number(row.repaid_total) || 0,
        outOnLoan: Number(row.out_on_loan) || 0,
        // Deliberately not clamped at zero. A SACCO that has lent more than it collected
        // needs to see that, and rounding it up to "0" is how it stays unnoticed.
        onHand: Number(row.on_hand) || 0
      };
    }

    return Response.json({ accounts: formattedAccounts, trend, capital });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
