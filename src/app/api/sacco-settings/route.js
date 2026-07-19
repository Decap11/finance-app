import { verifyAuth, verifyAdmin } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    let supabaseClient = !auth.error ? auth.supabase : null;
    let groupCode = null;
    let userId = null;

    if (!auth.error && auth.user) {
      userId = auth.user.id;
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single();
      groupCode = (profile?.group_id || '').trim();
    }

    let sacco = null;

    if (supabaseClient) {
      const query = groupCode
        ? `group_code.ilike.${groupCode},admin_profile_id.eq.${userId}`
        : `admin_profile_id.eq.${userId}`;

      const { data: saccoRows } = await supabaseClient
        .from('saccos')
        .select('*')
        .or(query)
        .limit(1);

      sacco = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;
    }

    if (!sacco && supabaseClient) {
      const { data: fallbackRows } = await supabaseClient
        .from('saccos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      sacco = fallbackRows && fallbackRows.length > 0 ? fallbackRows[0] : null;
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

    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    });
  } catch (err) {
    console.warn("GET /api/sacco-settings execution error:", err);
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

    const { user, supabase: userSupabase } = auth;
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

    // 1. Fetch admin's profile group_id
    const { data: profile } = await userSupabase
      .from('profiles')
      .select('group_id, full_name, role')
      .eq('id', user.id)
      .single();

    const cleanGroupCode = (profile?.group_id || '').trim();

    // 2. Locate target SACCO by group_code or admin_profile_id
    let saccoId = null;
    if (cleanGroupCode) {
      const { data: saccoRows } = await userSupabase
        .from('saccos')
        .select('id')
        .or(`group_code.ilike.${cleanGroupCode},admin_profile_id.eq.${user.id}`)
        .limit(1);

      if (saccoRows && saccoRows.length > 0) {
        saccoId = saccoRows[0].id;
      }
    }

    if (!saccoId) {
      const { data: fallbackRows } = await userSupabase
        .from('saccos')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1);

      if (fallbackRows && fallbackRows.length > 0) {
        saccoId = fallbackRows[0].id;
      }
    }

    const updatePayload = {
      share_price: parsedSharePrice,
      devt_fund: parsedDevtFund,
      social_fund: parsedSocialFund,
      current_week: parsedCurrentWeek,
      is_locked: Boolean(isLocked),
      admin_profile_id: user.id,
      updated_at: new Date().toISOString()
    };

    if (saccoId) {
      const { data: updatedRows, error: updateErr } = await userSupabase
        .from('saccos')
        .update(updatePayload)
        .eq('id', saccoId)
        .select();

      if (updateErr) {
        console.warn("Update error on sacco by ID:", updateErr.message);
      }

      if (!updatedRows || updatedRows.length === 0) {
        await userSupabase
          .from('saccos')
          .update(updatePayload)
          .ilike('group_code', cleanGroupCode || '%');
      }
    } else {
      await userSupabase
        .from('saccos')
        .insert({
          name: `${profile?.full_name || 'Admin'}'s SACCO`,
          acronym: 'SACCO',
          group_code: cleanGroupCode || 'BYS-8240',
          ...updatePayload
        });
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
