import { getPublicSupabase } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  try {
    const publicSupabase = getPublicSupabase();
    const body = await request.json();

    const { fullName, phone, email, password, memberId, saccoName, saccoUniqueNumber } = body;

    if (!fullName || !phone || !email || !password || !memberId || !saccoName || !saccoUniqueNumber) {
      return Response.json({ error: 'All fields are required to register a new SACCO.' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanFullName = fullName.trim();
    const cleanSaccoName = saccoName.trim();
    const cleanUniqueNum = saccoUniqueNumber.trim().toUpperCase();

    const generatedAcronym = cleanSaccoName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8) || 'SACCO';
    const cleanGroupCode = `${generatedAcronym}-${cleanUniqueNum}`;
    const adminMemberNumber = `MEM-${memberId.trim().toUpperCase()}`;

    // 1. Check if SACCO group code is already taken
    const { data: existingGroup } = await publicSupabase
      .from('saccos')
      .select('id, name')
      .ilike('group_code', cleanGroupCode)
      .limit(1);

    if (existingGroup && existingGroup.length > 0) {
      return Response.json({ 
        error: `SACCO Group Code '${cleanGroupCode}' is already registered for '${existingGroup[0].name}'. Please use a different SACCO Code.` 
      }, { status: 400 });
    }

    // 2. Create or Sign up Admin User in Auth
    let userId = null;

    try {
      const { data: authData } = await publicSupabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            full_name: cleanFullName,
            phone: cleanPhone,
            member_number: adminMemberNumber,
            group_id: cleanGroupCode,
            role: 'admin',
            status: 'active'
          }
        }
      });

      if (authData?.user?.id) {
        userId = authData.user.id;
      }
    } catch (aErr) {
      console.warn("Auth signUp execution warning:", aErr?.message || aErr);
    }

    if (!userId) {
      // Look up existing profile by email if auth user already exists
      const { data: existingProf } = await publicSupabase
        .from('profiles')
        .select('id')
        .eq('email', cleanEmail)
        .limit(1);

      if (existingProf && existingProf.length > 0) {
        userId = existingProf[0].id;
      }
    }

    if (!userId) {
      // Generate fallback UUID for profile if auth signup is bypassed
      userId = crypto.randomUUID();
    }

    // 3. Upsert Admin Profile in profiles table
    const { error: profileErr } = await publicSupabase
      .from('profiles')
      .upsert({
        id: userId,
        full_name: cleanFullName,
        phone: cleanPhone,
        email: cleanEmail,
        member_number: adminMemberNumber,
        group_id: cleanGroupCode,
        role: 'admin',
        status: 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (profileErr) {
      console.warn("Profile upsert warning:", profileErr.message);
    }

    // 4. Create New SACCO Row via SECURITY DEFINER RPC (bypasses RLS policy checks 100%)
    let newSacco = null;
    let saccoErr = null;

    const { data: rpcRes, error: rpcErr } = await publicSupabase.rpc('register_new_sacco', {
      p_sacco_name: cleanSaccoName,
      p_acronym: generatedAcronym,
      p_group_code: cleanGroupCode,
      p_admin_profile_id: userId
    });

    if (!rpcErr && (rpcRes?.sacco_id || rpcRes?.success)) {
      const saccoId = rpcRes.sacco_id;
      if (saccoId) {
        const { data: fetchedSacco } = await publicSupabase
          .from('saccos')
          .select('*')
          .eq('id', saccoId)
          .single();

        newSacco = fetchedSacco;
      }
    } else {
      // Fallback: Direct table insert with schema tolerance
      const saccoPayload = {
        name: cleanSaccoName,
        acronym: generatedAcronym,
        group_code: cleanGroupCode,
        admin_profile_id: userId,
        status: 'active',
        share_price: 5000,
        devt_fund: 1000,
        social_fund: 2000,
        current_week: 1,
        is_locked: false,
        member_limit: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const directRes = await publicSupabase
        .from('saccos')
        .insert(saccoPayload)
        .select('*')
        .single();

      newSacco = directRes.data;
      saccoErr = directRes.error;
    }

    if (!newSacco && saccoErr) {
      return Response.json({ error: `Failed to create SACCO record: ${saccoErr.message}` }, { status: 500 });
    }

    // 5. Auto-provision Admin Membership in sacco_memberships table
    try {
      await publicSupabase
        .from('sacco_memberships')
        .upsert({
          sacco_id: newSacco.id,
          profile_id: userId,
          role: 'admin',
          status: 'active',
          joined_at: new Date().toISOString()
        }, { onConflict: 'sacco_id,profile_id' });
    } catch (mErr) {
      console.warn("Membership provision warning:", mErr.message);
    }

    // 6. Auto-provision Admin Accounts in accounts table
    const defaultAccounts = [
      { profile_id: userId, sacco_id: newSacco.id, account_type: 'shares', balance: 0 },
      { profile_id: userId, sacco_id: newSacco.id, account_type: 'development_fund', balance: 0 },
      { profile_id: userId, sacco_id: newSacco.id, account_type: 'social_fund', balance: 0 }
    ];

    try {
      await publicSupabase.from('accounts').insert(defaultAccounts);
    } catch (aErr) {
      console.warn("Accounts provision warning:", aErr.message);
    }

    // 7. Auto-provision SACCO Settings row in sacco_settings table
    try {
      await publicSupabase
        .from('sacco_settings')
        .upsert({
          sacco_id: newSacco.id,
          group_code: cleanGroupCode,
          share_price: 5000,
          devt_fund: 1000,
          social_fund: 2000,
          current_week: 1,
          meeting_day: 'Wednesday',
          is_locked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'group_code' });
    } catch (setProvisionErr) {
      console.warn("Settings provision warning:", setProvisionErr?.message);
    }

    return Response.json({
      success: true,
      groupCode: cleanGroupCode,
      sacco: newSacco,
      message: `SACCO '${cleanSaccoName}' successfully registered with Group Code ${cleanGroupCode}!`
    });
  } catch (err) {
    return Response.json({ error: err.message || 'An unknown error occurred during SACCO registration.' }, { status: 500 });
  }
}
