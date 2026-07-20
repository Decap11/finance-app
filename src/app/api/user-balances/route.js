import { verifyAuth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // 1. High-Performance SQL Aggregation RPC (<5ms execution)
    const { data: rpcRows } = await supabase.rpc('get_user_ledger_balances', { p_profile_id: user.id });

    if (rpcRows && rpcRows.length > 0) {
      const rpc = rpcRows[0];
      return Response.json({
        accounts: [
          { account_type: 'shares', balance: Number(rpc.total_shares) || 0 },
          { account_type: 'development_fund', balance: Number(rpc.total_devt) || 0 },
          { account_type: 'social_fund', balance: Number(rpc.total_social) || 0 }
        ]
      });
    }

    // 2. Resilient Fallback Calculation
    const { data: transactions } = await supabase
      .from('transactions')
      .select('amount, direction, category')
      .eq('profile_id', user.id)
      .in('status', ['completed', 'approved']);

    const balances = { shares: 0, development_fund: 0, social_fund: 0 };
    if (transactions) {
      transactions.forEach(tx => {
        const cat = tx.category === 'devt' ? 'development_fund' : (tx.category === 'social' ? 'social_fund' : tx.category);
        if (balances[cat] !== undefined) {
          const amt = Number(tx.amount) || 0;
          if (tx.direction === 'credit') balances[cat] += amt;
          else if (tx.direction === 'debit') balances[cat] -= amt;
        }
      });
    }

    const accounts = Object.keys(balances).map(key => ({
      account_type: key,
      balance: Math.max(0, balances[key])
    }));

    return Response.json({ accounts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
