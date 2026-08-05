/**
 * What state a SACCO tenant is actually in — expressed once.
 *
 * THE PROBLEM THIS SOLVES
 *   A tenant's condition was stored as two unrelated columns and read as whichever one the
 *   screen happened to look at. `saccos.status` records what a platform operator last
 *   *decided* (active / on_hold / suspended / closed) and `saccos.subscription_status`
 *   records what billing *says* (trial / active / past_due / expired / cancelled) — and
 *   neither is the answer on its own:
 *
 *     - status alone is stale by construction. It only changes when somebody clicks. A
 *       SACCO whose subscription lapsed two months ago still reads "active", because
 *       nothing about the passage of time writes to that column.
 *     - subscription_status alone is stale too. Nothing flips it to 'expired' when the
 *       expiry date passes; the date is the fact and the column is a label that lags it.
 *     - and subscription_status says nothing about a tenant a developer suspended for a
 *       reason that has nothing to do with money.
 *
 *   So the portal's Status column answered "what did someone last click", which is not the
 *   question anybody was asking it.
 *
 * THE RULE
 *   A platform decision outranks billing, and billing outranks nothing. In precedence:
 *
 *     closed     > suspended > on_hold      -- a developer acted; that is the state
 *     cancelled  > overdue   > grace        -- billing, worst first
 *     trial      > paid                     -- billing, in good standing
 *
 *   Everything below `on_hold` is derived from the subscription and the clock, so it
 *   changes by itself: a tenant moves paid → grace → overdue with nobody touching
 *   anything, which is the whole point.
 *
 * WHAT THIS DOES NOT DO
 *   Deriving a state is not enforcing one. `blocksMembers` is true only for the three
 *   states a developer set deliberately — a tenant drifting into `overdue` is shown as
 *   overdue and its admin is asked to pay, but its members are not locked out until
 *   somebody holds it. That line is deliberate: the enforcement trigger in migration 0016
 *   keys off `saccos.status`, and moving it onto a date would lock out every tenant whose
 *   backfilled trial expiry (0016 set it to created_at + 30 days) is already in the past —
 *   which is most of them. Auto-holding is a policy decision with a blast radius, not a
 *   display fix.
 */

/**
 * Days a lapsed subscription keeps working before it reads as overdue.
 *
 * A grace window exists because the expiry date and the payment landing are never the same
 * moment — mobile money is confirmed by a person, and a SACCO that paid on the day should
 * not spend the next morning marked delinquent.
 */
export const GRACE_DAYS = 7;

const DAY_MS = 86400000;

/**
 * Every state a tenant can be in.
 *
 * `tone` is the visual family, not a colour — each surface maps it to its own palette.
 * `decidedBy` says which of the two inputs produced this state, which is what lets the UI
 * explain itself ("a developer did this" vs "this happened on its own").
 */
export const TENANT_STATES = {
  closed: {
    id: 'closed',
    label: 'Closed',
    tone: 'dead',
    decidedBy: 'platform',
    blocksMembers: true,
    needsPayment: false,
    inGoodStanding: false,
    holdRecommended: false
  },
  suspended: {
    id: 'suspended',
    label: 'Suspended',
    tone: 'dead',
    decidedBy: 'platform',
    blocksMembers: true,
    needsPayment: false,
    inGoodStanding: false,
    holdRecommended: false
  },
  on_hold: {
    id: 'on_hold',
    label: 'On hold',
    tone: 'held',
    decidedBy: 'platform',
    blocksMembers: true,
    needsPayment: true,
    inGoodStanding: false,
    holdRecommended: false
  },
  cancelled: {
    id: 'cancelled',
    label: 'Cancelled',
    tone: 'due',
    decidedBy: 'billing',
    blocksMembers: false,
    needsPayment: true,
    inGoodStanding: false,
    holdRecommended: true
  },
  overdue: {
    id: 'overdue',
    label: 'Payment due',
    tone: 'due',
    decidedBy: 'billing',
    blocksMembers: false,
    needsPayment: true,
    inGoodStanding: false,
    holdRecommended: true
  },
  grace: {
    id: 'grace',
    label: 'Grace period',
    tone: 'warn',
    decidedBy: 'billing',
    blocksMembers: false,
    needsPayment: true,
    // Deliberately not in good standing: a hold during grace stays *permitted*, so an
    // operator who knows a tenant is gone is not made to wait a week. It is simply not
    // recommended, which is what holdRecommended carries.
    inGoodStanding: false,
    holdRecommended: false
  },
  trial: {
    id: 'trial',
    label: 'Trial',
    tone: 'info',
    decidedBy: 'billing',
    blocksMembers: false,
    needsPayment: false,
    inGoodStanding: true,
    holdRecommended: false
  },
  paid: {
    id: 'paid',
    label: 'Paid',
    tone: 'ok',
    decidedBy: 'billing',
    blocksMembers: false,
    needsPayment: false,
    inGoodStanding: true,
    holdRecommended: false
  }
};

/** Lifecycle values that mean "a developer decided this", worst first. */
const PLATFORM_STATES = ['closed', 'suspended', 'on_hold'];

/** Subscription values that are paid up. Anything else owes money. */
const GOOD_STANDING = ['trial', 'active'];

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days from `from` to `to`, floored, never negative. */
function daysBetween(from, to) {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/**
 * The state a tenant is in right now.
 *
 * Takes the SACCO row as the database holds it, so every caller passes the same thing and
 * none of them has to know which columns matter.
 *
 * @param {object} sacco  a `saccos` row: status, status_reason, subscription_status,
 *                        subscription_expires_at
 * @param {number} now    epoch ms, injectable so this is testable and so a server and a
 *                        browser rendering the same row agree
 * @returns {object} the matched TENANT_STATES entry, plus the numbers behind it
 */
export function tenantState(sacco, now = Date.now()) {
  const status = (sacco?.status || 'active').trim();
  const stored = (sacco?.subscription_status || 'trial').trim();
  const expiresAt = toDate(sacco?.subscription_expires_at);

  const expiryMs = expiresAt ? expiresAt.getTime() : null;
  const isExpired = expiryMs !== null && expiryMs < now;
  const daysOverdue = isExpired ? daysBetween(expiryMs, now) : 0;
  const daysLeft = expiryMs !== null && !isExpired ? daysBetween(now, expiryMs) : 0;

  const numbers = {
    storedSubscription: stored,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    daysOverdue,
    daysLeft,
    graceDaysLeft: isExpired ? Math.max(0, GRACE_DAYS - daysOverdue) : 0,
    reason: sacco?.status_reason || ''
  };

  // 1. A developer acted. Nothing about billing changes what that means.
  if (PLATFORM_STATES.includes(status)) {
    return finish(TENANT_STATES[status], numbers);
  }

  // 2. Billing, worst first. A cancelled subscription is cancelled whatever the date says.
  if (stored === 'cancelled') {
    return finish(TENANT_STATES.cancelled, numbers);
  }

  // An operator marking a tenant past_due or expired is stating a fact about payment that
  // outranks a date still in the future -- the date says when the term ends, not whether
  // the money arrived.
  if (!GOOD_STANDING.includes(stored)) {
    return finish(
      daysOverdue > 0 && daysOverdue <= GRACE_DAYS ? TENANT_STATES.grace : TENANT_STATES.overdue,
      numbers
    );
  }

  // 3. The date decides for a tenant whose stored status is still optimistic.
  if (isExpired) {
    return finish(daysOverdue <= GRACE_DAYS ? TENANT_STATES.grace : TENANT_STATES.overdue, numbers);
  }

  return finish(stored === 'trial' ? TENANT_STATES.trial : TENANT_STATES.paid, numbers);
}

function finish(state, numbers) {
  return { ...state, ...numbers, detail: describeState(state.id, numbers) };
}

/**
 * One line explaining the state, in the terms the reader cares about: how long, and what
 * happens next. Written for whoever is looking at it -- an operator in the portal and a
 * SACCO admin in the app both read this string.
 */
export function describeState(stateId, numbers) {
  const { daysOverdue, daysLeft, graceDaysLeft, reason, expiresAt } = numbers;
  const plural = (n) => (n === 1 ? '' : 's');

  switch (stateId) {
    case 'closed':
      return reason || 'This account has been closed.';

    case 'suspended':
      return reason || 'Suspended by the platform.';

    case 'on_hold':
      return reason
        || (daysOverdue > 0
          ? `Held for non-payment — ${daysOverdue} day${plural(daysOverdue)} overdue.`
          : 'Held pending subscription payment.');

    case 'cancelled':
      return 'The subscription was cancelled. Members keep working until it is held.';

    case 'overdue':
      return daysOverdue > 0
        ? `${daysOverdue} day${plural(daysOverdue)} overdue — past the ${GRACE_DAYS}-day grace period.`
        : 'Marked unpaid. No payment has been recorded.';

    case 'grace':
      return graceDaysLeft > 0
        ? `Lapsed ${daysOverdue} day${plural(daysOverdue)} ago — ${graceDaysLeft} day${plural(graceDaysLeft)} of grace left.`
        : 'Grace period ends today.';

    case 'trial':
      return daysLeft > 0
        ? `Trial ends in ${daysLeft} day${plural(daysLeft)}.`
        : 'On trial.';

    case 'paid':
      return expiresAt
        ? `Paid through ${expiresAt.split('T')[0]}.`
        : 'Paid up. No renewal date set.';

    default:
      return '';
  }
}

/**
 * Whether a billing hold is allowed at all.
 *
 * Kept as its own export because it is a rule, not a description: `/api/platform` refuses
 * the action on this basis, and the portal disables the button on the same basis, so the
 * two cannot disagree about what the button does.
 */
export function canHold(sacco, now = Date.now()) {
  const state = tenantState(sacco, now);
  if (state.id === 'on_hold' || state.id === 'suspended' || state.id === 'closed') return false;
  return !state.inGoodStanding;
}
