import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://dfrvkqabzviajvosuwgc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
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

    const rawMemberId = (memberId || '001').trim().toUpperCase();
    const formattedMemberNumber = rawMemberId.startsWith('MEM-') ? rawMemberId : `MEM-${rawMemberId}`;

    let userId = null;
    let authAccessToken = null;
    let authErrorMsg = null;

    // 1. Strategy A: Use Service Role Key if available in .env
    if (supabaseServiceKey && !supabaseServiceKey.startsWith('sb_publishable_')) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { persistSession: false }
        });
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
          
          const [profileRes, saccoRes] = await Promise.all([
            supabaseAdmin.from('profiles').upsert({
              id: userId,
              full_name: fullName.trim(),
              email: cleanEmail,
              phone: (phone || '').trim(),
              member_number: formattedMemberNumber,
              group_id: groupCode,
              role: 'admin',
              status: 'active'
            }, { onConflict: 'id' }),
            supabaseAdmin.from('saccos').upsert({
              name: cleanName,
              acronym: acronym,
              group_code: groupCode,
              admin_profile_id: userId,
              status: 'active',
              current_week: 1,
              meeting_day: 'Wednesday'
            }, { onConflict: 'group_code' }).select('id').maybeSingle()
          ]);

          const saccoId = saccoRes?.data?.id || (await supabaseAdmin.from('saccos').select('id').eq('group_code', groupCode).maybeSingle())?.data?.id;

          if (saccoId) {
            await Promise.all([
              supabaseAdmin.from('sacco_memberships').upsert({
                sacco_id: saccoId,
                profile_id: userId,
                role: 'admin',
                status: 'active'
              }, { onConflict: 'sacco_id, profile_id' }),
              supabaseAdmin.from('accounts').upsert([
                { sacco_id: saccoId, profile_id: userId, account_type: 'savings', balance: 0.00, status: 'active' },
                { sacco_id: saccoId, profile_id: userId, account_type: 'shares', balance: 0.00, status: 'active' },
                { sacco_id: saccoId, profile_id: userId, account_type: 'development_fund', balance: 0.00, status: 'active' },
                { sacco_id: saccoId, profile_id: userId, account_type: 'social_fund', balance: 0.00, status: 'active' },
                { sacco_id: saccoId, profile_id: userId, account_type: 'loan', balance: 0.00, status: 'active' }
              ], { onConflict: 'sacco_id, profile_id, account_type' }),
              supabaseAdmin.from('sacco_settings').upsert({
                group_code: groupCode,
                sacco_id: saccoId,
                share_price: 25000.00,
                devt_fund: 1000.00,
                social_fund: 2000.00,
                current_week: 1,
                meeting_day: 'Wednesday'
              }, { onConflict: 'group_code' }).catch(err => console.warn("sacco_settings upsert notice:", err))
            ]);
          }

          return Response.json({
            success: true,
            groupCode,
            saccoId,
            userId,
            message: 'SACCO registered successfully via Admin Service Role.'
          });
        }
      } catch (adminErr) {
        console.warn("Admin service role creation notice:", adminErr);
      }
    }

    // 2. Strategy B: User Authentication + Parallel Session-Authenticated Writes
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });

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
      authAccessToken = signUpData?.session?.access_token || null;
    } else if (signUpErr) {
      authErrorMsg = signUpErr.message;
    }

    if (userId && !authAccessToken) {
      const { data: signInData } = await supabaseAnon.auth.signInWithPassword({
        email: cleanEmail,
        password: password
      });
      if (signInData?.session?.access_token) {
        authAccessToken = signInData.session.access_token;
      }
    }

    if (!userId) {
      const { data: recoverySignIn } = await supabaseAnon.auth.signInWithPassword({
        email: cleanEmail,
        password: password
      });
      if (recoverySignIn?.user) {
        userId = recoverySignIn.user.id;
        authAccessToken = recoverySignIn.session?.access_token || null;
      }
    }

    if (!userId) {
      return Response.json({
        error: authErrorMsg || 'Failed to authenticate user account. Please check user details.'
      }, { status: 400 });
    }

    const clientOptions = authAccessToken
      ? { global: { headers: { Authorization: `Bearer ${authAccessToken}` } }, auth: { persistSession: false } }
      : { auth: { persistSession: false } };
    const authenticatedClient = createClient(supabaseUrl, supabaseAnonKey, clientOptions);

    const [profileRes, rpcRes] = await Promise.all([
      authenticatedClient.from('profiles').upsert({
        id: userId,
        full_name: fullName.trim(),
        email: cleanEmail,
        phone: (phone || '').trim(),
        member_number: formattedMemberNumber,
        group_id: groupCode,
        role: 'admin',
        status: 'active'
      }, { onConflict: 'id' }),
      authenticatedClient.rpc('register_new_sacco', {
        p_sacco_name: cleanName,
        p_acronym: acronym,
        p_group_code: groupCode,
        p_admin_profile_id: userId
      }).catch(err => ({ error: err }))
    ]);

    let saccoId = rpcRes?.data?.sacco_id || null;

    if (!saccoId) {
      const { data: saccoRow } = await authenticatedClient.from('saccos').upsert({
        name: cleanName,
        acronym: acronym,
        group_code: groupCode,
        admin_profile_id: userId,
        status: 'active',
        current_week: 1,
        meeting_day: 'Wednesday'
      }, { onConflict: 'group_code' }).select('id').maybeSingle();

      saccoId = saccoRow?.id || (await authenticatedClient.from('saccos').select('id').ilike('group_code', groupCode).maybeSingle())?.data?.id;
    }

    if (saccoId) {
      await Promise.all([
        authenticatedClient.from('sacco_memberships').upsert({
          sacco_id: saccoId,
          profile_id: userId,
          role: 'admin',
          status: 'active'
        }, { onConflict: 'sacco_id, profile_id' }),
        authenticatedClient.from('accounts').upsert([
          { sacco_id: saccoId, profile_id: userId, account_type: 'savings', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'shares', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'development_fund', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'social_fund', balance: 0.00, status: 'active' },
          { sacco_id: saccoId, profile_id: userId, account_type: 'loan', balance: 0.00, status: 'active' }
        ], { onConflict: 'sacco_id, profile_id, account_type' }),
        authenticatedClient.from('sacco_settings').upsert({
          group_code: groupCode,
          sacco_id: saccoId,
          share_price: 25000.00,
          devt_fund: 1000.00,
          social_fund: 2000.00,
          current_week: 1,
          meeting_day: 'Wednesday'
        }, { onConflict: 'group_code' }).catch(err => console.warn("sacco_settings upsert notice:", err))
      ]);
    }

    return Response.json({
      success: true,
      groupCode,
      saccoId,
      userId,
      message: 'SACCO registered and synced with database tables in parallel.'
    });
  } catch (err) {
    console.error("Register SACCO API error:", err);
    return Response.json({ error: err.message || 'Server timeout or network connection error.' }, { status: 500 });
  }
}
