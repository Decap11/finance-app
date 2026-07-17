import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Verifies standard session token and returns the supabase client + user object.
 * Returns Response object on auth error.
 */
export async function verifyAuth(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return { error: Response.json({ error: 'No authorization token provided.' }, { status: 401 }) };
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
      return { error: Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 }) };
    }

    return { user, supabase };
  } catch (err) {
    return { error: Response.json({ error: 'Server authentication execution failure: ' + err.message }, { status: 500 }) };
  }
}

/**
 * Verifies caller is authenticated and holds the admin role.
 * Returns Response object on auth or role error.
 */
export async function verifyAdmin(request) {
  const auth = await verifyAuth(request);
  if (auth.error) return auth;

  try {
    const { data: profile, error: profileErr } = await auth.supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .single();

    if (profileErr || !profile || profile.role !== 'admin') {
      return { error: Response.json({ error: 'Unauthorized. Only admins can access this resource.' }, { status: 403 }) };
    }

    return auth;
  } catch (err) {
    return { error: Response.json({ error: 'Server authorization check failure: ' + err.message }, { status: 500 }) };
  }
}
