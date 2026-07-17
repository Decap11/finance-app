import { promises as fs } from 'fs';
import path from 'path';
import { verifyAuth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // 1. Fetch user's profile group_id
    const { data: userProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !userProfile || !userProfile.group_id) {
      return Response.json({ error: 'Sacco membership not found on profile.' }, { status: 400 });
    }

    // 2. Fetch Sacco ID
    const { data: saccoData, error: saccoErr } = await supabase
      .from('saccos')
      .select('id')
      .eq('group_code', userProfile.group_id)
      .limit(1)
      .single();

    if (saccoErr || !saccoData) {
      return Response.json({ error: 'Sacco group not found.' }, { status: 400 });
    }

    // 3. Read active week from sacco-settings
    let currentWeek = 1;
    try {
      const filePath = path.join(process.cwd(), 'src/app/api/sacco-settings/settings.json');
      const data = await fs.readFile(filePath, 'utf8');
      const settings = JSON.parse(data);
      if (settings && settings.currentWeek) {
        currentWeek = Number(settings.currentWeek);
      }
    } catch (err) {
      console.warn("Failed to load settings file, using fallback currentWeek = 1");
    }

    // 4. Fetch all approved/completed transactions for this SACCO group
    const { data: transactions, error: txErr } = await supabase
      .from('transactions')
      .select(`
        *,
        profiles:profile_id (
          full_name,
          member_number
        )
      `)
      .eq('sacco_id', saccoData.id)
      .in('status', ['approved', 'completed'])
      .order('created_at', { ascending: false });

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    // Helper to extract or compute week number
    const getTransactionWeek = (tx) => {
      if (tx.description) {
        const match = tx.description.match(/week\s*([0-9]+)/i);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }
      const dateObj = new Date(tx.created_at || tx.approved_at || Date.now());
      const startOfYear = new Date(dateObj.getFullYear(), 0, 1);
      const diffInMs = dateObj - startOfYear;
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
      return Math.floor(diffInDays / 7) + 1;
    };

    // 5. Filter transactions strictly belonging to currentWeek
    const weeklyTransactions = (transactions || []).filter(tx => {
      const txWeek = getTransactionWeek(tx);
      return txWeek === currentWeek;
    });

    return Response.json({
      currentWeek,
      transactions: weeklyTransactions
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
