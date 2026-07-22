import { verifyAuth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    const cleanGroupCode = (userProfile.group_id || '').trim();

    // 2. Fetch Sacco details directly from database (case-insensitive & fail-safe)
    const { data: saccoRows, error: saccoErr } = await supabase
      .from('saccos')
      .select('*')
      .ilike('group_code', cleanGroupCode)
      .limit(1);

    let saccoData = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;

    if (!saccoData && cleanGroupCode) {
      const { data: newSacco } = await supabase
        .from('saccos')
        .insert({
          name: `${cleanGroupCode} SACCO`,
          acronym: cleanGroupCode.split('-')[0] || 'SACCO',
          group_code: cleanGroupCode,
          admin_profile_id: user.id,
          share_price: 5000,
          devt_fund: 1000,
          social_fund: 2000,
          current_week: 1,
          meeting_day: 'Wednesday',
          status: 'active'
        })
        .select('*')
        .single();

      saccoData = newSacco;
    }

    if (!saccoData) {
      return Response.json({ error: 'Sacco group metadata not found in database.' }, { status: 400 });
    }

    const currentWeek = Number(saccoData.current_week) || 1;

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

    // Helper to extract or compute week number with fallback to SACCO's current_week
    const getTransactionWeek = (tx, activeSaccoWeek) => {
      if (tx.week_number) return Number(tx.week_number);
      if (tx.description) {
        const match = tx.description.match(/week\s*([0-9]+)/i);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }
      return Number(activeSaccoWeek) || 1;
    };

    // 5. Filter transactions strictly belonging to currentWeek
    const weeklyTransactions = (transactions || []).filter(tx => {
      const txWeek = getTransactionWeek(tx, currentWeek);
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
