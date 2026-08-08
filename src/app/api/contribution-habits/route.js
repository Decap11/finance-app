import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
// No fallback to the anon key -- see the note on the same constant in sacco-settings. The
// consequence differs here: the service client below backs an authorization decision, and an
// anonymous client reads no sacco_memberships rows at all, so the staff check silently
// answered "not staff" for everyone and admins lost access to member habits entirely. That
// direction is safe, but it is indistinguishable from a real permission denial, so it is a
// misconfiguration that presents as a working app behaving inexplicably.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

    const url = new URL(request.url);
    const targetMemberId = url.searchParams.get('memberId') || user.id;

    // Only admins/loan_officers of the target member's own SACCO may view someone
    // else's contribution habits. Do not rely on RLS alone for this -- verify explicitly.
    if (targetMemberId !== user.id) {
      // Only this branch needs the service role; a member reading their own habits does not,
      // so the check sits here rather than at the top of the handler. Refusing outright,
      // because the alternative is a 403 that says the caller is not staff when the truth is
      // that the server cannot tell either way.
      if (!supabaseServiceKey) {
        console.error(
          'SUPABASE_SERVICE_ROLE_KEY is not set; cannot verify whether the caller is staff of '
          + "the target member's SACCO."
        );
        return Response.json(
          { error: 'Server is not configured to check staff permissions.' },
          { status: 500 }
        );
      }

      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      const { data: targetMembership } = await supabaseAdmin
        .from('sacco_memberships')
        .select('sacco_id')
        .eq('profile_id', targetMemberId)
        .maybeSingle();

      let isAuthorizedStaff = false;
      if (targetMembership?.sacco_id) {
        const { data: callerMembership } = await supabaseAdmin
          .from('sacco_memberships')
          .select('role')
          .eq('sacco_id', targetMembership.sacco_id)
          .eq('profile_id', user.id)
          .in('role', ['admin', 'loan_officer'])
          .maybeSingle();
        isAuthorizedStaff = !!callerMembership;
      }

      if (!isAuthorizedStaff) {
        return Response.json({ error: 'Unauthorized. You may only view your own contribution habits.' }, { status: 403 });
      }
    }

    // 1. Fetch user profile group_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', targetMemberId)
      .maybeSingle();

    const groupCode = profile?.group_id || user.user_metadata?.group_id || null;

    // 2. Fetch SACCO group settings (including configured meetingDay)
    let settings = {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: 'Wednesday',
      isLocked: false
    };

    try {
      const { getActiveSaccoSettings } = await import('../sacco-settings/route.js');
      settings = await getActiveSaccoSettings(groupCode);
    } catch (err) {
      console.warn("Failed to load active settings for habits:", err);
    }

    // 3. Fetch SACCO onboarding / creation date
    let saccoCreatedAt = null;
    if (groupCode) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: saccoRow } = await supabaseAdmin
        .from('saccos')
        .select('created_at')
        .ilike('group_code', groupCode.trim())
        .maybeSingle();

      if (saccoRow && saccoRow.created_at) {
        saccoCreatedAt = saccoRow.created_at;
      } else if (settings && (settings.onboardingDate || settings.onboarding_date)) {
        saccoCreatedAt = settings.onboardingDate || settings.onboarding_date;
      }
    }

    // 4. Query contribution and fine transactions for the requested year
    //
    // Historical onboarding (migration 0028) files a backfilled record under the date it
    // actually happened, so a SACCO that joined with years of paper records has rows well
    // before this one. This used to be hardcoded to the current year with no upper bound,
    // which meant those rows were dropped here and never reached the heatmap at all.
    const CONTRIBUTION_CATEGORIES = [
      'shares', 'development_fund', 'social_fund', 'devt', 'social',
      'fine', 'fines', 'penalty', 'absenteeism'
    ];

    const thisYear = new Date().getFullYear();
    const requestedYear = parseInt(url.searchParams.get('year'), 10);
    const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= thisYear
      ? requestedYear
      : thisYear;

    // Named columns rather than '*'. This is a whole year of a member's contributions and
    // it is fetched on every dashboard load; the heatmap reads ten fields and the row has
    // considerably more, all of which were crossing the wire to be discarded.
    //
    // share_count and unit_price arrive with migration 0033, and asking PostgREST for a
    // column that does not exist fails the WHOLE query -- which on a database without 0033
    // would blank the tracker entirely. Same fallback ContributionApprovals uses: ask for
    // them, and on undefined_column ask again without. shareCountOf then recovers the
    // count from the description instead.
    const TX_COLUMNS = 'id, amount, category, status, direction, created_at, description, week_number';

    const runTx = (columns) => supabase
      .from('transactions')
      .select(columns)
      .eq('profile_id', targetMemberId)
      .in('category', CONTRIBUTION_CATEGORIES)
      .gte('created_at', `${year}-01-01`)
      .lt('created_at', `${year + 1}-01-01`)
      .order('created_at', { ascending: true });

    let { data: rawTransactions, error: txErr } = await runTx(`${TX_COLUMNS}, share_count, unit_price`);

    if (txErr && (txErr.code === '42703' || txErr.code === 'PGRST204' || /share_count|unit_price/i.test(txErr.message || ''))) {
      console.warn('Habits: share_count/unit_price missing — apply migration 0033.', txErr.message);
      ({ data: rawTransactions, error: txErr } = await runTx(TX_COLUMNS));
    }

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    // Which years this member has any activity in, so the client can offer a year
    // selector that only lists years with something to show. One narrow column.
    const { data: allDates } = await supabase
      .from('transactions')
      .select('created_at')
      .eq('profile_id', targetMemberId)
      .in('category', CONTRIBUTION_CATEGORIES);

    const availableYears = Array.from(
      new Set((allDates || []).map(r => new Date(r.created_at).getFullYear()).filter(Number.isFinite))
    ).sort((a, b) => b - a);

    if (!availableYears.includes(thisYear)) availableYears.unshift(thisYear);

    // Filter to completed/approved or valid non-debit transactions
    const transactions = (rawTransactions || []).filter(tx => {
      const dir = (tx.direction || '').toLowerCase();
      if (dir === 'debit' || dir === 'outbound') return false;
      const status = (tx.status || 'completed').toLowerCase();
      return status === 'completed' || status === 'approved';
    });

    return Response.json({
      transactions,
      settings,
      saccoCreatedAt,
      year,
      availableYears
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
