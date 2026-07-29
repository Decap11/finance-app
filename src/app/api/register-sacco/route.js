import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Create or retrieve user via Auth Admin API
    let userId = null;
    let authErrorMsg = null;

    try {
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find(u => u.email?.toLowerCase() === cleanEmail.toLowerCase());

      if (existingUser) {
        userId = existingUser.id;
      }
    } catch (listErr) {
      console.warn("listUsers notice:", listErr?.message);
    }

    if (!userId) {
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

      if (createErr) {
        authErrorMsg = createErr.message;
      } else if (newUser?.user) {
        userId = newUser.user.id;
      }
    }

    if (!userId) {
      return Response.json({ error: authErrorMsg || 'Failed to create user account in Supabase Auth.' }, { status: 400 });
    }

    // 2. Insert into public.profiles
    const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
      id: userId,
      full_name: fullName.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      member_number: formattedMemberNumber,
      group_id: groupCode,
      role: 'admin',
      status: 'active'
    }, { onConflict: 'id' });

    if (profileErr) {
      console.error("Profiles upsert error:", profileErr.message);
    }

    // 3. Insert into public.saccos
    let saccoId = null;
    const { data: saccoRow, error: saccoErr } = await supabaseAdmin.from('saccos').upsert({
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
    } else {
      const { data: fetchedSacco } = await supabaseAdmin.from('saccos').select('id').eq('group_code', groupCode).maybeSingle();
      saccoId = fetchedSacco?.id || null;
    }

    // 4. Insert into public.sacco_memberships
    if (saccoId) {
      const { error: memErr } = await supabaseAdmin.from('sacco_memberships').upsert({
        sacco_id: saccoId,
        profile_id: userId,
        role: 'admin',
        status: 'active'
      }, { onConflict: 'sacco_id, profile_id' });

      if (memErr) {
        console.error("Memberships upsert error:", memErr.message);
      }

      // 5. Initialize default member accounts
      await supabaseAdmin.from('accounts').upsert([
        { sacco_id: saccoId, profile_id: userId, account_type: 'savings', balance: 0.00, status: 'active' },
        { sacco_id: saccoId, profile_id: userId, account_type: 'shares', balance: 0.00, status: 'active' },
        { sacco_id: saccoId, profile_id: userId, account_type: 'development_fund', balance: 0.00, status: 'active' },
        { sacco_id: saccoId, profile_id: userId, account_type: 'social_fund', balance: 0.00, status: 'active' },
        { sacco_id: saccoId, profile_id: userId, account_type: 'loan', balance: 0.00, status: 'active' }
      ], { onConflict: 'sacco_id, profile_id, account_type' });

      // 6. Initialize default sacco_settings
      await supabaseAdmin.from('sacco_settings').upsert({
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
    }

    return Response.json({
      success: true,
      groupCode,
      saccoId,
      userId,
      message: 'SACCO registered successfully and added to database tables.'
    });
  } catch (err) {
    console.error("Register SACCO API error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
