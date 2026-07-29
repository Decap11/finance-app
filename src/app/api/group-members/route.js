import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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

    // 1. Get current user's profile to retrieve group_id
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    let groupId = userProfile?.group_id || user.user_metadata?.group_id;

    // 2. If group_id is still missing, check if user created a SACCO in public.saccos
    if (!groupId) {
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('group_code')
        .eq('admin_profile_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (saccoData?.group_code) {
        groupId = saccoData.group_code;
      }
    }

    if (!groupId) {
      return Response.json({ error: 'No active group code found for your account.' }, { status: 400 });
    }

    // Auto-heal profiles table if user.id group_id is null/empty
    if (userProfile && !userProfile.group_id) {
      supabase.from('profiles').update({ group_id: groupId }).eq('id', user.id).then();
    }

    // 3. Fetch all profiles matching the group_id (case-insensitive)
    let { data: profiles, error: listErr } = await supabase
      .from('profiles')
      .select('id, member_number, full_name, phone, email, role, status, created_at, group_id, avatar_url')
      .ilike('group_id', groupId.trim());

    if (listErr) {
      console.warn("ilike group_id query failed, falling back to eq:", listErr.message);
      const { data: fallbackProfiles } = await supabase
        .from('profiles')
        .select('id, member_number, full_name, phone, email, role, status, created_at, group_id, avatar_url')
        .eq('group_id', groupId.trim());
      profiles = fallbackProfiles || [];
    }

    profiles = profiles || [];

    // 4. Fallback: If profiles is empty, check sacco_memberships table
    if (profiles.length === 0) {
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('id')
        .ilike('group_code', groupId.trim())
        .maybeSingle();

      if (saccoData?.id) {
        const { data: memberships } = await supabase
          .from('sacco_memberships')
          .select('profile_id, role, profiles(*)')
          .eq('sacco_id', saccoData.id);

        if (memberships && memberships.length > 0) {
          profiles = memberships.map(m => m.profiles).filter(Boolean);
        }
      }
    }

    // 5. If current user is still missing from profiles array, inject user metadata
    const userInList = profiles.some(p => String(p.id).toLowerCase() === String(user.id).toLowerCase());
    if (!userInList) {
      profiles.unshift({
        id: user.id,
        member_number: user.user_metadata?.member_number || `MEM-${user.id.substring(0, 4).toUpperCase()}`,
        full_name: userProfile?.full_name || user.user_metadata?.full_name || 'SACCO Member',
        phone: userProfile?.phone || user.user_metadata?.phone || 'N/A',
        email: user.email,
        role: user.user_metadata?.role || 'admin',
        status: 'active',
        created_at: user.created_at,
        group_id: groupId,
        avatar_url: user.user_metadata?.avatar_url || ''
      });
    }

    return Response.json({ profiles, group_id: groupId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
