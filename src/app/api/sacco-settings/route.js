import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const getFilePath = () => path.join(process.cwd(), 'src/app/api/sacco-settings/settings.json');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper to query settings from Supabase sacco_settings / saccos table
export async function getActiveSaccoSettings(groupCodeInput = null) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  let targetGroupCode = groupCodeInput;

  if (targetGroupCode) {
    targetGroupCode = targetGroupCode.trim().toUpperCase();
    
    // 1. Try querying sacco_settings table first by group_code
    try {
      const { data: setRow, error: setErr } = await supabase
        .from('sacco_settings')
        .select('*')
        .ilike('group_code', targetGroupCode)
        .maybeSingle();

      if (setRow && !setErr) {
        return {
          sharePrice: Number(setRow.share_price) || 25000,
          devtFund: Number(setRow.devt_fund) || 1000,
          socialFund: Number(setRow.social_fund) || 2000,
          lateFineAmount: Number(setRow.late_fine_amount) || 500,
          loanApplicationFee: Number(setRow.loan_application_fee) || 5000,
          loanLateFeeAmount: Number(setRow.loan_late_fee_amount) || 10000,
          loanMinGuarantors: Number(setRow.loan_min_guarantors) || 3,
          currentWeek: Number(setRow.current_week) || 1,
          meetingDay: setRow.meeting_day || 'Wednesday',
          isLocked: Boolean(setRow.is_locked),
          isHistoricalMode: Boolean(setRow.is_historical_mode),
          onboardingDate: setRow.onboarding_date || setRow.created_at || new Date().toISOString(),
          groupCode: setRow.group_code
        };
      }
    } catch (e) {
      // ignore
    }

    // 2. Try querying saccos table
    try {
      const { data: saccoRow, error: saccoErr } = await supabase
        .from('saccos')
        .select('*')
        .ilike('group_code', targetGroupCode)
        .maybeSingle();

      if (saccoRow && !saccoErr) {
        const onboardingDayName = saccoRow.created_at ? DAYS[new Date(saccoRow.created_at).getDay()] : 'Wednesday';
        const defaultMeetingDay = onboardingDayName;
        const initialWeek = saccoRow.current_week || 1;

        // Auto-seed sacco_settings entry for this sacco
        try {
          await supabase.from('sacco_settings').upsert({
            group_code: targetGroupCode,
            sacco_id: saccoRow.id,
            share_price: Number(saccoRow.share_price) || 25000,
            devt_fund: Number(saccoRow.devt_fund) || 1000,
            social_fund: Number(saccoRow.social_fund) || 2000,
            current_week: initialWeek,
            meeting_day: defaultMeetingDay,
            is_locked: Boolean(saccoRow.is_locked),
            is_historical_mode: false,
            onboarding_date: saccoRow.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'group_code' });
        } catch (e) {
          // ignore
        }

        return {
          sharePrice: Number(saccoRow.share_price) || 25000,
          devtFund: Number(saccoRow.devt_fund) || 1000,
          socialFund: Number(saccoRow.social_fund) || 2000,
          lateFineAmount: Number(saccoRow.late_fine_amount) || 500,
          loanApplicationFee: Number(saccoRow.loan_application_fee) || 5000,
          loanLateFeeAmount: Number(saccoRow.loan_late_fee_amount) || 10000,
          loanMinGuarantors: Number(saccoRow.loan_min_guarantors) || 3,
          currentWeek: initialWeek,
          meetingDay: defaultMeetingDay,
          isLocked: Boolean(saccoRow.is_locked),
          isHistoricalMode: Boolean(saccoRow.is_historical_mode),
          onboardingDate: saccoRow.created_at || new Date().toISOString(),
          groupCode: saccoRow.group_code
        };
      }
    } catch (e) {
      // ignore
    }
  }

  // 3. Try reading latest record from sacco_settings table if no groupCode provided
  try {
    const { data: latestRow, error: latestErr } = await supabase
      .from('sacco_settings')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow && !latestErr) {
      return {
        sharePrice: Number(latestRow.share_price) || 25000,
        devtFund: Number(latestRow.devt_fund) || 1000,
        socialFund: Number(latestRow.social_fund) || 2000,
        lateFineAmount: Number(latestRow.late_fine_amount) || 500,
        loanApplicationFee: Number(latestRow.loan_application_fee) || 5000,
        loanLateFeeAmount: Number(latestRow.loan_late_fee_amount) || 10000,
        loanMinGuarantors: Number(latestRow.loan_min_guarantors) || 3,
        currentWeek: Number(latestRow.current_week) || 1,
        meetingDay: latestRow.meeting_day || 'Wednesday',
        isLocked: Boolean(latestRow.is_locked),
        isHistoricalMode: Boolean(latestRow.is_historical_mode),
        onboardingDate: latestRow.onboarding_date || latestRow.created_at || new Date().toISOString(),
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
    lateFineAmount: 500,
    loanApplicationFee: 5000,
    loanLateFeeAmount: 10000,
    loanMinGuarantors: 3,
    currentWeek: 1,
    meetingDay: DAYS[new Date().getDay()],
    isLocked: false,
    isHistoricalMode: false,
    onboardingDate: new Date().toISOString()
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
      lateFineAmount: 500,
      loanApplicationFee: 5000,
      loanLateFeeAmount: 10000,
      loanMinGuarantors: 3,
      currentWeek: 1,
      meetingDay: 'Wednesday',
      isLocked: false,
      isHistoricalMode: false
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
    
    // Check if user is sacco founder/admin
    const { data: saccoAdmin } = await supabaseAdmin
      .from('saccos')
      .select('id, group_code, created_at')
      .eq('admin_profile_id', user.id)
      .limit(1);

    const isSaccoAdmin = userRole === 'admin' || (saccoAdmin && saccoAdmin.length > 0);

    if (!isSaccoAdmin) {
      return Response.json({ error: 'Unauthorized. Only SACCO admins can modify group settings.' }, { status: 403 });
    }

    const body = await request.json();
    const {
      sharePrice,
      devtFund,
      socialFund,
      lateFineAmount,
      loanApplicationFee,
      loanLateFeeAmount,
      loanMinGuarantors,
      currentWeek,
      meetingDay,
      isLocked,
      isHistoricalMode,
      groupCode: inputGroupCode
    } = body;

    const groupCode = (inputGroupCode || saccoAdmin?.[0]?.group_code || profile?.group_id || 'DEFAULT').toUpperCase().trim();
    const saccoId = saccoAdmin?.[0]?.id || null;

    const onboardingDay = saccoAdmin?.[0]?.created_at ? DAYS[new Date(saccoAdmin[0].created_at).getDay()] : DAYS[new Date().getDay()];

    const newSettings = {
      sharePrice: Number(sharePrice) || 25000,
      devtFund: Number(devtFund) || 1000,
      socialFund: Number(socialFund) || 2000,
      lateFineAmount: Number(lateFineAmount) || 500,
      loanApplicationFee: Number(loanApplicationFee) || 0,
      loanLateFeeAmount: Number(loanLateFeeAmount) || 0,
      loanMinGuarantors: Number(loanMinGuarantors) || 3,
      currentWeek: Number(currentWeek) || 1,
      meetingDay: meetingDay ? meetingDay.trim() : onboardingDay,
      isLocked: Boolean(isLocked),
      isHistoricalMode: Boolean(isHistoricalMode),
      groupCode
    };

    let dbErrors = [];

    // 1. Upsert into sacco_settings table in Supabase
    const { error: setErr } = await supabaseAdmin.from('sacco_settings').upsert({
      group_code: groupCode,
      sacco_id: saccoId,
      share_price: newSettings.sharePrice,
      devt_fund: newSettings.devtFund,
      social_fund: newSettings.socialFund,
      late_fine_amount: newSettings.lateFineAmount,
      loan_application_fee: newSettings.loanApplicationFee,
      loan_late_fee_amount: newSettings.loanLateFeeAmount,
      loan_min_guarantors: newSettings.loanMinGuarantors,
      current_week: newSettings.currentWeek,
      meeting_day: newSettings.meetingDay,
      is_locked: newSettings.isLocked,
      is_historical_mode: newSettings.isHistoricalMode,
      updated_at: new Date().toISOString()
    }, { onConflict: 'group_code' });

    if (setErr) {
      console.error("sacco_settings upsert error:", setErr.message);
      dbErrors.push(`sacco_settings: ${setErr.message}`);
    }

    // 2. Update saccos table if saccoId exists or by group_code
    const { error: saccoErr } = await supabaseAdmin.from('saccos').update({
      share_price: newSettings.sharePrice,
      devt_fund: newSettings.devtFund,
      social_fund: newSettings.socialFund,
      late_fine_amount: newSettings.lateFineAmount,
      loan_application_fee: newSettings.loanApplicationFee,
      loan_late_fee_amount: newSettings.loanLateFeeAmount,
      loan_min_guarantors: newSettings.loanMinGuarantors,
      current_week: newSettings.currentWeek,
      is_locked: newSettings.isLocked,
      is_historical_mode: newSettings.isHistoricalMode,
      updated_at: new Date().toISOString()
    }).ilike('group_code', groupCode);

    if (saccoErr) {
      console.error("saccos table update error:", saccoErr.message);
      dbErrors.push(`saccos: ${saccoErr.message}`);
    }

    // 3. Local file fallback for dev environments
    try {
      const filePath = getFilePath();
      await fs.writeFile(filePath, JSON.stringify(newSettings, null, 2), 'utf8');
    } catch (e) {
      // ignore
    }

    return Response.json({
      success: true,
      settings: newSettings,
      dbWarning: dbErrors.length > 0 ? dbErrors.join("; ") : null
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
