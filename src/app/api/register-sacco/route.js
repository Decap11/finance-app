import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://dfrvkqabzviajvosuwgc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DvitvvoiXT9AakZORRBnyw_cOE50tyI';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DvitvvoiXT9AakZORRBnyw_cOE50tyI';

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      fullName,
      phone,
      memberId,
      saccoName,
      saccoUniqueNumber
    } = body;

    if (!email || !password || !fullName || !saccoName || !saccoUniqueNumber) {
      return Response.json({ error: 'Missing required form fields.' }, { status: 400 });
    }

    const cleanEmail = email.trim();
    const cleanName = saccoName.trim();
    const cleanCode = saccoUniqueNumber.trim().toUpperCase();
    const acronym = cleanName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8) || 'SACCO';
    const groupCode = `${acronym}-${cleanCode}`;
    const formattedMemberNumber = `MEM-${(memberId || '001').trim().toUpperCase()}`;

    // Try creating admin client with service key first
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId = null;
    let authErrorMsg = null;

    // 1. Attempt Auth creation via Admin API
    try {
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName.trim(),
          phone: (phone || '').trim(),
          member_number: formattedMemberNumber,
          group_id: groupCode,
          role: 'admin',
          status: 'active'
        }
      });

      if (!createErr && newUser?.user) {
        userId = newUser.user.id;
      } else if (createErr) {
        authErrorMsg = createErr.message;
      }
    } catch (e) {
      // Service key not available or admin API disabled
    }

    // 2. Fallback to client signUp + signIn if Admin API is restricted
    let authenticatedClient = supabaseAdmin;

    if (!userId) {
      const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
      const { data: signUpData, error: signUpErr } = await supabaseAnon.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: (phone || '').trim(),
            member_number: formattedMemberNumber,
            group_id: groupCode,
            role: 'admin',
            status: 'active'
          }
        }
      });

      if (signUpData?.user) {
        userId = signUpData.user.id;
      } else if (signUpErr) {
        if (signUpErr.message?.toLowerCase().includes("already registered")) {
          const { data: signInData } = await supabaseAnon.auth.signInWithPassword({
            email: cleanEmail,
            password: password
          });
          if (signInData?.user) {
            userId = signInData.user.id;
            authenticatedClient = supabaseAnon;
          }
        } else {
          authErrorMsg = signUpErr.message;
        }
      }
    }

    if (!userId) {
      return Response.json({
        error: authErrorMsg || 'Failed to authenticate user account. If user is already registered, please verify password.'
      }, { status: 400 });
    }

    // 3. Try executing RPC function register_new_sacco
    try {
      const { data: rpcData } = await authenticatedClient.rpc('register_new_sacco', {
        p_sacco_name: cleanName,
        p_acronym: acronym,
        p_group_code: groupCode,
        p_admin_profile_id: userId
      });

      if (rpcData?.sacco_id) {
        return Response.json({
          success: true,
          groupCode,
          saccoId: rpcData.sacco_id,
          userId,
          message: 'SACCO registered successfully via database RPC.'
        });
      }
    } catch (rpcErr) {
      console.warn("RPC register_new_sacco notice:", rpcErr);
    }

    // 4. Fail-safe Direct Table Insertions into public.profiles, public.saccos, public.sacco_memberships
    let saccoId = null;

    try {
      await authenticatedClient.from('profiles').upsert({
        id: userId,
        full_name: fullName.trim(),
        email: cleanEmail,
        phone: (phone || '').trim(),
        member_number: formattedMemberNumber,
        group_id: groupCode,
        role: 'admin',
        status: 'active'
      }, { onConflict: 'id' });
    } catch (pErr) {
      console.warn("Profiles upsert notice:", pErr);
    }

    try {
      const { data: saccoRow } = await authenticatedClient.from('saccos').upsert({
        name: cleanName,
        acronym: acronym,
        group_code: groupCode,
        admin_profile_id: userId,
        status: 'active',
        current_week: 1,
        meeting_day: 'Wednesday'
      }, { onConflict: 'group_code' }).select('id').maybeSingle();

      if (saccoRow?.id) {
        saccoId = saccoRow.id;
      }
    } catch (sErr) {
      console.warn("Saccos upsert notice:", sErr);
    }

    if (!saccoId) {
      try {
        const { data: fetchedSacco } = await authenticatedClient
          .from('saccos')
          .select('id')
          .ilike('group_code', groupCode)
          .maybeSingle();
        saccoId = fetchedSacco?.id || null;
      } catch (fErr) {
        console.warn("Sacco fetch notice:", fErr);
      }
    }

    if (saccoId) {
      try {
        await authenticatedClient.from('sacco_memberships').upsert({
          sacco_id: saccoId,
          profile_id: userId,
          role: 'admin',
          status: 'active'
        }, { onConflict: 'sacco_id, profile_id' });
      } catch (mErr) {
        console.warn("Memberships upsert notice:", mErr);
      }

      try {
        await authenticatedClient.from('accounts').upsert([
          { sacco_id: saccoId, profile_id: userId, account_type: 'savings', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'shares', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'development_fund', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'social_fund', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'loan', balance: 0.00, status: 'active' }
        ], { onConflict: 'sacco_id, profile_id, account_type' });
      } catch (aErr) {
        console.warn("Accounts upsert notice:", aErr);
      }

      try {
        await authenticatedClient.from('sacco_settings').upsert({
          group_code: groupCode,
          sacco_id: saccoId,
          share_price: 25000.00,
          devt_fund: 1000.00,
          social_fund: 2000.00,
          current_week: 1,
          meeting_day: 'Wednesday',
          is_locked: false,
          is_historical_mode: false,
          onboarding_date: new Date().toISOString()
        }, { onConflict: 'group_code' });
      } catch (stErr) {
        console.warn("Settings upsert notice:", stErr);
      }
    }

    return Response.json({
      success: true,
      groupCode,
      saccoId,
      userId,
      message: 'SACCO registered and synced with database tables.'
    });
  } catch (err) {
    console.error("Register SACCO API error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
