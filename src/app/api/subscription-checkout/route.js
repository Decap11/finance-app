import { createClient } from '@supabase/supabase-js';
import { getPlan, getProvider } from '../../../utils/subscriptionPlans';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Records a subscription request.
 *
 * It does NOT take payment and does NOT activate a plan. No collection gateway is
 * connected, and `saccos.subscription_plan` is platform-controlled -- migration 0016
 * revoked the tenant admin's UPDATE grant on every subscription column so a SACCO cannot
 * promote itself. This writes an audit_events row that a platform operator acts on.
 *
 * The amount is never read from the request body. It comes from the plan catalogue by id,
 * so a crafted request cannot record Premium as having been bought for a shilling.
 */
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1];
    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    const { planId, provider: providerId, phone } = await request.json();

    const plan = getPlan(planId);
    if (!plan) {
      return Response.json({ error: 'Unknown subscription plan.' }, { status: 400 });
    }

    // A paid plan needs a network and a number; the trial needs neither.
    let provider = null;
    if (!plan.isTrial) {
      provider = getProvider(providerId);
      if (!provider) {
        return Response.json({ error: 'Choose MTN Mobile Money or Airtel Money.' }, { status: 400 });
      }

      const digits = String(phone || '').replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 13) {
        return Response.json({ error: 'Enter a valid mobile money number.' }, { status: 400 });
      }
    }

    // Only a SACCO admin may commit their group to a subscription.
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role, group_id, full_name')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || profile.role !== 'admin') {
      return Response.json({
        error: 'Only a SACCO admin can change the subscription plan.'
      }, { status: 403 });
    }

    const { data: sacco, error: saccoErr } = await supabase
      .from('saccos')
      .select('id, name, group_code')
      .ilike('group_code', (profile.group_id || '').trim())
      .limit(1)
      .maybeSingle();

    if (saccoErr || !sacco) {
      return Response.json({ error: 'Could not find your SACCO.' }, { status: 400 });
    }

    const reference = `SUB-${sacco.group_code}-${plan.id.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    const { error: logErr } = await supabase.from('audit_events').insert({
      sacco_id: sacco.id,
      entity_type: 'subscription_payment_intent',
      action: `request_${plan.id}`,
      metadata: {
        reference,
        plan_id: plan.id,
        plan_name: plan.name,
        // From the catalogue, never from the request body.
        amount: plan.price,
        currency: 'UGX',
        duration_months: plan.durationMonths,
        provider: provider?.id || null,
        provider_name: provider?.name || null,
        phone: plan.isTrial ? null : String(phone || '').trim(),
        requested_by: user.id,
        requested_by_name: profile.full_name || null,
        group_code: sacco.group_code,
        status: 'awaiting_confirmation',
        requested_at: new Date().toISOString()
      }
    });

    if (logErr) {
      return Response.json({
        error: 'Could not record your request: ' + logErr.message
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      reference,
      plan: plan.id,
      amount: plan.price,
      message: plan.isTrial
        ? `Your Basic trial is on record for ${sacco.name}. It covers the rest of your onboarding month.`
        : `We have your request to pay UGX ${plan.price.toLocaleString()} by ${provider.name}. ` +
          `Quote reference ${reference} when our team contacts you to confirm activation.`
    });
  } catch (err) {
    return Response.json({
      error: err.message || 'Server error submitting this request.'
    }, { status: 500 });
  }
}
