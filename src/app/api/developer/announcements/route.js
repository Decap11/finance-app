import { getPublicSupabase } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const publicSupabase = getPublicSupabase();
    const { data: announcements, error } = await publicSupabase
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'platform_announcement')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return Response.json({ announcements: [] });
    }

    return Response.json({ announcements: announcements || [] });
  } catch (err) {
    return Response.json({ announcements: [], error: err.message });
  }
}

export async function POST(request) {
  try {
    const publicSupabase = getPublicSupabase();
    const body = await request.json();
    const { title, message, priority, targetTier } = body;

    if (!title || !message) {
      return Response.json({ error: 'Title and Message are required' }, { status: 400 });
    }

    const { data, error } = await publicSupabase
      .from('audit_events')
      .insert({
        entity_type: 'platform_announcement',
        action: 'create_announcement',
        metadata: {
          title,
          description: message,
          priority: priority || 'info',
          targetTier: targetTier || 'all',
          created_at: new Date().toISOString()
        }
      })
      .select('*')
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ success: true, announcement: data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
