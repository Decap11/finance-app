import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function POST(request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const body = await request.json();

    const { saccoName, acronym, groupCode, adminEmail, planTier, sharePrice } = body;

    if (!saccoName || !groupCode) {
      return Response.json({ error: 'SACCO Name and Group Code are required.' }, { status: 400 });
    }

    const cleanGroupCode = groupCode.trim().toUpperCase();
    const cleanAcronym = (acronym || cleanGroupCode.split('-')[0]).trim().toUpperCase();

    // Check if group code already exists
    const { data: existing } = await supabase
      .from('saccos')
      .select('id')
      .eq('group_code', cleanGroupCode)
      .limit(1)
      .single();

    if (existing) {
      return Response.json({ error: `SACCO Group Code '${cleanGroupCode}' is already registered.` }, { status: 400 });
    }

    // Infer member limit from plan tier
    let memberLimit = 50;
    if (planTier === 'premium' || planTier === 'enterprise') memberLimit = 1000;
    else if (planTier === 'standard') memberLimit = 250;

    // Find admin profile if existing
    let adminProfileId = null;
    if (adminEmail) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', adminEmail.trim().toLowerCase())
        .limit(1)
        .single();
      
      if (adminProfile) {
        adminProfileId = adminProfile.id;
      }
    }

    // Insert new SACCO row
    const { data: newSacco, error: insertErr } = await supabase
      .from('saccos')
      .insert({
        name: saccoName.trim(),
        acronym: cleanAcronym,
        group_code: cleanGroupCode,
        admin_profile_id: adminProfileId,
        status: 'active',
        share_price: Number(sharePrice) || 25000,
        devt_fund: 1000,
        social_fund: 2000,
        current_week: 1,
        is_locked: false,
        member_limit: memberLimit
      })
      .select('*')
      .single();

    if (insertErr) {
      return Response.json({ error: 'Failed to provision SACCO: ' + insertErr.message }, { status: 500 });
    }

    // Log audit event
    try {
      await supabase.from('audit_events').insert({
        sacco_id: newSacco.id,
        entity_type: 'sacco',
        entity_id: newSacco.id,
        action: 'provision_sacco',
        metadata: { description: `New SACCO '${saccoName}' provisioned with Group Code ${cleanGroupCode}` }
      });
    } catch (e) {
      // Non-blocking
    }

    return Response.json({ success: true, sacco: newSacco });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
