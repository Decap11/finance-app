import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // Call the SECURITY DEFINER RPC to bypass RLS and sum balances securely for all members
    const { data: accounts, error: rpcErr } = await supabase
      .rpc('get_sacco_total_balances', { p_profile_id: user.id });

    if (rpcErr) {
      return Response.json({ error: rpcErr.message }, { status: 500 });
    }

    // Fallback/Format output to match frontend expectations
    const formattedAccounts = [
      { account_type: 'shares', balance: 0 },
      { account_type: 'development_fund', balance: 0 },
      { account_type: 'social_fund', balance: 0 }
    ];

    if (accounts) {
      accounts.forEach(acc => {
        const match = formattedAccounts.find(fa => fa.account_type === acc.account_type);
        if (match) {
          match.balance = Math.max(0, Number(acc.balance) || 0);
        }
      });
    }

    return Response.json({ accounts: formattedAccounts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
