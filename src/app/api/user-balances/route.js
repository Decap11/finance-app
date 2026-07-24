import { verifyAuth, getPublicSupabase } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;
    const publicSupabase = getPublicSupabase();

    const categorySums = {
      shares: 0,
      development_fund: 0,
      social_fund: 0,
      fines: 0
    };

    // 1. Primary Ledger: Calculate aggregate totals directly from transactions using authenticated user client (passes RLS checks!)
    let txs = [];
    const { data: userTxs } = await supabase
      .from('transactions')
      .select('amount, direction, category, status')
      .eq('profile_id', user.id)
      .in('status', ['completed', 'approved']);

    if (userTxs && userTxs.length > 0) {
      txs = userTxs;
    } else {
      const { data: pubTxs } = await publicSupabase
        .from('transactions')
        .select('amount, direction, category, status')
        .eq('profile_id', user.id)
        .in('status', ['completed', 'approved']);
      if (pubTxs) txs = pubTxs;
    }

    if (txs && txs.length > 0) {
      txs.forEach(tx => {
        let cat = (tx.category || '').toLowerCase();
        if (cat === 'devt' || cat === 'devt_fund' || cat === 'development') cat = 'development_fund';
        if (cat === 'social' || cat === 'social_fund') cat = 'social_fund';
        if (cat === 'savings' || cat === 'shares_pool') cat = 'shares';
        if (cat === 'fine' || cat === 'fines' || cat === 'penalty' || cat === 'absenteeism') cat = 'fines';

        if (categorySums[cat] !== undefined) {
          const amt = Number(tx.amount) || 0;
          const dir = (tx.direction || 'credit').toLowerCase();
          if (dir === 'credit') {
            categorySums[cat] += amt;
          } else if (dir === 'debit') {
            categorySums[cat] -= amt;
          }
        }
      });
    }

    // 2. Secondary Ledger: Compare with initialized accounts table balances using authenticated user client
    let accs = [];
    const { data: userAccs } = await supabase
      .from('accounts')
      .select('account_type, balance')
      .eq('profile_id', user.id);

    if (userAccs && userAccs.length > 0) {
      accs = userAccs;
    } else {
      const { data: pubAccs } = await publicSupabase
        .from('accounts')
        .select('account_type, balance')
        .eq('profile_id', user.id);
      if (pubAccs) accs = pubAccs;
    }

    if (accs && accs.length > 0) {
      accs.forEach(acc => {
        let cat = (acc.account_type || '').toLowerCase();
        if (cat === 'devt' || cat === 'devt_fund' || cat === 'development') cat = 'development_fund';
        if (cat === 'social' || cat === 'social_fund') cat = 'social_fund';
        if (cat === 'savings' || cat === 'shares_pool') cat = 'shares';

        if (categorySums[cat] !== undefined) {
          const accBal = Number(acc.balance) || 0;
          categorySums[cat] = Math.max(categorySums[cat], accBal);
        }
      });
    }

    // 3. Database RPC Fallback: Query stored procedure if categorySums are 0
    if (categorySums.shares === 0 && categorySums.development_fund === 0 && categorySums.social_fund === 0) {
      const { data: rpcRows } = await supabase.rpc('get_user_ledger_balances', { p_profile_id: user.id });
      if (rpcRows && rpcRows.length > 0) {
        const rpc = rpcRows[0];
        const rpcShares = Number(rpc.total_shares) || 0;
        const rpcDevt = Number(rpc.total_devt) || Number(rpc.total_devt_fund) || 0;
        const rpcSocial = Number(rpc.total_social) || Number(rpc.total_social_fund) || 0;
        const rpcGrand = Number(rpc.grand_total) || 0;

        categorySums.shares = Math.max(categorySums.shares, rpcShares);
        categorySums.development_fund = Math.max(categorySums.development_fund, rpcDevt);
        categorySums.social_fund = Math.max(categorySums.social_fund, rpcSocial);

        if (categorySums.shares === 0 && categorySums.development_fund === 0 && categorySums.social_fund === 0 && rpcGrand > 0) {
          categorySums.shares = rpcGrand;
        }
      }
    }

    const accounts = [
      { account_type: 'shares', balance: Math.max(0, categorySums.shares) },
      { account_type: 'development_fund', balance: Math.max(0, categorySums.development_fund) },
      { account_type: 'social_fund', balance: Math.max(0, categorySums.social_fund) }
    ];

    return Response.json({ accounts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
