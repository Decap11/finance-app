/**
 * getActiveSaccoSettings -- the single settings read path for the whole app.
 *
 * It is reached with the service role by /api/dues, /api/contribution-habits,
 * /api/user-transactions and this route's own POST, so nothing in it is protected by RLS.
 * Whatever it returns becomes the share price, the weekly fund amounts and the fine and loan
 * fees that the arrears arithmetic runs on -- for whichever group the caller thought it was
 * asking about.
 *
 * It used to guess when a group code matched nothing: first the most recently updated
 * sacco_settings row from ANY group, then a deployment-wide settings.json. A SACCO
 * registered minutes earlier silently inherited a stranger's figures and was told it owed
 * money it had never agreed to. Both guesses are gone; these cases are what keeps them gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRoute } from '../helpers/routeModule.mjs';
import { stubClientFactory } from '../helpers/supabaseStub.mjs';

const settingsRow = (code, saccoId, price, updatedAt) => ({
  group_code: code, sacco_id: saccoId, share_price: price, devt_fund: 2000, social_fund: 5000,
  late_fine_amount: 1000, current_week: 7, meeting_day: 'Monday', is_locked: false,
  is_historical_mode: false, updated_at: updatedAt
});

const db = {
  sacco_settings: [
    settingsRow('PEWOSA-001', 'sacco-a', 30000, '2026-01-01T00:00:00Z'),
    // Deliberately the most recently updated row in the table: this is precisely what the
    // removed fallback returned, so it is what a leak would look like in every case below.
    settingsRow('MAL-999', 'sacco-b', 99000, '2026-08-01T00:00:00Z')
  ],
  saccos: [
    { id: 'sacco-a', group_code: 'PEWOSA-001', created_at: '2026-01-07T00:00:00Z', share_price: 30000 },
    { id: 'sacco-b', group_code: 'MAL-999', created_at: '2026-02-04T00:00:00Z', share_price: 99000 },
    // Registered, but with no sacco_settings row yet -- the auto-seed path.
    { id: 'sacco-c', group_code: 'NEW-777', created_at: '2026-07-01T00:00:00Z', share_price: 12000 }
  ]
};

const LEAKED_PRICE = 99000;

const stub = stubClientFactory(db);
const { getActiveSaccoSettings } = await loadRoute(
  'src/app/api/sacco-settings/route.js', { createClient: stub }
);

test('a known group resolves to its own settings', async () => {
  const s = await getActiveSaccoSettings('PEWOSA-001');
  assert.equal(s.sharePrice, 30000);
  assert.equal(s.currentWeek, 7);
  assert.ok(!s.isDefault);
});

test('an unknown group code returns the defaults, not another group', async () => {
  const s = await getActiveSaccoSettings('GHOST-404');
  assert.equal(s.isDefault, true);
  assert.equal(s.sharePrice, 25000);
  assert.notEqual(s.sharePrice, LEAKED_PRICE);
});

test('no group code at all returns the defaults', async () => {
  const s = await getActiveSaccoSettings(null);
  assert.equal(s.isDefault, true);
  assert.notEqual(s.sharePrice, LEAKED_PRICE);
});

test('a blank group code returns the defaults', async () => {
  const s = await getActiveSaccoSettings('   ');
  assert.equal(s.isDefault, true);
  assert.notEqual(s.sharePrice, LEAKED_PRICE);
});

test('the defaults carry the code that was asked for, so a caller can see the read was scoped', async () => {
  const s = await getActiveSaccoSettings('GHOST-404');
  assert.equal(s.groupCode, 'GHOST-404');
});

// The lookups use `ilike`, which is a pattern operator. The code arrives from a query string.
for (const [name, pattern] of [
  ['%', '%'],
  ['* (PostgREST spells % this way too)', '*'],
  ['a single-character wildcard', 'PEWOSA-00_'],
  ['a prefix wildcard', 'MAL%']
]) {
  test(`${name} cannot be used to match another group's row`, async () => {
    const s = await getActiveSaccoSettings(pattern);
    assert.equal(s.isDefault, true, `${pattern} matched a real row`);
    assert.notEqual(s.sharePrice, LEAKED_PRICE);
  });
}

test('the escaped pattern actually reaches the query', async () => {
  // Guards the stub as much as the route: if ilike were replaced by a literal comparison the
  // cases above would pass for the wrong reason.
  stub.reset();
  await getActiveSaccoSettings('PEWOSA-00_');
  assert.ok(stub.state.patterns.length > 0, 'no ilike was issued');
  assert.ok(
    stub.state.patterns.every((p) => p.pattern.includes('\\_')),
    `underscore was not escaped: ${JSON.stringify(stub.state.patterns)}`
  );
});

test('matching stays case-insensitive, for rows written before codes were normalised', async () => {
  // register_new_sacco stores UPPER(TRIM(...)), but pre-0015 rows went in as typed. An exact
  // match would stop finding those, which is why this is ilike and not eq.
  const s = await getActiveSaccoSettings('pewosa-001');
  assert.ok(!s.isDefault);
  assert.equal(s.sharePrice, 30000);
});

test('a group with no settings row falls through to saccos and is seeded', async () => {
  stub.reset();
  const s = await getActiveSaccoSettings('NEW-777');
  assert.equal(s.sharePrice, 12000);
  assert.equal(stub.state.upserts.length, 1);
});

test('the seed is keyed on the STORED code, not the caller\'s spelling', async () => {
  // The two differ in case for any row written before normalisation. Seeding under the
  // requested spelling would leave the group with two settings rows, which the write path
  // then keeps out of step with each other.
  stub.reset();
  await getActiveSaccoSettings('new-777');
  assert.equal(stub.state.upserts[0].row.group_code, 'NEW-777');
});
