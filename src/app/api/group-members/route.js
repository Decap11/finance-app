import { verifyAuth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // Get current user's profile to retrieve group_id
    const { data: userProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    if (profileErr) {
      return Response.json({ error: profileErr.message }, { status: 500 });
    }

    if (!userProfile || !userProfile.group_id) {
      return Response.json({ error: 'No active group found for this profile.' }, { status: 400 });
    }

    // Fetch all profiles in the same group
    const { data: profiles, error: listErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('group_id', userProfile.group_id);

    if (listErr) {
      return Response.json({ error: listErr.message }, { status: 500 });
    }

    const cleanProfiles = (profiles || []).map(p => {
      const statusRaw = (p.status || '').toLowerCase().trim();
      const roleRaw = (p.role || '').toLowerCase().trim();

      const effectiveStatus = (roleRaw === 'admin' || roleRaw === 'super_admin')
        ? 'active'
        : (statusRaw || 'pending');

      return {
        ...p,
        status: effectiveStatus
      };
    });

    return Response.json({ profiles: cleanProfiles, group_id: userProfile.group_id });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
