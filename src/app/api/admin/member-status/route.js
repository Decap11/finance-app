import { verifyAdmin, getPublicSupabase } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;
    const publicSupabase = getPublicSupabase();

    const body = await request.json();
    const { action, memberId } = body;

    if (!memberId) {
      return Response.json({ error: 'Member ID is required.' }, { status: 400 });
    }

    // Fetch Admin's SACCO record
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .single();

    const groupCode = adminProfile?.group_id;

    // Get target SACCO row
    let saccoRow = null;
    if (groupCode) {
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('*')
        .ilike('group_code', groupCode.trim())
        .limit(1);

      if (saccoData && saccoData.length > 0) {
        saccoRow = saccoData[0];
      }
    }

    if (action === 'approve') {
      await supabase.from('profiles').update({ status: 'active' }).eq('id', memberId);
      await publicSupabase.from('profiles').update({ status: 'active' }).eq('id', memberId);

      // Also update sacco_memberships table status in PostgreSQL
      await supabase.from('sacco_memberships').update({ status: 'active' }).eq('profile_id', memberId);
      await publicSupabase.from('sacco_memberships').update({ status: 'active' }).eq('profile_id', memberId);

      if (saccoRow) {
        await supabase.from('saccos').update({
          updated_at: new Date().toISOString()
        }).eq('id', saccoRow.id);
      }

      return Response.json({ success: true, status: 'active' });
    }

    if (action === 'unapprove') {
      await supabase.from('profiles').update({ status: 'pending' }).eq('id', memberId);
      await publicSupabase.from('profiles').update({ status: 'pending' }).eq('id', memberId);

      // Also update sacco_memberships table status in PostgreSQL
      await supabase.from('sacco_memberships').update({ status: 'pending' }).eq('profile_id', memberId);
      await publicSupabase.from('sacco_memberships').update({ status: 'pending' }).eq('profile_id', memberId);

      if (saccoRow) {
        await supabase.from('saccos').update({
          updated_at: new Date().toISOString()
        }).eq('id', saccoRow.id);
      }

      return Response.json({ success: true, status: 'pending' });
    }

    if (action === 'make_admin') {
      await supabase.from('profiles').update({ role: 'admin', status: 'active' }).eq('id', memberId);
      await publicSupabase.from('profiles').update({ role: 'admin', status: 'active' }).eq('id', memberId);

      // Also update sacco_memberships table role & status in PostgreSQL
      await supabase.from('sacco_memberships').update({ role: 'admin', status: 'active' }).eq('profile_id', memberId);
      await publicSupabase.from('sacco_memberships').update({ role: 'admin', status: 'active' }).eq('profile_id', memberId);

      if (saccoRow) {
        await supabase.from('saccos').update({
          updated_at: new Date().toISOString()
        }).eq('id', saccoRow.id);
      }

      return Response.json({ success: true, role: 'admin', status: 'active' });
    }

    return Response.json({ error: 'Invalid action specified.' }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
