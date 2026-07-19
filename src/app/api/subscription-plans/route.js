import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const DEFAULT_PLANS = [
  {
    id: "basic",
    name: "Basic Plan",
    price: 0,
    billing_cycle: "month",
    member_limit: 50,
    description: "Free for the very first month of onboarding for every tenant / SACCO group.",
    features: ["Basic contribution tracking", "Access to savings and loans overview", "Email notifications"]
  },
  {
    id: "standard",
    name: "Standard Plan",
    price: 75000,
    billing_cycle: "month",
    member_limit: 250,
    description: "Best for active growing SACCOs with regular savings.",
    features: ["Enhanced payment reminders", "Priority support", "Loan eligibility alerts"]
  },
  {
    id: "premium",
    name: "Premium Plan",
    price: 200000,
    billing_cycle: "3 months",
    member_limit: 1000,
    description: "For SACCOs who want full control and advanced insights.",
    features: ["Custom savings goals", "Real-time payment history", "Dedicated account support", "Valid for 3 months"]
  }
];

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    if (error || !plans || plans.length === 0) {
      return Response.json({ plans: DEFAULT_PLANS });
    }

    const formattedPlans = plans.map(p => ({
      id: p.id,
      name: p.name,
      price: Number(p.price) || 0,
      billing_cycle: p.billing_cycle || 'month',
      member_limit: p.member_limit || 50,
      description: p.description || '',
      features: typeof p.features === 'string' ? JSON.parse(p.features) : (p.features || [])
    }));

    return Response.json({ plans: formattedPlans });
  } catch (err) {
    return Response.json({ plans: DEFAULT_PLANS });
  }
}

export async function POST(request) {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const body = await request.json();
    const { planId, price, memberLimit, billingCycle, description } = body;

    if (!planId) {
      return Response.json({ error: 'Plan ID is required.' }, { status: 400 });
    }

    const parsedPrice = Number(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return Response.json({ error: 'Price must be a non-negative number.' }, { status: 400 });
    }

    const updatePayload = {
      price: parsedPrice,
      updated_at: new Date().toISOString()
    };

    if (memberLimit !== undefined) updatePayload.member_limit = Number(memberLimit) || 50;
    if (billingCycle !== undefined) updatePayload.billing_cycle = billingCycle;
    if (description !== undefined) updatePayload.description = description;

    const { data: updated, error } = await supabase
      .from('subscription_plans')
      .update(updatePayload)
      .eq('id', planId)
      .select('*')
      .single();

    if (error) {
      return Response.json({ error: 'Failed to update subscription plan: ' + error.message }, { status: 500 });
    }

    return Response.json({ success: true, plan: updated });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
