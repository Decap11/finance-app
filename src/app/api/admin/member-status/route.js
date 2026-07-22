import { verifyAdmin, getPublicSupabase } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { action, memberId } = body;

    if (!memberId) {
      return Response.json({ error: 'Member ID is required.' }, { status: 400 });
    }

    const publicSupabase = getPublicSupabase();

    if (action === 'approve') {
      const { error } = await publicSupabase
        .from('profiles')
        .update({ status: 'active' })
        .eq('id', memberId);

      if (error) {
        return Response.json({ error: `Database status update failed: ${error.message}` }, { status: 500 });
      }
      return Response.json({ success: true, status: 'active' });
    }

    if (action === 'unapprove') {
      const { error } = await publicSupabase
        .from('profiles')
        .update({ status: 'pending' })
        .eq('id', memberId);

      if (error) {
        return Response.json({ error: `Database status update failed: ${error.message}` }, { status: 500 });
      }
      return Response.json({ success: true, status: 'pending' });
    }

    if (action === 'make_admin') {
      const { error } = await publicSupabase
        .from('profiles')
        .update({ role: 'admin', status: 'active' })
        .eq('id', memberId);

      if (error) {
        return Response.json({ error: `Database role update failed: ${error.message}` }, { status: 500 });
      }
      return Response.json({ success: true, role: 'admin', status: 'active' });
    }

    return Response.json({ error: 'Invalid action specified.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
