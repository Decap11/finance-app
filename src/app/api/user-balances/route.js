import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // Fetch all completed/approved transactions for the user to compute live ledger balances
    const { data: transactions, error: txErr } = await supabase
      .from('transactions')
      .select('amount, direction, category')
      .eq('profile_id', user.id)
      .in('status', ['completed', 'approved']);

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    const balances = {
      shares: 0,
      development_fund: 0,
      social_fund: 0
    };

    if (transactions) {
      transactions.forEach(tx => {
        const cat = tx.category;
        if (balances[cat] !== undefined) {
          const amt = Number(tx.amount) || 0;
          if (tx.direction === 'credit') {
            balances[cat] += amt;
          } else if (tx.direction === 'debit') {
            balances[cat] -= amt;
          }
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
