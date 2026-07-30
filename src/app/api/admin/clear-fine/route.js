import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

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

    // 1. Authenticate caller
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    // 2. Verify caller is an admin
    const { data: callerProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('role, group_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !callerProfile || callerProfile.role !== 'admin') {
      return Response.json({ error: 'Unauthorized. Only SACCO admins can clear absenteeism fines.' }, { status: 403 });
    }

    // Load request body
    const body = await request.json();
    const { transactionId, memberId, weekNum } = body;

    if (!transactionId && (!memberId || !weekNum)) {
      return Response.json({ error: 'Missing required parameters: transactionId or (memberId and weekNum).' }, { status: 400 });
    }

    // 3. Mark fine transaction as completed / approved
    let query = supabase
      .from('transactions')
      .update({
        status: 'completed',
        approved_by: user.id,
        completed_at: new Date().toISOString()
      });

    if (transactionId) {
      query = query.eq('id', transactionId);
    } else {
      query = query.eq('profile_id', memberId).eq('category', 'fines').ilike('description', `%Week ${weekNum}`);
    }

    const { data: updatedTx, error: updateErr } = await query.select();

    if (updateErr) {
      return Response.json({ error: 'Failed to clear absenteeism fine: ' + updateErr.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      message: 'Absenteeism fine marked as paid/cleared successfully.',
      updated: updatedTx
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Server error clearing absenteeism fine.' }, { status: 500 });
  }
}
