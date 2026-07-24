import { verifyAuth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // 1. Resolve user's profile and SACCO group
    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    const cleanGroupCode = (profile?.group_id || '').trim();
    let saccoId = null;

    if (cleanGroupCode) {
      const { data: saccoRows } = await supabase
        .from('saccos')
        .select('id')
        .ilike('group_code', cleanGroupCode)
        .limit(1);

      if (saccoRows && saccoRows.length > 0) {
        saccoId = saccoRows[0].id;
      }
    }

    const formattedAccounts = [
      { account_type: 'shares', balance: 0 },
      { account_type: 'development_fund', balance: 0 },
      { account_type: 'social_fund', balance: 0 },
      { account_type: 'fines', balance: 0 }
    ];

    // 2. Call SECURITY DEFINER RPC
    const { data: accounts } = await supabase
      .rpc('get_sacco_total_balances', { p_profile_id: user.id });

    if (accounts && Array.isArray(accounts)) {
      accounts.forEach(acc => {
        let cat = acc.account_type;
        if (cat === 'devt' || cat === 'devt_fund') cat = 'development_fund';
        if (cat === 'social' || cat === 'social_fund') cat = 'social_fund';
        if (cat === 'fine' || cat === 'penalty') cat = 'fines';

        const match = formattedAccounts.find(fa => fa.account_type === cat);
        if (match) {
          match.balance = Math.max(match.balance, Number(acc.balance) || 0);
        }
      });
    }

    // 3. Primary Ledger: Calculate SACCO aggregate totals from transactions strictly for this sacco_id
    if (saccoId) {
      const { data: transactions } = await supabase
        .from('transactions')
        .select('amount, direction, category')
        .eq('sacco_id', saccoId)
        .in('status', ['completed', 'approved']);

      if (transactions && transactions.length > 0) {
        const txTotals = { shares: 0, development_fund: 0, social_fund: 0, fines: 0 };
        transactions.forEach(tx => {
          let cat = tx.category;
          if (cat === 'devt' || cat === 'devt_fund') cat = 'development_fund';
          if (cat === 'social' || cat === 'social_fund') cat = 'social_fund';
          if (cat === 'fine' || cat === 'penalty' || cat === 'absenteeism') cat = 'fines';

          if (txTotals[cat] !== undefined) {
            const amt = Number(tx.amount) || 0;
            if (tx.direction === 'credit') {
              txTotals[cat] += amt;
            } else if (tx.direction === 'debit') {
              txTotals[cat] -= amt;
            }
          }
        });

        formattedAccounts.forEach(fa => {
          if (txTotals[fa.account_type] !== undefined) {
            fa.balance = Math.max(fa.balance, txTotals[fa.account_type]);
          }
        });
      }
    }

    return Response.json({ accounts: formattedAccounts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
