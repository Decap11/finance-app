import { verifyAuth, verifyAdmin } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.error) {
      const { user, supabase } = auth;

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      const cleanGroupCode = (profile?.group_id || '').trim();

      if (cleanGroupCode) {
        // Query saccos table case-insensitively
        const { data: saccoRows } = await supabase
          .from('saccos')
          .select('*')
          .ilike('group_code', cleanGroupCode)
          .limit(1);

        let sacco = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;

        // Fallback: If group_code didn't match, check by admin_profile_id or first sacco
        if (!sacco) {
          const { data: fallbackRows } = await supabase
            .from('saccos')
            .select('*')
            .limit(1);
          if (fallbackRows && fallbackRows.length > 0) {
            sacco = fallbackRows[0];
          }
        }

        if (sacco) {
          return Response.json({
            sharePrice: sacco.share_price !== undefined && sacco.share_price !== null ? Number(sacco.share_price) : 25000,
            devtFund: sacco.devt_fund !== undefined && sacco.devt_fund !== null ? Number(sacco.devt_fund) : 1000,
            socialFund: sacco.social_fund !== undefined && sacco.social_fund !== null ? Number(sacco.social_fund) : 2000,
            currentWeek: sacco.current_week !== undefined && sacco.current_week !== null ? Number(sacco.current_week) : 1,
            isLocked: Boolean(sacco.is_locked)
          });
        }
      }
    }

    // Default fallback if unauthenticated or sacco settings not yet initialized
    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    });
  } catch (err) {
    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    });
  }
}

export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;
    const body = await request.json();
    const { sharePrice, devtFund, socialFund, currentWeek, isLocked } = body;

    const parsedSharePrice = Number(sharePrice);
    const parsedDevtFund = Number(devtFund);
    const parsedSocialFund = Number(socialFund);
    const parsedCurrentWeek = Number(currentWeek);

    if (isNaN(parsedSharePrice) || parsedSharePrice < 0) {
      return Response.json({ error: 'Share price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedDevtFund) || parsedDevtFund < 0) {
      return Response.json({ error: 'Development fund price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedSocialFund) || parsedSocialFund < 0) {
      return Response.json({ error: 'Social fund price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedCurrentWeek) || parsedCurrentWeek < 1 || parsedCurrentWeek > 52 || !Number.isInteger(parsedCurrentWeek)) {
      return Response.json({ error: 'Current week must be an integer between 1 and 52.' }, { status: 400 });
    }

    // Fetch admin's linked SACCO group_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (!profile?.group_id) {
      return Response.json({ error: 'Could not find your associated SACCO group.' }, { status: 400 });
    }

    const cleanGroupCode = (profile.group_id || '').trim();

    // 1. Try updating matching group_code in public.saccos table
    const { data: updateData, error: updateErr } = await supabase
      .from('saccos')
      .update({
        share_price: parsedSharePrice,
        devt_fund: parsedDevtFund,
        social_fund: parsedSocialFund,
        current_week: parsedCurrentWeek,
        is_locked: Boolean(isLocked),
        updated_at: new Date().toISOString()
      })
      .ilike('group_code', cleanGroupCode)
      .select();

    if (updateErr) {
      console.warn("Database saccos table settings update warning:", updateErr.message);
    }

    // 2. If 0 rows were updated by group_code, attempt update by admin_profile_id
    if (!updateData || updateData.length === 0) {
      await supabase
        .from('saccos')
        .update({
          share_price: parsedSharePrice,
          devt_fund: parsedDevtFund,
          social_fund: parsedSocialFund,
          current_week: parsedCurrentWeek,
          is_locked: Boolean(isLocked),
          updated_at: new Date().toISOString()
        })
        .eq('admin_profile_id', user.id);
    }

    const newSettings = {
      sharePrice: parsedSharePrice,
      devtFund: parsedDevtFund,
      socialFund: parsedSocialFund,
      currentWeek: parsedCurrentWeek,
      isLocked: Boolean(isLocked)
    };

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
