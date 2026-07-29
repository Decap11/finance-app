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

    // Get current user's profile to retrieve group_id
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .maybeSingle();

    const groupId = userProfile?.group_id || user.user_metadata?.group_id;

    if (!groupId) {
      return Response.json({ error: 'No active group code found for your account.' }, { status: 400 });
    }

    // Fetch all profiles in the same group
    const { data: profiles, error: listErr } = await supabase
      .from('profiles')
      .select('id, member_number, full_name, phone, email, role, status, created_at, group_id')
      .eq('group_id', groupId);

    if (listErr) {
      return Response.json({ error: listErr.message }, { status: 500 });
    }

    return Response.json({ profiles: profiles || [], group_id: groupId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
