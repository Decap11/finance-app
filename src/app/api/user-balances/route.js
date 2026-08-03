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
      social_fund: 0,
      // What this member has actually paid in fines. It is reported, never folded into
      // their contributed total -- a fine is a penalty, not savings, and showing it as
      // part of someone's stake in the SACCO would overstate what they are owed.
      fines: 0
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
      balance: Math.max(0, balances[key]) // Balance cannot be negative
    }));

    return Response.json({ accounts });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
