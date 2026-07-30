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

    // 1. Fetch user profile group_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
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

      if (saccoRow) {
        saccoCreatedAt = saccoRow.created_at;
      }
    }

    // 4. Query transactions for current year
    const currentYear = new Date().getFullYear();
    const startOfYear = `${currentYear}-01-01`;

    const { data: transactions, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', user.id)
      .in('category', ['shares', 'development_fund', 'social_fund', 'devt', 'social'])
      .in('direction', ['credit', 'deposit', 'inbound'])
      .in('status', ['completed', 'approved'])
      .gte('created_at', startOfYear)
      .order('created_at', { ascending: true });

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    return Response.json({
      transactions: transactions || [],
      settings,
      saccoCreatedAt
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
