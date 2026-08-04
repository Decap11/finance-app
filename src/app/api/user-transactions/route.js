import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limitVal = limitParam ? parseInt(limitParam, 10) : null;

    let query = supabase
      .from('transactions')
      .select(`
        *,
        requester:profiles!transactions_requested_by_fkey (
          full_name
        )
      `)
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false });

    if (limitVal) {
      query = query.limit(limitVal);
    }

    const { data: transactions, error: txErr } = await query;

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    return Response.json({ transactions });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const body = await request.json();
    const { shares, devtFund, socialFund } = body;

    // 1. Fetch profile group_id
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .maybeSingle();

    const groupId = userProfile?.group_id || user.user_metadata?.group_id;

    if (!groupId) {
      return Response.json({ error: 'Sacco group membership not found on your profile.' }, { status: 400 });
    }

    // 2. Fetch Sacco ID
    const { data: saccoData } = await supabase
      .from('saccos')
      .select('id')
      .eq('group_code', groupId)
      .limit(1)
      .maybeSingle();

    if (!saccoData) {
      return Response.json({ error: 'Sacco group metadata not found in database.' }, { status: 400 });
    }

    const saccoId = saccoData.id;
    const inserts = [];
    
    let sharePrice = 25000;
    let currentWeek = 1;
    // The weekly social fund floor. 0 until the settings load, and a failed load deliberately
    // leaves it at 0 rather than at a guessed default: refusing a member's money because this
    // request could not read the settings would be the worse failure of the two.
    let minSocial = 0;
    try {
      const { getActiveSaccoSettings } = await import('../sacco-settings/route.js');
      const settings = await getActiveSaccoSettings(saccoData?.group_code);
      if (settings) {
        if (settings.sharePrice) sharePrice = settings.sharePrice;
        if (settings.currentWeek) currentWeek = settings.currentWeek;
        if (settings.socialFund) minSocial = Number(settings.socialFund) || 0;
      }
    } catch (err) {
      console.warn("Failed to load active settings, using fallback:", err);
    }

    const numShares = Number(shares) || 0;
    const numDevt = Number(devtFund) || 0;
    const numSocial = Number(socialFund) || 0;

    // Social fund is a minimum, not a fixed amount: the set figure or anything above it meets
    // the week's obligation, and the surplus is credited in full. Anything below it does not
    // meet the obligation at all, so it is refused rather than filed as if it had. Checked
    // here as well as in the form because the form is not the only way to reach this route.
    if (numSocial > 0 && minSocial > 0 && numSocial < minSocial) {
      return Response.json({
        error: `The social fund is at least Shs ${minSocial.toLocaleString()} a week. Enter that amount or more.`
      }, { status: 400 });
    }

    // Check if the user has already submitted requests for this week number
    const { data: existingTxs, error: checkErr } = await supabase
      .from('transactions')
      .select('category, description')
      .eq('profile_id', user.id)
      .ilike('description', `%| Week ${currentWeek}`);

    if (checkErr) {
      return Response.json({ error: checkErr.message }, { status: 500 });
    }

    const existingCategories = new Set(existingTxs.map(tx => tx.category));

    if (numShares > 0 && existingCategories.has('shares')) {
      return Response.json({ error: `You have already submitted a transaction request for Shares in Week ${currentWeek}.` }, { status: 400 });
    }
    if (numDevt > 0 && existingCategories.has('development_fund')) {
      return Response.json({ error: `You have already submitted a transaction request for the Development Fund in Week ${currentWeek}.` }, { status: 400 });
    }
    if (numSocial > 0 && existingCategories.has('social_fund')) {
      return Response.json({ error: `You have already submitted a transaction request for the Social Fund in Week ${currentWeek}.` }, { status: 400 });
    }

    if (numShares > 0) {
      inserts.push({
        sacco_id: saccoId,
        profile_id: user.id,
        amount: numShares * sharePrice,
        direction: "credit",
        category: "shares",
        status: "pending",
        description: `Contribution request: ${numShares} share(s) @ Shs ${sharePrice.toLocaleString()} | Week ${currentWeek}`,
        requested_by: user.id
      });
    }

    if (numDevt > 0) {
      inserts.push({
        sacco_id: saccoId,
        profile_id: user.id,
        amount: numDevt,
        direction: "credit",
        category: "development_fund",
        status: "pending",
        description: `Contribution request: Development Fund | Week ${currentWeek}`,
        requested_by: user.id
      });
    }

    if (numSocial > 0) {
      inserts.push({
        sacco_id: saccoId,
        profile_id: user.id,
        amount: numSocial,
        direction: "credit",
        category: "social_fund",
        status: "pending",
        description: `Contribution request: Social Fund | Week ${currentWeek}`,
        requested_by: user.id
      });
    }

    if (inserts.length === 0) {
      return Response.json({ error: 'No contributions specified.' }, { status: 400 });
    }

    const { error: insertError } = await supabase
      .from('transactions')
      .insert(inserts);

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
