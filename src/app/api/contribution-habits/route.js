import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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

    // 4. Query all contribution and fine transactions for current year
    const currentYear = new Date().getFullYear();
    const startOfYear = `${currentYear}-01-01`;

    const { data: rawTransactions, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', targetMemberId)
      .in('category', ['shares', 'development_fund', 'social_fund', 'devt', 'social', 'fine', 'fines', 'penalty', 'absenteeism'])
      .gte('created_at', startOfYear)
      .order('created_at', { ascending: true });

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

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
      saccoCreatedAt
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
