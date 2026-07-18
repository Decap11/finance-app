import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // 1. Fetch user's SACCO group and database settings
    let settings = {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    };

    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (profile?.group_id) {
      const { data: sacco } = await supabase
        .from('saccos')
        .select('share_price, devt_fund, social_fund, current_week, is_locked')
        .eq('group_code', profile.group_id)
        .limit(1)
        .single();

      if (sacco) {
        settings = {
          sharePrice: Number(sacco.share_price) || 25000,
          devtFund: Number(sacco.devt_fund) || 1000,
          socialFund: Number(sacco.social_fund) || 2000,
          currentWeek: Number(sacco.current_week) || 1,
          isLocked: Boolean(sacco.is_locked)
        };
      }
    }

    // 2. Query transactions for current year
    const startOfYear = `${new Date().getFullYear()}-01-01`;

    const { data: transactions, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', user.id)
      .in('category', ['shares', 'development_fund', 'social_fund'])
      .eq('direction', 'credit')
      .in('status', ['completed', 'approved'])
      .gte('created_at', startOfYear)
      .order('created_at', { ascending: true });

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    return Response.json({ transactions, settings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
