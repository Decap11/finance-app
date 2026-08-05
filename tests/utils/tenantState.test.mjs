import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  tenantState,
  canHold,
  GRACE_DAYS,
  TENANT_STATES
} from '../../src/utils/tenantState.js';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const DAY = 86400000;

/** An expiry N days in the future (negative N puts it in the past). */
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

/** A tenant nobody has acted on, paid up with a month to run. */
const healthy = {
  status: 'active',
  subscription_status: 'active',
  subscription_expires_at: inDays(30)
};

describe('platform decisions outrank billing', () => {
  test('a closed tenant is closed however healthy its subscription', () => {
    const state = tenantState({ ...healthy, status: 'closed' }, NOW);
    assert.equal(state.id, 'closed');
    assert.equal(state.decidedBy, 'platform');
    assert.equal(state.blocksMembers, true);
  });

  test('a suspended tenant is suspended even while paid up', () => {
    const state = tenantState({ ...healthy, status: 'suspended' }, NOW);
    assert.equal(state.id, 'suspended');
    assert.equal(state.blocksMembers, true);
  });

  test('a held tenant reads as held, not as whatever billing says underneath', () => {
    const state = tenantState(
      { status: 'on_hold', subscription_status: 'past_due', subscription_expires_at: inDays(-40) },
      NOW
    );
    assert.equal(state.id, 'on_hold');
    assert.equal(state.decidedBy, 'platform');
    assert.equal(state.needsPayment, true);
    // The overdue count survives, because the hold notice quotes it.
    assert.equal(state.daysOverdue, 40);
  });

  test('a suspension explains itself with the operator reason', () => {
    const state = tenantState(
      { ...healthy, status: 'suspended', status_reason: 'Fraudulent registration.' },
      NOW
    );
    assert.equal(state.detail, 'Fraudulent registration.');
  });
});

describe('billing decides when no developer has acted', () => {
  test('paid up and in date is paid', () => {
    const state = tenantState(healthy, NOW);
    assert.equal(state.id, 'paid');
    assert.equal(state.inGoodStanding, true);
    assert.equal(state.blocksMembers, false);
    assert.equal(state.daysLeft, 30);
  });

  test('a live trial is a trial, and says how long is left', () => {
    const state = tenantState(
      { status: 'active', subscription_status: 'trial', subscription_expires_at: inDays(12) },
      NOW
    );
    assert.equal(state.id, 'trial');
    assert.equal(state.inGoodStanding, true);
    assert.match(state.detail, /12 days/);
  });

  test('cancelled beats the calendar -- a future expiry does not rescue it', () => {
    const state = tenantState({ ...healthy, subscription_status: 'cancelled' }, NOW);
    assert.equal(state.id, 'cancelled');
    assert.equal(state.holdRecommended, true);
  });

  test('an operator marking past_due outranks an expiry still in the future', () => {
    // The date says when the term ends; it does not say whether the money arrived.
    const state = tenantState({ ...healthy, subscription_status: 'past_due' }, NOW);
    assert.equal(state.id, 'overdue');
    assert.equal(state.inGoodStanding, false);
  });
});

describe('the clock moves a tenant on its own', () => {
  test('the day before expiry it is still paid', () => {
    assert.equal(tenantState({ ...healthy, subscription_expires_at: inDays(1) }, NOW).id, 'paid');
  });

  test('one day past expiry it is in grace, not overdue', () => {
    const state = tenantState({ ...healthy, subscription_expires_at: inDays(-1) }, NOW);
    assert.equal(state.id, 'grace');
    assert.equal(state.daysOverdue, 1);
    assert.equal(state.graceDaysLeft, GRACE_DAYS - 1);
  });

  test('the last day of grace is still grace', () => {
    const state = tenantState({ ...healthy, subscription_expires_at: inDays(-GRACE_DAYS) }, NOW);
    assert.equal(state.id, 'grace');
    assert.equal(state.graceDaysLeft, 0);
  });

  test('the day after grace runs out it is overdue', () => {
    const state = tenantState({ ...healthy, subscription_expires_at: inDays(-GRACE_DAYS - 1) }, NOW);
    assert.equal(state.id, 'overdue');
    assert.match(state.detail, /past the .* grace period/);
  });

  test('the same row reads differently as time passes -- nothing was written', () => {
    const row = { ...healthy, subscription_expires_at: inDays(0.5) };
    assert.equal(tenantState(row, NOW).id, 'paid');
    assert.equal(tenantState(row, NOW + 2 * DAY).id, 'grace');
    assert.equal(tenantState(row, NOW + 30 * DAY).id, 'overdue');
  });

  test('a stored status left saying "active" does not keep a lapsed tenant paid', () => {
    // This is the stale-label case: nothing flips subscription_status when the date passes.
    const state = tenantState(
      { status: 'active', subscription_status: 'active', subscription_expires_at: inDays(-60) },
      NOW
    );
    assert.equal(state.id, 'overdue');
    assert.equal(state.daysOverdue, 60);
  });
});

describe('missing and malformed rows', () => {
  test('a row with no subscription columns at all is a trial, not a crash', () => {
    const state = tenantState({ status: 'active' }, NOW);
    assert.equal(state.id, 'trial');
    assert.equal(state.expiresAt, null);
  });

  test('no row at all still yields a state', () => {
    assert.equal(tenantState(null, NOW).id, 'trial');
    assert.equal(tenantState(undefined, NOW).id, 'trial');
  });

  test('an unparseable expiry is ignored rather than read as 1970', () => {
    const state = tenantState({ ...healthy, subscription_expires_at: 'not a date' }, NOW);
    assert.equal(state.id, 'paid');
    assert.equal(state.daysOverdue, 0);
  });

  test('an absent status means active, so billing decides', () => {
    const state = tenantState({ subscription_status: 'active', subscription_expires_at: inDays(5) }, NOW);
    assert.equal(state.id, 'paid');
  });

  test('every state carries the fields the UI reads', () => {
    for (const id of Object.keys(TENANT_STATES)) {
      const state = TENANT_STATES[id];
      assert.equal(state.id, id, `${id} knows its own id`);
      assert.ok(state.label, `${id} has a label`);
      assert.ok(state.tone, `${id} has a tone`);
      assert.ok(['platform', 'billing'].includes(state.decidedBy), `${id} says who decided`);
    }
  });
});

describe('canHold', () => {
  test('refuses a tenant in good standing', () => {
    assert.equal(canHold(healthy, NOW), false);
    assert.equal(canHold({ ...healthy, subscription_status: 'trial' }, NOW), false);
  });

  test('permits one that has lapsed, including during grace', () => {
    // Grace is a recommendation not to hold yet, not a prohibition: an operator who knows
    // the group is gone should not be made to wait a week.
    assert.equal(canHold({ ...healthy, subscription_expires_at: inDays(-2) }, NOW), true);
    assert.equal(canHold({ ...healthy, subscription_expires_at: inDays(-40) }, NOW), true);
    assert.equal(canHold({ ...healthy, subscription_status: 'cancelled' }, NOW), true);
  });

  test('refuses a tenant already held, suspended or closed', () => {
    const lapsed = { subscription_status: 'past_due', subscription_expires_at: inDays(-40) };
    assert.equal(canHold({ ...lapsed, status: 'on_hold' }, NOW), false);
    assert.equal(canHold({ ...lapsed, status: 'suspended' }, NOW), false);
    assert.equal(canHold({ ...lapsed, status: 'closed' }, NOW), false);
  });

  test('agrees with the state it derives, on every shape tested here', () => {
    const rows = [
      healthy,
      { ...healthy, subscription_status: 'trial' },
      { ...healthy, subscription_expires_at: inDays(-2) },
      { ...healthy, subscription_expires_at: inDays(-40) },
      { ...healthy, subscription_status: 'cancelled' },
      { ...healthy, status: 'on_hold' },
      { ...healthy, status: 'suspended' }
    ];

    for (const row of rows) {
      const state = tenantState(row, NOW);
      const expected = !state.inGoodStanding && !state.blocksMembers
        ? true
        : state.id === 'cancelled';
      assert.equal(canHold(row, NOW), expected, `canHold matches ${state.id}`);
    }
  });
});
