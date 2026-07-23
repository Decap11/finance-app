import { verifyAuth, verifyAdmin, getPublicSupabase } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const publicSupabase = getPublicSupabase();
    const auth = await verifyAuth(request);
    let supabaseClient = !auth.error ? auth.supabase : publicSupabase;

    const { searchParams } = new URL(request.url);
    let groupCode = (searchParams.get('group_code') || '').trim();
    let userId = !auth.error && auth.user ? auth.user.id : null;

    if (!groupCode && userId) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single();
      groupCode = (profile?.group_id || '').trim();
    }

    let saccoSettings = null;

    // 1. Primary lookup: Dedicated sacco_settings table by group_code
    if (groupCode) {
      const { data: settingsRows } = await publicSupabase
        .from('sacco_settings')
        .select('*')
        .ilike('group_code', groupCode)
        .limit(1);

      if (settingsRows && settingsRows.length > 0) {
        saccoSettings = settingsRows[0];
      }
    }

    // 2. Secondary lookup: Primary sacco record lookup from saccos table
    let sacco = null;
    if (groupCode) {
      const { data: groupRows } = await publicSupabase
        .from('saccos')
        .select('*')
        .ilike('group_code', groupCode)
        .limit(1);
      if (groupRows && groupRows.length > 0) sacco = groupRows[0];
    }

    if (!sacco && userId) {
      const { data: adminRows } = await publicSupabase
        .from('saccos')
        .select('*')
        .eq('admin_profile_id', userId)
        .limit(1);
      if (adminRows && adminRows.length > 0) sacco = adminRows[0];
    }

    if (!sacco) {
      const { data: primaryRows } = await publicSupabase
        .from('saccos')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(1);
      if (primaryRows && primaryRows.length > 0) sacco = primaryRows[0];
    }

    // Lookup sacco_settings by sacco.id if not found by groupCode
    if (!saccoSettings && sacco?.id) {
      const { data: setBySacco } = await publicSupabase
        .from('sacco_settings')
        .select('*')
        .eq('sacco_id', sacco.id)
        .limit(1);
      if (setBySacco && setBySacco.length > 0) saccoSettings = setBySacco[0];
    }

    if (saccoSettings) {
      return Response.json({
        sharePrice: saccoSettings.share_price !== undefined && saccoSettings.share_price !== null ? Number(saccoSettings.share_price) : 5000,
        devtFund: saccoSettings.devt_fund !== undefined && saccoSettings.devt_fund !== null ? Number(saccoSettings.devt_fund) : 1000,
        socialFund: saccoSettings.social_fund !== undefined && saccoSettings.social_fund !== null ? Number(saccoSettings.social_fund) : 2000,
        currentWeek: saccoSettings.current_week !== undefined && saccoSettings.current_week !== null ? Number(saccoSettings.current_week) : 1,
        meetingDay: saccoSettings.meeting_day || "Wednesday",
        isLocked: Boolean(saccoSettings.is_locked),
        groupCode: saccoSettings.group_code || groupCode || (sacco ? sacco.group_code : '')
      });
    }

    if (sacco) {
      return Response.json({
        sharePrice: sacco.share_price !== undefined && sacco.share_price !== null ? Number(sacco.share_price) : 5000,
        devtFund: sacco.devt_fund !== undefined && sacco.devt_fund !== null ? Number(sacco.devt_fund) : 1000,
        socialFund: sacco.social_fund !== undefined && sacco.social_fund !== null ? Number(sacco.social_fund) : 2000,
        currentWeek: sacco.current_week !== undefined && sacco.current_week !== null ? Number(sacco.current_week) : 1,
        meetingDay: sacco.meeting_day || "Wednesday",
        isLocked: Boolean(sacco.is_locked),
        groupCode: sacco.group_code
      });
    }

    return Response.json({
      sharePrice: 5000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false
    });
  } catch (err) {
    console.warn("GET /api/sacco-settings execution error:", err);
    return Response.json({
      sharePrice: 5000,
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
      const { data: profile } = await publicSupabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      cleanGroupCode = (profile?.group_id || '').trim();
    }

    // Resolve target SACCO row by Group Code or Admin Profile ID
    let targetSacco = null;

    if (cleanGroupCode) {
      const { data: gRows } = await publicSupabase
        .from('saccos')
        .select('id, group_code, admin_profile_id')
        .ilike('group_code', cleanGroupCode)
        .limit(1);
      if (gRows && gRows.length > 0) targetSacco = gRows[0];
    }

    if (!targetSacco && userId) {
      const { data: aRows } = await publicSupabase
        .from('saccos')
        .select('id, group_code, admin_profile_id')
        .eq('admin_profile_id', userId)
        .limit(1);
      if (aRows && aRows.length > 0) targetSacco = aRows[0];
    }

    const activeGroupCode = cleanGroupCode || targetSacco?.group_code;

    // 1. Primary persistence: Upsert into sacco_settings table
    if (activeGroupCode) {
      const settingsPayload = {
        group_code: activeGroupCode,
        sacco_id: targetSacco?.id || null,
        share_price: parsedSharePrice,
        devt_fund: parsedDevtFund,
        social_fund: parsedSocialFund,
        current_week: parsedCurrentWeek,
        meeting_day: cleanMeetingDay,
        is_locked: Boolean(isLocked),
        updated_at: new Date().toISOString()
      };

      try {
        await publicSupabase
          .from('sacco_settings')
          .upsert(settingsPayload, { onConflict: 'group_code' });
      } catch (sSetErr) {
        console.warn("sacco_settings upsert error:", sSetErr?.message);
      }
    }

    // 2. Secondary persistence: Update saccos table columns for backward compatibility
    const updatePayload = {
      share_price: parsedSharePrice,
      devt_fund: parsedDevtFund,
      social_fund: parsedSocialFund,
      current_week: parsedCurrentWeek,
      is_locked: Boolean(isLocked),
      updated_at: new Date().toISOString()
    };

    if (userId) {
      updatePayload.admin_profile_id = userId;
    }

    if (targetSacco?.id) {
      await publicSupabase
        .from('saccos')
        .update(updatePayload)
        .eq('id', targetSacco.id);
    } else if (cleanGroupCode) {
      await publicSupabase
        .from('saccos')
        .update(updatePayload)
        .ilike('group_code', cleanGroupCode);
    }

    const newSettings = {
      sharePrice: parsedSharePrice,
      devtFund: parsedDevtFund,
      socialFund: parsedSocialFund,
      currentWeek: parsedCurrentWeek,
      meetingDay: cleanMeetingDay,
      isLocked: Boolean(isLocked),
      groupCode: activeGroupCode
    };

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
