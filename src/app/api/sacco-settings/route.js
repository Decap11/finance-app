import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const getFilePath = () => path.join(process.cwd(), 'src/app/api/sacco-settings/settings.json');

// Helper to query settings from Supabase sacco_settings / saccos table
export async function getActiveSaccoSettings(groupCodeInput = null) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  let targetGroupCode = groupCodeInput;

  if (targetGroupCode) {
    targetGroupCode = targetGroupCode.trim().toUpperCase();
    
    // 1. Try querying sacco_settings table first by group_code
    try {
      const { data: setRow } = await supabase
        .from('sacco_settings')
        .select('*')
        .ilike('group_code', targetGroupCode)
        .maybeSingle();

      if (setRow) {
        return {
          sharePrice: Number(setRow.share_price) || 25000,
          devtFund: Number(setRow.devt_fund) || 1000,
          socialFund: Number(setRow.social_fund) || 2000,
          currentWeek: Number(setRow.current_week) || 1,
          meetingDay: setRow.meeting_day || 'Wednesday',
          isLocked: Boolean(setRow.is_locked),
          groupCode: setRow.group_code
        };
      }
    } catch (e) {
      // ignore
    }

    // 2. Try querying saccos table
    try {
      const { data: saccoRow } = await supabase
        .from('saccos')
        .select('*')
        .ilike('group_code', targetGroupCode)
        .maybeSingle();

      if (saccoRow && (saccoRow.share_price !== undefined || saccoRow.current_week !== undefined)) {
        return {
          sharePrice: Number(saccoRow.share_price) || 25000,
          devtFund: Number(saccoRow.devt_fund) || 1000,
          socialFund: Number(saccoRow.social_fund) || 2000,
          currentWeek: Number(saccoRow.current_week) || 1,
          meetingDay: saccoRow.meeting_day || 'Wednesday',
          isLocked: Boolean(saccoRow.is_locked),
          groupCode: saccoRow.group_code
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // 3. Try reading latest record from sacco_settings table if no groupCode provided
  try {
    const { data: latestRow } = await supabase
      .from('sacco_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow) {
      return {
        sharePrice: Number(latestRow.share_price) || 25000,
        devtFund: Number(latestRow.devt_fund) || 1000,
        socialFund: Number(latestRow.social_fund) || 2000,
        currentWeek: Number(latestRow.current_week) || 1,
        meetingDay: latestRow.meeting_day || 'Wednesday',
        isLocked: Boolean(latestRow.is_locked),
        groupCode: latestRow.group_code
      };
    }
  } catch (e) {
    // ignore
  }

  // 4. File fallback
  try {
    const filePath = getFilePath();
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    if (parsed) return parsed;
  } catch (err) {
    // ignore
  }

  return {
    sharePrice: 25000,
    devtFund: 1000,
    socialFund: 2000,
    currentWeek: 1,
    meetingDay: 'Wednesday',
    isLocked: false
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const groupCode = searchParams.get('group_code') || searchParams.get('groupCode');

    const settings = await getActiveSaccoSettings(groupCode);
    return Response.json(settings);
  } catch (err) {
    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: 'Wednesday',
      isLocked: false
    });
  }
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supabaseUserClient.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user role is admin or user owns a sacco
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, group_id')
      .eq('id', user.id)
      .maybeSingle();

    const userRole = profile?.role || user.user_metadata?.role;
    
    // Also check if user is sacco founder/admin
    const { data: saccoAdmin } = await supabaseAdmin
      .from('saccos')
      .select('id, group_code')
      .eq('admin_profile_id', user.id)
      .limit(1);

    const isSaccoAdmin = userRole === 'admin' || (saccoAdmin && saccoAdmin.length > 0);

    if (!isSaccoAdmin) {
      return Response.json({ error: 'Unauthorized. Only SACCO admins can modify group settings.' }, { status: 403 });
    }

    const body = await request.json();
    const { sharePrice, devtFund, socialFund, currentWeek, meetingDay, isLocked, groupCode: inputGroupCode } = body;

    const groupCode = (inputGroupCode || saccoAdmin?.[0]?.group_code || profile?.group_id || 'DEFAULT').toUpperCase().trim();
    const saccoId = saccoAdmin?.[0]?.id || null;

    const newSettings = {
      sharePrice: Number(sharePrice) || 25000,
      devtFund: Number(devtFund) || 1000,
      socialFund: Number(socialFund) || 2000,
      currentWeek: Number(currentWeek) || 1,
      meetingDay: meetingDay ? meetingDay.trim() : 'Wednesday',
      isLocked: Boolean(isLocked),
      groupCode
    };

    // 1. Try Upserting into sacco_settings table in Supabase
    try {
      await supabaseAdmin.from('sacco_settings').upsert({
        group_code: groupCode,
        sacco_id: saccoId,
        share_price: newSettings.sharePrice,
        devt_fund: newSettings.devtFund,
        social_fund: newSettings.socialFund,
        current_week: newSettings.currentWeek,
        meeting_day: newSettings.meetingDay,
        is_locked: newSettings.isLocked,
        updated_at: new Date().toISOString()
      }, { onConflict: 'group_code' });
    } catch (e) {
      console.warn("sacco_settings upsert warning:", e.message);
    }

    // 2. Try Updating saccos table if saccoId exists
    if (saccoId) {
      try {
        await supabaseAdmin.from('saccos').update({
          share_price: newSettings.sharePrice,
          devt_fund: newSettings.devtFund,
          social_fund: newSettings.socialFund,
          current_week: newSettings.currentWeek,
          meeting_day: newSettings.meetingDay,
          is_locked: newSettings.isLocked,
          updated_at: new Date().toISOString()
        }).eq('id', saccoId);
      } catch (e) {
        console.warn("saccos table update warning:", e.message);
      }
    }

    // 3. Fallback write to local file (for local dev environments)
    try {
      const filePath = getFilePath();
      await fs.writeFile(filePath, JSON.stringify(newSettings, null, 2), 'utf8');
    } catch (e) {
      // ignore on serverless environments like Vercel where fs is read-only
    }

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
