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
    const { data: authData, error: authErr } = await publicSupabase.auth.signUp({
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

    if (authErr && !authErr.message.includes('already registered')) {
      return Response.json({ error: `Auth Error: ${authErr.message}` }, { status: 400 });
    }

    if (authData?.user?.id) {
      userId = authData.user.id;
    } else {
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
      return Response.json({ error: 'Failed to create admin user credentials.' }, { status: 500 });
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

    // 4. Create New SACCO Row in saccos table
    const { data: newSacco, error: saccoErr } = await publicSupabase
      .from('saccos')
      .insert({
        name: cleanSaccoName,
        acronym: generatedAcronym,
        group_code: cleanGroupCode,
        admin_profile_id: userId,
        status: 'active',
        share_price: 5000,
        devt_fund: 1000,
        social_fund: 2000,
        current_week: 1,
        meeting_day: 'Wednesday',
        is_locked: false,
        member_limit: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (saccoErr) {
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
