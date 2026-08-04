import { createClient } from '@supabase/supabase-js';
import {
  wantsShares,
  parseShareQuantity,
  resolveShareUnitPrice,
  shareContributionAmount,
  sharePriceDisagreement,
  describeShareRequest
} from '../../../utils/sharePricing';

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

/**
 * Is this PostgREST telling us a column does not exist, rather than rejecting the data?
 *
 * `42703` is Postgres's undefined_column; `PGRST204` is PostgREST failing to find a column
 * named in the payload against its cached schema. Matched on the codes and not on the
 * message text, because "does not exist" also matches a missing table, function or type,
 * and 0029 is a written record of what mistaking one for another costs.
 */
function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .*(share_count|unit_price).* does not exist/i.test(error.message || '');
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
    // `sharePrice` is what the member's screen was showing when they pressed Contribute.
    // It is never used as the price -- it is compared against the real one, so that a
    // request whose total the member could not have seen is refused rather than stored.
    const { shares, devtFund, socialFund, sharePrice: shownSharePrice } = body;

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

    // 2. Fetch Sacco ID. group_code is selected as well as the id because the settings read
    //    below is keyed on it -- it used to ask for `saccoData?.group_code` from a row that
    //    only ever contained `id`, so the code was always undefined and the settings came
    //    back unscoped. Share price and the social fund floor for a member's contribution
    //    were being taken from whichever SACCO had saved its settings most recently.
    const { data: saccoData } = await supabase
      .from('saccos')
      .select('id, group_code')
      .eq('group_code', groupId)
      .limit(1)
      .maybeSingle();

    if (!saccoData) {
      return Response.json({ error: 'Sacco group metadata not found in database.' }, { status: 400 });
    }

    const saccoId = saccoData.id;
    const inserts = [];

    // One read, and whether it worked is remembered rather than papered over. The share
    // price is the only figure here that must not be guessed -- see below.
    let settings = null;
    try {
      const { getActiveSaccoSettings } = await import('../sacco-settings/route.js');
      settings = await getActiveSaccoSettings(saccoData?.group_code || groupId);
    } catch (err) {
      console.warn("Failed to load active settings:", err);
    }

    const currentWeek = Number(settings?.currentWeek) || 1;
    // The weekly social fund floor. 0 when the settings could not be read, deliberately
    // rather than a guessed default: refusing a member's money because this request could
    // not read the settings would be the worse failure of the two. The share price below is
    // the opposite case -- there, guessing IS the failure, because it changes the figure
    // recorded against the member's name.
    const minSocial = Number(settings?.socialFund) || 0;

    const numDevt = Number(devtFund) || 0;
    const numSocial = Number(socialFund) || 0;

    // ---- Shares -----------------------------------------------------------------------
    //
    // Resolved before anything is written, because a shares request that cannot be priced
    // correctly must take the whole submission down with it. Filing the development and
    // social fund halves while dropping the shares would leave the member believing all
    // three had gone in -- and the weekly one-submission-per-category rule below would then
    // lock them out of retrying the shares for the rest of the week.
    let shareQuantity = 0;
    let shareUnitPrice = 0;

    if (wantsShares(shares)) {
      const parsed = parseShareQuantity(shares);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }

      const priced = resolveShareUnitPrice(settings);
      if (!priced.ok) {
        // 503, not 400: nothing is wrong with what the member typed. The server cannot
        // currently establish the price, and the right outcome is that they try again.
        return Response.json({ error: priced.error, code: 'SHARE_PRICE_UNAVAILABLE' }, { status: 503 });
      }

      const disagreement = sharePriceDisagreement(shownSharePrice, priced.unitPrice);
      if (disagreement) {
        // 409: the member's screen and the database describe different money. The client
        // reloads the settings on this code and shows the corrected total for confirmation.
        return Response.json({
          error: disagreement,
          code: 'SHARE_PRICE_CHANGED',
          sharePrice: priced.unitPrice
        }, { status: 409 });
      }

      shareQuantity = parsed.quantity;
      shareUnitPrice = priced.unitPrice;
    }

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

    if (shareQuantity > 0 && existingCategories.has('shares')) {
      return Response.json({ error: `You have already submitted a transaction request for Shares in Week ${currentWeek}.` }, { status: 400 });
    }
    if (numDevt > 0 && existingCategories.has('development_fund')) {
      return Response.json({ error: `You have already submitted a transaction request for the Development Fund in Week ${currentWeek}.` }, { status: 400 });
    }
    if (numSocial > 0 && existingCategories.has('social_fund')) {
      return Response.json({ error: `You have already submitted a transaction request for the Social Fund in Week ${currentWeek}.` }, { status: 400 });
    }

    if (shareQuantity > 0) {
      inserts.push({
        sacco_id: saccoId,
        profile_id: user.id,
        // The count and the price that produced this amount are stored alongside it, so
        // nothing downstream has to divide by whatever the price happens to be when it
        // reads the row. Migration 0033 holds the two in agreement with a CHECK.
        amount: shareContributionAmount(shareQuantity, shareUnitPrice),
        share_count: shareQuantity,
        unit_price: shareUnitPrice,
        direction: "credit",
        category: "shares",
        status: "pending",
        description: describeShareRequest(shareQuantity, shareUnitPrice, currentWeek),
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

    let { error: insertError } = await supabase
      .from('transactions')
      .insert(inserts);

    // Migration 0033 adds share_count / unit_price. Applying migrations here is a manual
    // step, and this repository has three separate occasions where a feature appeared
    // broken for days because a file had not been pasted into the SQL editor (0021, 0028,
    // 0029). So a database without those columns degrades instead of refusing: the amount
    // is already correct -- the server priced it and the member's screen agreed to that
    // price -- and the count and price are still recorded in the description. What is lost
    // is only the ability to read them back without parsing prose.
    let columnsWarning = null;
    if (insertError && isMissingColumnError(insertError)) {
      columnsWarning = 'Recorded, but this database has not had migration 0033 applied, so '
        + 'the share count and unit price could not be stored in their own columns.';
      console.warn(`transactions insert: ${columnsWarning} (${insertError.message})`);

      const stripped = inserts.map((row) => {
        const copy = { ...row };
        delete copy.share_count;
        delete copy.unit_price;
        return copy;
      });
      ({ error: insertError } = await supabase.from('transactions').insert(stripped));
    }

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    // The figures as filed, so the member's confirmation can state what actually went in
    // rather than repeating what their form was showing. Those are the two numbers this
    // whole route exists to keep equal, and saying them back is how a member notices if
    // they ever diverge again.
    return Response.json({
      success: true,
      recorded: {
        shares: shareQuantity > 0
          ? {
              quantity: shareQuantity,
              unitPrice: shareUnitPrice,
              amount: shareContributionAmount(shareQuantity, shareUnitPrice)
            }
          : null,
        devtFund: numDevt > 0 ? numDevt : null,
        socialFund: numSocial > 0 ? numSocial : null
      },
      ...(columnsWarning ? { dbWarning: columnsWarning } : {})
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
