import { createClient } from '@supabase/supabase-js';
import { getActiveWeek, WEEKS_PER_CYCLE } from '../../../utils/meetingDateUtils';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Replaces the stored current_week with the one derived from week_anchor_date.
 *
 * This function is the single read path for the whole app -- every screen that shows a week
 * number ends up here, directly or through /api/sacco-settings -- so deriving it in one
 * place is what makes the week advance by itself each meeting day. The stored column is
 * only a cache kept in sync by migration 0030's RPCs, for callers that read the table
 * directly.
 *
 * No anchor means the SACCO has never finished historical onboarding: the typed
 * current_week is returned untouched, exactly as before 0030.
 */
function withDerivedWeek(settings) {
  const anchor = settings.weekAnchorDate || null;
  const derived = anchor ? getActiveWeek(anchor, settings.meetingDay) : null;
  const currentWeek = derived || settings.currentWeek || 1;

  return {
    ...settings,
    currentWeek,
    weekAnchorDate: anchor,
    // Drives the "Start New Cycle" button. Only an anchored SACCO can reach the end of a
    // cycle -- a typed 52 is just a number somebody entered.
    isCycleComplete: Boolean(anchor) && currentWeek >= WEEKS_PER_CYCLE
  };
}

/**
 * The numbers a SACCO gets before anybody has set its own.
 *
 * Expressed once, because they are what is now returned whenever a group's row cannot be
 * found -- see getActiveSaccoSettings -- and three drifting copies of them was part of how
 * the old fallback went unnoticed.
 */
const SACCO_DEFAULTS = {
  sharePrice: 25000,
  devtFund: 1000,
  socialFund: 2000,
  lateFineAmount: 500,
  loanApplicationFee: 5000,
  loanLateFeeAmount: 10000,
  loanMinGuarantors: 3,
  currentWeek: 1,
  isLocked: false,
  isHistoricalMode: false,
  weekAnchorDate: null
};

/**
 * @param {string|null} groupCode  Echoed back so a caller can see the read was scoped.
 *
 * `isDefault` marks the figures as this app's starting values rather than the group's own.
 * Nothing has to act on it, but the failure it describes -- an admin shown a 25,000 share
 * price for a group that charges 30,000 -- is silent without it.
 */
function defaultSettings(groupCode = null) {
  return withDerivedWeek({
    ...SACCO_DEFAULTS,
    meetingDay: DAYS[new Date().getDay()],
    onboardingDate: new Date().toISOString(),
    groupCode: groupCode || null,
    isDefault: true
  });
}

/**
 * A group code matched literally.
 *
 * `ilike` is a pattern operator -- % and _ are wildcards, and PostgREST reads * as % as well.
 * The code reaches here from a query string, so `?group_code=%` or `PEWOSA-00_` was a way to
 * have the match land on a row belonging to somebody else.
 *
 * Escaped rather than restricted to a character set, because a legitimate code really can
 * contain those characters: the acronym is the initials of the words in the SACCO's name
 * (register-sacco/route.js), so a group called "% Savings" produces one. And `ilike` is kept
 * rather than switched to `eq`, because register_new_sacco stores UPPER(TRIM(...)) but
 * pre-0015 rows went in unnormalised, and an exact match would stop finding those.
 *
 * A literal * cannot be expressed through PostgREST's ilike at all; escaping leaves it
 * matching nothing, which is the safe direction for a character no generated code contains.
 */
const escapeLikePattern = (value) => String(value).replace(/[\\%_*]/g, (ch) => `\\${ch}`);

const normaliseCode = (value) => String(value || '').trim().toUpperCase();

/**
 * The settings for ONE group, or this app's defaults.
 *
 * There used to be two further steps after the two below: the most recently updated
 * sacco_settings row *from any tenant*, and then a settings.json written by whichever tenant
 * last saved. Both ran even when a group code had been supplied and simply matched nothing,
 * so a SACCO registered minutes ago silently inherited a stranger's share price, fund amounts
 * and fees -- and those numbers drive the dues arithmetic on every screen, so the group would
 * be told it owed money it had never agreed to.
 *
 * Neither step can be made safe: with no matching row there is nothing that identifies which
 * group the answer should describe. So there is no longer a cross-group path out of here --
 * an unmatched code returns the defaults, flagged as such.
 */
export async function getActiveSaccoSettings(groupCodeInput = null) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const targetGroupCode = String(groupCodeInput || '').trim().toUpperCase();

  // Nothing to scope the read to. Callers that hold a token resolve their own code before
  // getting here (see GET); anybody else gets the defaults rather than a stranger's numbers.
  if (!targetGroupCode) return defaultSettings();

  const codePattern = escapeLikePattern(targetGroupCode);

  // 1. Try querying sacco_settings table first by group_code
  try {
    const { data: setRow, error: setErr } = await supabase
      .from('sacco_settings')
      .select('*')
      .ilike('group_code', codePattern)
      .maybeSingle();

    if (setRow && !setErr) {
      return withDerivedWeek({
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
        weekAnchorDate: setRow.week_anchor_date || null,
        onboardingDate: setRow.onboarding_date || setRow.created_at || new Date().toISOString(),
        groupCode: setRow.group_code
      });
    }
  } catch (e) {
    // ignore
  }

  // 2. Try querying saccos table
  try {
    const { data: saccoRow, error: saccoErr } = await supabase
      .from('saccos')
      .select('*')
      .ilike('group_code', codePattern)
      .maybeSingle();

    if (saccoRow && !saccoErr) {
      const onboardingDayName = saccoRow.created_at ? DAYS[new Date(saccoRow.created_at).getDay()] : 'Wednesday';
      const defaultMeetingDay = onboardingDayName;
      const initialWeek = saccoRow.current_week || 1;

      // Auto-seed sacco_settings entry for this sacco. Keyed on the code as STORED, not as
      // asked for: the two differ in case for any row written before register_new_sacco
      // began normalising, and seeding under the caller's spelling would leave the group
      // with two settings rows that the write path then keeps out of step with each other.
      try {
        await supabase.from('sacco_settings').upsert({
          group_code: saccoRow.group_code,
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

      return withDerivedWeek({
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
        weekAnchorDate: saccoRow.week_anchor_date || null,
        onboardingDate: saccoRow.created_at || new Date().toISOString(),
        groupCode: saccoRow.group_code
      });
    }
  } catch (e) {
    // ignore
  }

  // No row under this code. It belongs to no group yet, or to a group whose rows have not
  // been created -- either way nothing here identifies whose settings to answer with.
  return defaultSettings(targetGroupCode);
}

/**
 * Who is asking, and the group code on their own profile.
 *
 * Read as the caller -- anon key plus their bearer token -- rather than with the service
 * role, so a token that does not resolve never reaches privileged credentials at all.
 *
 * @returns {{error: string, status: number} | {asCaller: object, user: object, ownCode: string}}
 */
async function resolveReader(request) {
  const token = request.headers.get('authorization')?.split(' ')[1];
  if (!token) {
    return { error: 'No authorization token provided.', status: 401 };
  }
  if (!supabaseAnonKey) {
    return { error: 'Server is not configured for authentication.', status: 500 };
  }

  const asCaller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user } = {}, error: authErr } = await asCaller.auth.getUser();
  if (authErr || !user) {
    return { error: authErr?.message || 'Authentication failed.', status: 401 };
  }

  const { data: profile } = await asCaller
    .from('profiles')
    .select('group_id')
    .eq('id', user.id)
    .maybeSingle();

  return { asCaller, user, ownCode: normaliseCode(profile?.group_id) };
}

/**
 * Group codes this caller may read besides the one on their profile.
 *
 * Wider than resolveAdministeredSacco's set, and deliberately so: reading the share price is
 * something every member does, while changing it is not. So membership of ANY role counts
 * here, where the write path admits only 'admin'.
 *
 * Two sources beyond profiles.group_id:
 *
 *   1. sacco_memberships, any role -- somebody who belongs to a second SACCO
 *   2. saccos.admin_profile_id      -- the founder. Needed because saccoSettings.jsx falls
 *      back to the founded SACCO's code when the profile's group_id resolves to no row, so
 *      that screen legitimately asks for a code that is not profiles.group_id.
 *
 * Only consulted when the requested code is not already the caller's own, which is the
 * overwhelmingly common case -- the settings screen refetches on every realtime event, and
 * three round trips per repaint is not worth paying for the rare second membership.
 */
async function otherReadableCodes(asCaller, userId) {
  const codes = new Set();

  const { data: memberships } = await asCaller
    .from('sacco_memberships')
    .select('sacco_id')
    .eq('profile_id', userId);

  const membershipIds = (memberships || []).map((m) => m.sacco_id).filter(Boolean);
  if (membershipIds.length > 0) {
    const { data: joined } = await asCaller
      .from('saccos')
      .select('group_code')
      .in('id', membershipIds);

    for (const sacco of joined || []) {
      if (sacco?.group_code) codes.add(normaliseCode(sacco.group_code));
    }
  }

  const { data: founded } = await asCaller
    .from('saccos')
    .select('group_code')
    .eq('admin_profile_id', userId);

  for (const sacco of founded || []) {
    if (sacco?.group_code) codes.add(normaliseCode(sacco.group_code));
  }

  return codes;
}

/**
 * One group's settings, for a caller entitled to see them.
 *
 * This handler used to require nothing at all -- no token, no relationship to the group
 * named. `GET /api/sacco-settings?group_code=BYS-8240` from anywhere on the internet
 * returned that SACCO's share price, fund amounts, fines, loan fees, meeting day and lock
 * state. Group codes are ACRONYM-NUMBER, so they can be walked, and the reply distinguished
 * a registered code from an unregistered one, which is how you would find the ones worth
 * walking to. Requiring a token alone would not have been enough either: nothing tied
 * ?group_code= to the caller, so any member of any SACCO could still have read every other.
 *
 * A stranger could also make this route WRITE. getActiveSaccoSettings auto-seeds a
 * sacco_settings row through the service-role client when a saccos row has none, and an
 * unauthenticated GET was enough to trigger it. That is closed by the same check.
 *
 * A code outside the caller's set is refused identically whether or not it exists -- the set
 * is built from the caller alone, before the requested code is looked up anywhere, so the
 * 403 cannot be used to test which codes are real.
 */
export async function GET(request) {
  try {
    const reader = await resolveReader(request);
    if (reader.error) {
      return Response.json({ error: reader.error }, { status: reader.status });
    }

    const { asCaller, user, ownCode } = reader;

    const { searchParams } = new URL(request.url);
    const requested = normaliseCode(searchParams.get('group_code') || searchParams.get('groupCode'));

    if (requested) {
      if (requested !== ownCode) {
        const others = await otherReadableCodes(asCaller, user.id);
        if (!others.has(requested)) {
          return Response.json(
            { error: 'You can only read the settings of your own SACCO.' },
            { status: 403 }
          );
        }
      }
      return Response.json(await getActiveSaccoSettings(requested));
    }

    // No group named. Several screens ask this way -- the progress tracker and the manual
    // contribution log among them -- and it used to be answered with whichever group's row
    // had been saved most recently. The caller's own profile answers it instead.
    if (ownCode) {
      return Response.json(await getActiveSaccoSettings(ownCode));
    }

    const others = await otherReadableCodes(asCaller, user.id);

    if (others.size === 1) {
      const [only] = others;
      return Response.json(await getActiveSaccoSettings(only));
    }

    if (others.size > 1) {
      return Response.json(
        { error: 'You belong to more than one SACCO. Name the group code to read.' },
        { status: 400 }
      );
    }

    // Signed in, but linked to no SACCO yet -- a member between registration and approval.
    // The defaults render the screen without describing anybody, so this is answered rather
    // than refused.
    return Response.json(defaultSettings());
  } catch (err) {
    // Not the defaults: a failure here used to be indistinguishable from a group that really
    // has none, which is how the old fallback stayed invisible. Every caller checks res.ok.
    return Response.json({ error: 'Could not load settings.' }, { status: 500 });
  }
}

/**
 * The one SACCO this caller is allowed to write settings for.
 *
 * The group code used to be taken straight from the request body and checked only against
 * "is this caller an admin of *something*", then written with the service-role client --
 * which bypasses RLS. Any SACCO admin could therefore name another SACCO's group code and
 * rewrite its share price, fund amounts, fine and loan fees and lock state. Group codes are
 * ACRONYM-NUMBER, so the target did not even have to be known in advance.
 *
 * The rule now: a caller may only write to a code they demonstrably administer. The request
 * may still name one -- the settings form posts it -- but it is matched against the set
 * below rather than trusted, and anything outside that set is refused before a single write.
 *
 * Three ways to administer a SACCO. The first two mirror the authorization inside
 * approve_member_transaction (migration 0024); the third covers the gap ProtectedRoute
 * self-heals, where an admin exists before their `saccos` row does:
 *
 *   1. saccos.admin_profile_id            -- the founder
 *   2. sacco_memberships.role = 'admin'   -- promoted by make_member_admin
 *   3. profiles.role = 'admin' for their OWN profiles.group_id, and only while no other
 *      account has claimed that code
 *
 * 'loan_officer' is deliberately absent from (2): approving one member's transaction is not
 * the same authority as setting the price of a share for everybody.
 */
export async function resolveAdministeredSacco(admin, user, requestedGroupCode) {
  const { data: profile } = await admin
    .from('profiles')
    .select('role, group_id')
    .eq('id', user.id)
    .maybeSingle();

  const userRole = profile?.role || user.user_metadata?.role;
  const candidates = new Map();

  // 1. Founded by this caller.
  const { data: founded } = await admin
    .from('saccos')
    .select('id, group_code, created_at')
    .eq('admin_profile_id', user.id);

  for (const sacco of founded || []) {
    if (sacco?.group_code) candidates.set(normaliseCode(sacco.group_code), sacco);
  }

  // 2. Held through an admin membership. Resolved in two steps rather than a PostgREST
  //    embed so this does not depend on the foreign key being named as expected.
  const { data: memberships } = await admin
    .from('sacco_memberships')
    .select('sacco_id')
    .eq('profile_id', user.id)
    .eq('role', 'admin');

  const membershipIds = (memberships || []).map((m) => m.sacco_id).filter(Boolean);
  if (membershipIds.length > 0) {
    const { data: joined } = await admin
      .from('saccos')
      .select('id, group_code, created_at')
      .in('id', membershipIds);

    for (const sacco of joined || []) {
      if (sacco?.group_code) candidates.set(normaliseCode(sacco.group_code), sacco);
    }
  }

  // 3. An admin whose SACCO row has not materialised yet still owns their own group code --
  //    but only while it is unclaimed. A row already belonging to somebody else is exactly
  //    the cross-tenant write this function exists to refuse, so it is not a candidate.
  const ownCode = normaliseCode(profile?.group_id);
  if (userRole === 'admin' && ownCode && !candidates.has(ownCode)) {
    const { data: existing } = await admin
      .from('saccos')
      .select('id, group_code, created_at, admin_profile_id')
      .eq('group_code', ownCode)
      .maybeSingle();

    if (!existing) {
      candidates.set(ownCode, { id: null, group_code: ownCode, created_at: null });
    } else if (!existing.admin_profile_id) {
      candidates.set(ownCode, existing);
    }
  }

  if (candidates.size === 0) {
    return { error: 'Unauthorized. Only SACCO admins can modify group settings.', status: 403 };
  }

  const requested = normaliseCode(requestedGroupCode);

  if (requested) {
    const match = candidates.get(requested);
    if (!match) {
      return { error: 'Unauthorized. You can only change the settings of your own SACCO.', status: 403 };
    }
    return { groupCode: requested, sacco: match };
  }

  // Nothing named. One SACCO is the ordinary case; somebody who administers several has to
  // say which, rather than have the write land on whichever row happened to come back first.
  if (candidates.size > 1) {
    if (ownCode && candidates.has(ownCode)) {
      return { groupCode: ownCode, sacco: candidates.get(ownCode) };
    }
    return { error: 'You administer more than one SACCO. Name the group code to change.', status: 400 };
  }

  const [[onlyCode, onlySacco]] = candidates;
  return { groupCode: onlyCode, sacco: onlySacco };
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Which SACCO this write lands on is settled here, from the caller's own identity.
    // Every write below uses `groupCode` and `saccoId` as resolved, so a code the caller
    // does not administer cannot reach one of them.
    const resolved = await resolveAdministeredSacco(supabaseAdmin, user, inputGroupCode);
    if (resolved.error) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const { groupCode, sacco } = resolved;
    const saccoId = sacco?.id || null;

    const onboardingDay = sacco?.created_at ? DAYS[new Date(sacco.created_at).getDay()] : DAYS[new Date().getDay()];

    // Is this SACCO's week derived from an anchor? If so the "Active Week Number" field is
    // read-only in the UI and the number below is only whatever was last rendered into it.
    // Writing it back would overwrite the cache with a stale value the moment the week
    // rolls over, so every current_week write in this handler is skipped when anchored.
    // finalize_historical_onboarding and start_new_sacco_cycle are the only things that
    // should move it.
    const existing = await getActiveSaccoSettings(groupCode);
    const isAnchored = Boolean(existing?.weekAnchorDate);

    const newSettings = {
      sharePrice: Number(sharePrice) || 25000,
      devtFund: Number(devtFund) || 1000,
      socialFund: Number(socialFund) || 2000,
      lateFineAmount: Number(lateFineAmount) || 500,
      loanApplicationFee: Number(loanApplicationFee) || 0,
      loanLateFeeAmount: Number(loanLateFeeAmount) || 0,
      loanMinGuarantors: Number(loanMinGuarantors) || 3,
      // Anchored: report the derived week back, not whatever the form posted.
      currentWeek: isAnchored ? existing.currentWeek : (Number(currentWeek) || 1),
      meetingDay: meetingDay ? meetingDay.trim() : onboardingDay,
      isLocked: Boolean(isLocked),
      isHistoricalMode: Boolean(isHistoricalMode),
      weekAnchorDate: existing?.weekAnchorDate || null,
      isCycleComplete: Boolean(existing?.isCycleComplete),
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
      ...(isAnchored ? {} : { current_week: newSettings.currentWeek }),
      meeting_day: newSettings.meetingDay,
      is_locked: newSettings.isLocked,
      is_historical_mode: newSettings.isHistoricalMode,
      updated_at: new Date().toISOString()
    }, { onConflict: 'group_code' });

    if (setErr) {
      console.error("sacco_settings upsert error:", setErr.message);
      dbErrors.push(`sacco_settings: ${setErr.message}`);
    }

    // 2. Update the saccos row, addressed by the id resolved above rather than by matching
    //    on the group code. `ilike` treats % and _ as wildcards, and group codes are built
    //    from a number the registering user types -- so a pattern-matched update was one
    //    more way for a write to reach a row it was never authorised for. A null id means
    //    the SACCO row does not exist yet (case 3 in resolveAdministeredSacco); there is
    //    nothing to update, and the settings row above already carries the values.
    if (saccoId) {
      const { error: saccoErr } = await supabaseAdmin.from('saccos').update({
        share_price: newSettings.sharePrice,
        devt_fund: newSettings.devtFund,
        social_fund: newSettings.socialFund,
        late_fine_amount: newSettings.lateFineAmount,
        loan_application_fee: newSettings.loanApplicationFee,
        loan_late_fee_amount: newSettings.loanLateFeeAmount,
        loan_min_guarantors: newSettings.loanMinGuarantors,
        ...(isAnchored ? {} : { current_week: newSettings.currentWeek }),
        is_locked: newSettings.isLocked,
        is_historical_mode: newSettings.isHistoricalMode,
        updated_at: new Date().toISOString()
      }).eq('id', saccoId);

      if (saccoErr) {
        console.error("saccos table update error:", saccoErr.message);
        dbErrors.push(`saccos: ${saccoErr.message}`);
      }
    }

    // There was a third step here: mirroring the settings into a settings.json beside this
    // file. Its only reader was the fallback that has just been removed -- one file for the
    // whole deployment, written by whichever group saved last, so reading it handed one
    // group's figures to another. The write is gone with it. (It never ran in production
    // anyway; the filesystem is read-only there and the failure was swallowed.)

    return Response.json({
      success: true,
      settings: newSettings,
      dbWarning: dbErrors.length > 0 ? dbErrors.join("; ") : null
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
