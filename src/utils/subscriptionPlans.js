/**
 * The subscription catalogue. One definition, imported by the plans API, the checkout
 * page and the checkout API.
 *
 * The checkout route re-reads the price from here rather than accepting the amount the
 * browser posts, so a tampered request cannot buy Premium for a shilling. Anything that
 * needs to know what a plan costs must import this rather than restating a number.
 *
 * `id` matches `saccos.subscription_plan`, whose CHECK constraint lists exactly these three
 * ids as of migration 0036 -- which is also what retired 'enterprise', a tier the app never
 * sold. Nothing here writes the column even so: a checkout records a request, and a
 * platform operator activates it. 0016 deliberately revoked the tenant admin's UPDATE grant
 * on every subscription column for exactly that reason.
 */

export const SUBSCRIPTION_PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    badge: 'STARTER',
    description: 'Free trial covering your onboarding month, so a committee can run a full cycle before paying.',
    price: 0,
    originalPrice: null,
    billingCycle: 'onboarding month',
    durationMonths: 1,
    isTrial: true,
    recommended: false,
    features: [
      'Valid for your month of onboarding',
      'Weekly contributions and attendance',
      'Member and loan management',
      'No payment details required'
    ]
  },
  {
    id: 'standard',
    name: 'Standard',
    badge: 'PRO SACCO',
    description: 'The everyday plan for an active SACCO running weekly meetings.',
    price: 60000,
    // Shown struck through next to the live price. Null on plans that are not discounted.
    originalPrice: 75000,
    billingCycle: 'month',
    durationMonths: 1,
    isTrial: false,
    recommended: true,
    features: [
      'Everything in Basic',
      'Unlimited weekly cycles',
      'Absence and general fines',
      'PDF audit reports and dividends',
      'Priority support'
    ]
  },
  {
    id: 'premium',
    name: 'Premium',
    badge: 'ENTERPRISE',
    description: 'Billed once for a full quarter, for groups that would rather not renew monthly.',
    price: 200000,
    originalPrice: null,
    billingCycle: '3 months',
    durationMonths: 3,
    isTrial: false,
    recommended: false,
    features: [
      'Everything in Standard',
      'Three months in one payment',
      'Dedicated onboarding session',
      'Custom report exports',
      'Named account manager'
    ]
  }
];

export function getPlan(planId) {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId) || null;
}

/**
 * The catalogue ids, in catalogue order. This is the list `saccos.subscription_plan` is
 * constrained to (migration 0036), so anything validating that column reads it from here
 * rather than restating the three strings.
 */
export const PLAN_IDS = SUBSCRIPTION_PLANS.map((plan) => plan.id);

/**
 * What a plan works out at per month.
 *
 * `price` is what is charged per billing *term*, and a term is not always a month --
 * premium is one payment of 200,000 covering three. Anything summing plans into a monthly
 * figure (the developer portal's platform income metric) has to divide first, or a
 * quarterly plan is counted at three times what it earns per month.
 */
export function planMonthlyPrice(plan) {
  if (!plan) return 0;
  const months = Number(plan.durationMonths) || 1;
  return (Number(plan.price) || 0) / months;
}

export const PAYMENT_PROVIDERS = [
  {
    id: 'mtn',
    name: 'MTN Mobile Money',
    shortName: 'MTN MoMo',
    color: '#ffcc00',
    // Prefixes are shown as guidance only. Numbers are not validated against them --
    // operators reassign ranges, and rejecting a valid number is worse than accepting an
    // unusual one that the payment prompt will fail on anyway.
    hint: 'Numbers starting 077, 078 or 076'
  },
  {
    id: 'airtel',
    name: 'Airtel Money',
    shortName: 'Airtel Money',
    color: '#e30613',
    hint: 'Numbers starting 070, 074 or 075'
  }
];

export function getProvider(providerId) {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === providerId) || null;
}
