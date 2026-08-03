import { SUBSCRIPTION_PLANS } from '../../../utils/subscriptionPlans';

/**
 * The plan catalogue.
 *
 * Public and unauthenticated by design -- it is a price list, and the payments section
 * renders before anything about the caller matters. The component that consumes it has
 * always fetched this path; until now the route did not exist, so the plans grid fetched
 * a 404 and rendered empty.
 *
 * Field names are snake_cased on the way out to match what the component already reads.
 */
export async function GET() {
  const plans = SUBSCRIPTION_PLANS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    badge: plan.badge,
    description: plan.description,
    price: plan.price,
    original_price: plan.originalPrice,
    billing_cycle: plan.billingCycle,
    duration_months: plan.durationMonths,
    is_trial: plan.isTrial,
    recommended: plan.recommended,
    features: plan.features
  }));

  return Response.json({ plans });
}
