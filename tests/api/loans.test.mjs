import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoute } from '../helpers/routeModule.mjs';
import { stubClientFactory, fakeRequest } from '../helpers/supabaseStub.mjs';

/**
 * /api/loans -- the largest untested money route until now.
 *
 * The property most worth pinning here is not a status code. It is that the staff actions
 * on this route perform NO role check in JavaScript. Read PATCH and you will not find one:
 * `confirm_fee` authenticates the caller and goes straight to the RPC. The check that stops
 * a member confirming their own application fee -- and thereby advancing their own loan
 * toward disbursement -- lives inside `confirm_loan_application_fee`, which is
 * SECURITY DEFINER and resolves the caller through `auth.uid()`.
 *
 * That design is fine, and arguably better than checking in the route, because the
 * enforcement sits next to the data. But it rests entirely on the client carrying the
 * caller's JWT. Build that client from the service-role key instead -- an easy and
 * plausible-looking "fix" for a permissions error -- and `auth.uid()` is NULL inside the
 * function, so its authorization check has nothing to check. That is security invariant 4
 * in ai-context.md §10, and nothing about the route's response reveals whether it holds.
 *
 * So these tests assert which client the call went out on, not just what came back.
 */

const ROUTE = 'src/app/api/loans/route.js';

const ADMIN = { id: 'u-admin', email: 'admin@sacco.test' };
const MEMBER = { id: 'u-member', email: 'member@sacco.test' };

function fixture() {
  return {
    __tokens: { 'admin-token': ADMIN, 'member-token': MEMBER },
    __rpcs: {
      confirm_loan_application_fee: () => ({ data: null, error: null }),
      apply_loan_late_fees: () => ({ data: { loans_charged: 2 }, error: null })
    },
    profiles: [
      { id: ADMIN.id, group_id: 'PEW-001', role: 'admin' },
      { id: MEMBER.id, group_id: 'PEW-001', role: 'member' }
    ],
    saccos: [{ id: 'sacco-1', group_code: 'PEW-001', name: 'Pewosa Test' }]
  };
}

describe('/api/loans', () => {
  let createClient;
  let mod;

  beforeEach(async () => {
    createClient = stubClientFactory(fixture());
    mod = await loadRoute(ROUTE, { createClient });
  });

  describe('PATCH confirm_fee', () => {
    test('forwards the caller JWT into the RPC rather than using the service role', async () => {
      const res = await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { action: 'confirm_fee', loanId: 'loan-9' }
      ));

      assert.equal(res.status, 200);

      const call = createClient.state.rpcs.find(
        (r) => r.fn === 'confirm_loan_application_fee'
      );
      assert.ok(call, 'confirm_loan_application_fee was never called.');

      assert.equal(call.keyKind, 'anon',
        'The fee confirmation went out on a service-role client. auth.uid() is NULL there, '
        + 'so confirm_loan_application_fee cannot tell an admin from the borrower, and the '
        + 'only thing stopping a member confirming their own fee is gone.');

      assert.equal(call.token, 'admin-token',
        'The RPC client carried no caller token, so auth.uid() resolves to NULL inside the '
        + 'function and its authorization check has nothing to check.');
    });

    test('passes the loan id from the body straight through, unmodified', async () => {
      await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { action: 'confirm_fee', loanId: 'loan-9' }
      ));

      const call = createClient.state.rpcs.find(
        (r) => r.fn === 'confirm_loan_application_fee'
      );
      assert.deepEqual(call.args, { p_loan_id: 'loan-9' });
    });

    test('a missing loan id is refused before the RPC is reached', async () => {
      const res = await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { action: 'confirm_fee' }
      ));

      assert.equal(res.status, 400);
      assert.equal(
        createClient.state.rpcs.length, 0,
        'The RPC ran with no loan id. A SECURITY DEFINER function should not be reached '
        + 'with arguments the route has already established are incomplete.'
      );
    });

    test('a database refusal surfaces as 400, not as success', async () => {
      // What a member confirming someone else's fee actually looks like coming back: the
      // route has no opinion, the function raises, and that has to reach the caller.
      const db = fixture();
      db.__rpcs.confirm_loan_application_fee = () => ({
        data: null,
        error: { message: 'Only SACCO staff may confirm an application fee.' }
      });
      createClient = stubClientFactory(db);
      mod = await loadRoute(ROUTE, { createClient });

      const res = await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'member-token',
        { action: 'confirm_fee', loanId: 'loan-9' }
      ));

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /staff/i);
      assert.notEqual(body.success, true);
    });
  });

  describe('PATCH routing', () => {
    test('an unrecognised action is refused rather than falling through', async () => {
      const res = await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { action: 'write_off_everything', loanId: 'loan-9' }
      ));

      assert.equal(res.status, 400);
      assert.equal(createClient.state.rpcs.length, 0,
        'An unknown action reached the database.');
    });

    test('an absent action is refused', async () => {
      const res = await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { loanId: 'loan-9' }
      ));

      assert.equal(res.status, 400);
    });
  });

  describe('the route never reaches for the service role', () => {
    test('no client is built from the service-role key on any PATCH path', async () => {
      await mod.PATCH(fakeRequest(
        'https://app.test/api/loans',
        'admin-token',
        { action: 'confirm_fee', loanId: 'loan-9' }
      ));

      const serviceClients = createClient.state.clients.filter((c) => c.keyKind === 'service');
      assert.equal(serviceClients.length, 0,
        'This route builds a service-role client. Every write here goes through a '
        + 'SECURITY DEFINER RPC that authorizes via auth.uid(); a service-role client '
        + 'bypasses RLS and blanks auth.uid(), which is invariant 4.');
    });

    test('the source names no service-role key at all', async () => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(ROUTE, 'utf8');
      assert.ok(!src.includes('SUPABASE_SERVICE_ROLE_KEY'),
        'src/app/api/loans/route.js now reads the service-role key. Every operation here '
        + 'is meant to run as the caller.');
    });
  });
});
