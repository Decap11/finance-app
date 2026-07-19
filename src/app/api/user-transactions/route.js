import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

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
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    const body = await request.json();
    const { shares, devtFund, socialFund } = body;

    // Server-side validations
    const numShares = Number(shares) || 0;
    const numDevt = Number(devtFund) || 0;
    const numSocial = Number(socialFund) || 0;

    if (numShares < 0 || numDevt < 0 || numSocial < 0) {
      return Response.json({ error: 'Amounts cannot be negative.' }, { status: 400 });
    }

    if (numShares > 10) {
      return Response.json({ error: 'You cannot contribute more than 10 shares per week.' }, { status: 400 });
    }

    if (!Number.isInteger(numShares)) {
      return Response.json({ error: 'Shares count must be an integer.' }, { status: 400 });
    }

    // 1. Fetch profile group_id
    const { data: userProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !userProfile || !userProfile.group_id) {
      return Response.json({ error: 'Sacco group membership not found on your profile.' }, { status: 400 });
    }

    const cleanGroupCode = (userProfile.group_id || '').trim();

    // 2. Fetch Sacco ID and database-backed settings (case-insensitive & fail-safe)
    const { data: saccoRows, error: saccoErr } = await supabase
      .from('saccos')
      .select('*')
      .ilike('group_code', cleanGroupCode)
      .limit(1);

    if (saccoErr) {
      return Response.json({ error: `Database error querying SACCO group: ${saccoErr.message}` }, { status: 500 });
    }

    let saccoData = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;

    // Fallback: If specific group_code row wasn't found in saccos table, fetch first available sacco
    if (!saccoData) {
      const { data: fallbackRows } = await supabase
        .from('saccos')
        .select('*')
        .limit(1);

      if (fallbackRows && fallbackRows.length > 0) {
        saccoData = fallbackRows[0];
      }
    }

    if (!saccoData) {
      return Response.json({ 
        error: `Sacco group code '${cleanGroupCode}' was not found in your database's saccos table. Please ensure the SACCO group exists.` 
      }, { status: 400 });
    }

    const saccoId = saccoData.id;
    const sharePrice = Number(saccoData.share_price) || 25000;
    const currentWeek = Number(saccoData.current_week) || 1;
    const inserts = [];

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
