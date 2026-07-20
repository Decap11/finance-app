import { verifyAuth, verifyAdmin, getPublicSupabase } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const publicSupabase = getPublicSupabase();
    const auth = await verifyAuth(request);
    let supabaseClient = !auth.error ? auth.supabase : publicSupabase;
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

    // 1. Primary lookup by group_code or admin_profile_id, ordered by updated_at DESC
    if (groupCode || userId) {
      const filterClause = groupCode
        ? `group_code.ilike.${groupCode}${userId ? `,admin_profile_id.eq.${userId}` : ''}`
        : `admin_profile_id.eq.${userId}`;

      const { data: saccoRows } = await supabaseClient
        .from('saccos')
        .select('*')
        .or(filterClause)
        .order('updated_at', { ascending: false })
        .limit(1);

      sacco = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;
    }

    // 2. Global Fallback lookup: Most recently updated SACCO record in PostgreSQL
    if (!sacco) {
      const { data: fallbackRows } = await publicSupabase
        .from('saccos')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1);

      sacco = fallbackRows && fallbackRows.length > 0 ? fallbackRows[0] : null;
    }

    if (sacco) {
      return Response.json({
        sharePrice: sacco.share_price !== undefined && sacco.share_price !== null ? Number(sacco.share_price) : 25000,
        devtFund: sacco.devt_fund !== undefined && sacco.devt_fund !== null ? Number(sacco.devt_fund) : 1000,
        socialFund: sacco.social_fund !== undefined && sacco.social_fund !== null ? Number(sacco.social_fund) : 2000,
        currentWeek: sacco.current_week !== undefined && sacco.current_week !== null ? Number(sacco.current_week) : 1,
        meetingDay: sacco.meeting_day || "Wednesday",
        isLocked: Boolean(sacco.is_locked)
      });
    }

    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false
    });
  } catch (err) {
    console.warn("GET /api/sacco-settings execution error:", err);
    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false
    });
  }
}

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    const user = !auth.error ? auth.user : null;
    const publicSupabase = getPublicSupabase();
    // Use authenticated client if available to pass RLS policy
    const supabaseClient = (!auth.error && auth.supabase) ? auth.supabase : publicSupabase;

    const body = await request.json();
    const { sharePrice, devtFund, socialFund, currentWeek, isLocked, meetingDay } = body;

    const parsedSharePrice = Number(sharePrice);
    const parsedDevtFund = Number(devtFund);
    const parsedSocialFund = Number(socialFund);
    const parsedCurrentWeek = Number(currentWeek);
    const cleanMeetingDay = (meetingDay || "Wednesday").trim();

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

    let cleanGroupCode = '';
    let userId = user ? user.id : null;

    if (user) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      cleanGroupCode = (profile?.group_id || '').trim();
    }

    const updatePayload = {
      share_price: parsedSharePrice,
      devt_fund: parsedDevtFund,
      social_fund: parsedSocialFund,
      current_week: parsedCurrentWeek,
      meeting_day: cleanMeetingDay,
      is_locked: Boolean(isLocked),
      updated_at: new Date().toISOString()
    };

    if (userId) {
      updatePayload.admin_profile_id = userId;
    }

    // 1. Locate target SACCO by group_code or admin_profile_id
    let saccoId = null;
    if (cleanGroupCode) {
      const { data: saccoRows } = await supabaseClient
        .from('saccos')
        .select('id')
        .ilike('group_code', cleanGroupCode)
        .limit(1);

      if (saccoRows && saccoRows.length > 0) {
        saccoId = saccoRows[0].id;
      }
    }

    if (!saccoId && userId) {
      const { data: saccoRows } = await supabaseClient
        .from('saccos')
        .select('id')
        .eq('admin_profile_id', userId)
        .limit(1);

      if (saccoRows && saccoRows.length > 0) {
        saccoId = saccoRows[0].id;
      }
    }

    // 2. Perform database update using authenticated client + publicSupabase fallback
    if (saccoId) {
      await supabaseClient.from('saccos').update(updatePayload).eq('id', saccoId);
      await publicSupabase.from('saccos').update(updatePayload).eq('id', saccoId);
    } else {
      // Update most recently created sacco or insert if empty
      const { data: existing } = await publicSupabase.from('saccos').select('id').order('created_at', { ascending: false }).limit(1);
      if (existing && existing.length > 0) {
        await supabaseClient.from('saccos').update(updatePayload).eq('id', existing[0].id);
        await publicSupabase.from('saccos').update(updatePayload).eq('id', existing[0].id);
      } else {
        await publicSupabase.from('saccos').insert({
          name: 'SACCO',
          acronym: 'SACCO',
          group_code: cleanGroupCode || 'BYS-8240',
          ...updatePayload
        });
      }
    }

    const newSettings = {
      sharePrice: parsedSharePrice,
      devtFund: parsedDevtFund,
      socialFund: parsedSocialFund,
      currentWeek: parsedCurrentWeek,
      meetingDay: cleanMeetingDay,
      isLocked: Boolean(isLocked)
    };

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
