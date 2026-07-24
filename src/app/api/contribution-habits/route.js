import { verifyAuth, getPublicSupabase } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;
    const publicSupabase = getPublicSupabase();

    // 1. Fetch user's SACCO group and database settings
    let settings = {
      sharePrice: 5000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false
    };

    const { data: profile } = await publicSupabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    const cleanGroupCode = (profile?.group_id || '').trim();

    if (cleanGroupCode) {
      const { data: setRows } = await publicSupabase
        .from('sacco_settings')
        .select('share_price, devt_fund, social_fund, current_week, meeting_day, is_locked')
        .ilike('group_code', cleanGroupCode)
        .limit(1);

      if (setRows && setRows.length > 0) {
        const s = setRows[0];
        settings = {
          sharePrice: Number(s.share_price) || 5000,
          devtFund: Number(s.devt_fund) || 1000,
          socialFund: Number(s.social_fund) || 2000,
          currentWeek: Number(s.current_week) || 1,
          meetingDay: s.meeting_day || "Wednesday",
          isLocked: Boolean(s.is_locked)
        };
      } else {
        const { data: saccoRows } = await publicSupabase
          .from('saccos')
          .select('share_price, devt_fund, social_fund, current_week, meeting_day, is_locked')
          .ilike('group_code', cleanGroupCode)
          .limit(1);

        if (saccoRows && saccoRows.length > 0) {
          const sacco = saccoRows[0];
          settings = {
            sharePrice: Number(sacco.share_price) || 5000,
            devtFund: Number(sacco.devt_fund) || 1000,
            socialFund: Number(sacco.social_fund) || 2000,
            currentWeek: Number(sacco.current_week) || 1,
            meetingDay: sacco.meeting_day || "Wednesday",
            isLocked: Boolean(sacco.is_locked)
          };
        }
      }
    }

    let saccoCreatedAt = null;
    if (cleanGroupCode) {
      const { data: saccoInfoRows } = await publicSupabase
        .from('saccos')
        .select('created_at')
        .ilike('group_code', cleanGroupCode)
        .limit(1);
      if (saccoInfoRows && saccoInfoRows.length > 0) {
        saccoCreatedAt = saccoInfoRows[0].created_at;
      }
    }

    // 2. Query transactions for current year via publicSupabase service layer
    const urlObj = new URL(request.url);
    const targetMemberId = urlObj.searchParams.get('memberId') || user.id;

    const startOfYear = `${new Date().getFullYear()}-01-01`;

    let query = publicSupabase
      .from('transactions')
      .select('*')
      .eq('profile_id', targetMemberId)
      .in('category', ['shares', 'development_fund', 'social_fund', 'devt', 'social', 'savings', 'fines', 'fine', 'penalty', 'absenteeism'])
      .in('status', ['completed', 'approved', 'pending'])
      .gte('created_at', startOfYear)
      .order('created_at', { ascending: true });

    const { data: transactions, error: txErr } = await query;

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    return Response.json({ transactions: transactions || [], settings, saccoCreatedAt });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
