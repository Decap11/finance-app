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

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Check if user is an admin via metadata or SACCO ownership
    let isUserAdmin = user.user_metadata?.role === 'admin' || profile?.role === 'admin';
    if (!isUserAdmin) {
      const { data: saccoAdmin } = await supabase
        .from('saccos')
        .select('id')
        .eq('admin_profile_id', user.id)
        .limit(1)
        .maybeSingle();
      if (saccoAdmin) {
        isUserAdmin = true;
      }
    }

    const resolvedRole = isUserAdmin ? 'admin' : (profile?.role || user.user_metadata?.role || 'member');

    const finalProfile = profile
      ? { ...profile, role: resolvedRole }
      : {
          id: user.id,
          full_name: user.user_metadata?.full_name || 'SACCO User',
          email: user.email,
          phone: user.user_metadata?.phone || '',
          member_number: user.user_metadata?.member_number || `MEM-${user.id.substring(0, 4).toUpperCase()}`,
          group_id: user.user_metadata?.group_id || '',
          role: resolvedRole,
          status: 'active'
        };

    // Auto-heal public.profiles row in database if role was stuck as member
    if (profile && isUserAdmin && profile.role !== 'admin') {
      supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id).then();
    }

    return Response.json({ user, profile: finalProfile });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
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

    const body = await request.json();
    // avatar_url is deliberately not read from the body: the handler below stores an empty
    // string in user metadata regardless, to keep base64 image data out of the JWT.
    const { action, email, phone } = body;

    if (action === 'update_avatar') {
      const { data: updateData, error: updateErr } = await supabase.auth.updateUser({
        data: { avatar_url: "" } // Do not store base64 in metadata to prevent JWT bloating & 431 errors
      });
      if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });
      return Response.json({ success: true, user: updateData.user });
    } else if (action === 'update_profile') {
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          email: email.trim(),
          phone: phone.trim()
        })
        .eq('id', user.id);
      if (profileErr) return Response.json({ error: profileErr.message }, { status: 500 });
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
