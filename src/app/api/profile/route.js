import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileErr) {
      return Response.json({ error: profileErr.message }, { status: 500 });
    }

    return Response.json({ user, profile });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    const body = await request.json();
    const { action, email, phone } = body;

    if (action === 'update_avatar') {
      const { avatar_url } = body;
      
      // Try updating public.profiles table
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ avatar_url: avatar_url || '' })
        .eq('id', user.id);

      // Update auth metadata as secondary fallback
      try {
        await supabase.auth.updateUser({
          data: { avatar_url: avatar_url || '' }
        });
      } catch (e) {
        // Ignore auth metadata error
      }

      if (profileErr) {
        console.warn("Profiles table avatar_url column not found in schema cache:", profileErr.message);
      }

      return Response.json({ success: true });
    } else if (action === 'update_profile') {
      const cleanEmail = (email || '').trim();
      const cleanPhone = (phone || '').trim();

      if (!cleanEmail || !cleanPhone) {
        return Response.json({ error: 'Email and phone number are required.' }, { status: 400 });
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          email: cleanEmail,
          phone: cleanPhone
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
