import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
}

function getAllowedEmails() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function authorizePlatformAdmin(request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return { error: 'No authorization token provided.', status: 401 };
  }

  const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authErr } = await jwtClient.auth.getUser();
  if (authErr || !user) {
    return { error: authErr?.message || 'Authentication failed.', status: 401 };
  }

  const allowedEmails = getAllowedEmails();
  const callerEmail = (user.email || '').trim().toLowerCase();

  // Strict security check: Caller email MUST be explicitly listed in PLATFORM_ADMIN_EMAILS
  if (!callerEmail || allowedEmails.length === 0 || !allowedEmails.includes(callerEmail)) {
    return { error: `Access Denied: '${callerEmail}' is not listed in PLATFORM_ADMIN_EMAILS (.env).`, status: 403 };
  }

  return { user };
}

export async function GET(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'tenants';
  const supabase = getSupabaseAdmin();

  try {
    if (action === 'tenants') {
      const { data: saccos, error: saccoErr } = await supabase
        .from('saccos')
        .select('*')
        .order('created_at', { ascending: false });

      if (saccoErr) throw saccoErr;

      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, role');

      if (profErr) throw profErr;

      return Response.json({ success: true, saccos: saccos || [], profiles: profiles || [] });
    }

    if (action === 'audit-log') {
      const { data: events, error: auditErr } = await supabase
        .from('audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (auditErr) {
        return Response.json({ success: true, events: [] });
      }

      return Response.json({ success: true, events: events || [] });
    }

    return Response.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabaseAdmin();

  try {
    const body = await request.json();
    const { action, sacco_id, status, member_limit } = body;

    if (action === 'update_sacco') {
      if (!sacco_id) {
        return Response.json({ error: 'sacco_id is required' }, { status: 400 });
      }

      const updates = {};
      if (status) updates.status = status;
      if (member_limit) updates.member_limit = Number(member_limit);
      updates.updated_at = new Date().toISOString();

      const { data: updatedSacco, error: updateErr } = await supabase
        .from('saccos')
        .update(updates)
        .eq('id', sacco_id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return Response.json({ success: true, sacco: updatedSacco });
    }

    return Response.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
