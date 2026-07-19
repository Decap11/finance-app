import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function POST(request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const body = await request.json();
    const { saccoId, planTier } = body;

    if (!saccoId || !planTier) {
      return Response.json({ error: 'SACCO ID and Plan Tier are required.' }, { status: 400 });
    }

    let memberLimit = 50;
    if (planTier === 'premium' || planTier === 'enterprise') memberLimit = 1000;
    else if (planTier === 'standard') memberLimit = 250;

    const { data: updated, error } = await supabase
      .from('saccos')
      .update({
        member_limit: memberLimit,
        updated_at: new Date().toISOString()
      })
      .eq('id', saccoId)
      .select('*')
      .single();

    if (error) {
      return Response.json({ error: 'Failed to update plan tier: ' + error.message }, { status: 500 });
    }

    // Log audit event
    try {
      await supabase.from('audit_events').insert({
        sacco_id: saccoId,
        entity_type: 'sacco',
        entity_id: saccoId,
        action: 'tier_change',
        metadata: { description: `Subscription tier updated to ${planTier.toUpperCase()} (${memberLimit} user limit)` }
      });
    } catch (e) {
      // Non-blocking
    }

    return Response.json({ success: true, sacco: updated });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
