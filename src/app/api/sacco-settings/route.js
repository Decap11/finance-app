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

      if (profile?.group_id) {
        const { data: sacco } = await supabase
          .from('saccos')
          .select('share_price, devt_fund, social_fund, current_week, is_locked')
          .eq('group_code', profile.group_id)
          .limit(1)
          .single();

        if (sacco) {
          return Response.json({
            sharePrice: Number(sacco.share_price) || 25000,
            devtFund: Number(sacco.devt_fund) || 1000,
            socialFund: Number(sacco.social_fund) || 2000,
            currentWeek: Number(sacco.current_week) || 1,
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

    // Persist settings in public.saccos database table
    const { error: updateErr } = await supabase
      .from('saccos')
      .update({
        share_price: parsedSharePrice,
        devt_fund: parsedDevtFund,
        social_fund: parsedSocialFund,
        current_week: parsedCurrentWeek,
        is_locked: Boolean(isLocked),
        updated_at: new Date().toISOString()
      })
      .eq('group_code', profile.group_id);

    if (updateErr) {
      return Response.json({ error: 'Failed to update database settings: ' + updateErr.message }, { status: 500 });
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
