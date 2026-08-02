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
  if (!callerEmail || !allowedEmails.includes(callerEmail)) {
    return { error: 'Unauthorized. This account is not a platform administrator.', status: 403 };
  }

  return { user };
}

export async function GET(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const admin = getSupabaseAdmin();

    if (action === 'tenants') {
      const { data: saccos, error: saccoError } = await admin
        .from('saccos')
        .select('*')
        .order('created_at', { ascending: false });
      if (saccoError) throw saccoError;

      const { data: profiles, error: profileError } = await admin
        .from('profiles')
        .select('id, email, full_name');
      if (profileError) throw profileError;

      return Response.json({ success: true, saccos: saccos || [], profiles: profiles || [] });
    }

    if (action === 'audit-log') {
      const { data: events, error: auditError } = await admin
        .from('audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (auditError) throw auditError;

      return Response.json({ success: true, events: events || [] });
    }

    return Response.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await authorizePlatformAdmin(request);
  if (auth.error) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const body = await request.json();
    const admin = getSupabaseAdmin();

    if (action === 'toggle-status') {
      const { id, status } = body;
      if (!id || !status) {
        return Response.json({ error: 'id and status are required' }, { status: 400 });
      }

      const { error: updateErr } = await admin
        .from('saccos')
        .update({ status })
        .eq('id', id);
      if (updateErr) throw updateErr;

      try {
        await admin.from('audit_events').insert({
          sacco_id: id,
          entity_type: 'sacco',
          entity_id: id,
          action: 'status_change',
          metadata: { description: `Status changed to ${String(status).toUpperCase()} by platform admin` }
        });
      } catch (logErr) {
        console.warn('Failed to write to audit_events table:', logErr);
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
