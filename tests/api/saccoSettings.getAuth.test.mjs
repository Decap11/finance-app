/**
 * GET /api/sacco-settings -- who may read a group's configuration.
 *
 * This handler once required nothing at all. `?group_code=BYS-8240` from anywhere on the
 * internet returned that SACCO's share price, fund amounts, fines, loan fees, meeting day and
 * lock state; group codes are ACRONYM-NUMBER, so they can be walked, and the reply told you
 * which ones were real. It also made the route write: getActiveSaccoSettings auto-seeds a
 * sacco_settings row through the service-role client, and an unauthenticated GET was enough
 * to trigger it.
 *
 * Requiring a token alone would not have been enough -- nothing tied ?group_code= to the
 * caller, so any member of any SACCO could still read every other one's figures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRoute } from '../helpers/routeModule.mjs';
import { stubClientFactory, fakeRequest } from '../helpers/supabaseStub.mjs';

const settingsRow = (code, saccoId, price) => ({
  group_code: code, sacco_id: saccoId, share_price: price, devt_fund: 1000, social_fund: 2000,
  late_fine_amount: 500, current_week: 3, meeting_day: 'Monday', is_locked: false,
  is_historical_mode: false, updated_at: '2026-01-01T00:00:00Z'
});

const db = {
  __tokens: {
    'tok-bob': { id: 'bob' },          // plain member of PEWOSA-001
    'tok-frank': { id: 'frank' },      // founded FND-555; no profiles.group_id
    'tok-nomad': { id: 'nomad' },      // membership in NEW-777 only, role 'member'
    'tok-newbie': { id: 'newbie' },    // signed up, linked to nothing
    'tok-multi': { id: 'multi' }       // memberships in two SACCOs, no profiles.group_id
  },
  profiles: [
    { id: 'bob', group_id: 'PEWOSA-001' },
    { id: 'frank', group_id: '' },
    { id: 'nomad', group_id: null },
    { id: 'newbie', group_id: null },
    { id: 'multi', group_id: null }
  ],
  saccos: [
    { id: 'sacco-a', group_code: 'PEWOSA-001', admin_profile_id: 'alice', created_at: '2026-01-07T00:00:00Z' },
    { id: 'sacco-b', group_code: 'MAL-999', admin_profile_id: 'mallory', created_at: '2026-02-04T00:00:00Z' },
    { id: 'sacco-c', group_code: 'NEW-777', admin_profile_id: 'carol', created_at: '2026-03-04T00:00:00Z' },
    { id: 'sacco-f', group_code: 'FND-555', admin_profile_id: 'frank', created_at: '2026-04-01T00:00:00Z' }
  ],
  sacco_memberships: [
    { profile_id: 'bob', sacco_id: 'sacco-a', role: 'member' },
    { profile_id: 'nomad', sacco_id: 'sacco-c', role: 'member' },
    { profile_id: 'multi', sacco_id: 'sacco-a', role: 'member' },
    { profile_id: 'multi', sacco_id: 'sacco-b', role: 'member' }
  ],
  sacco_settings: [
    settingsRow('PEWOSA-001', 'sacco-a', 30000),
    settingsRow('MAL-999', 'sacco-b', 99000),
    settingsRow('NEW-777', 'sacco-c', 12000),
    settingsRow('FND-555', 'sacco-f', 7000)
  ]
};

/** Figures belonging to groups the caller in each case has nothing to do with. */
const FOREIGN_PRICES = [99000, 12000, 7000];

const stub = stubClientFactory(db);
const { GET } = await loadRoute('src/app/api/sacco-settings/route.js', { createClient: stub });

const BASE = 'http://test/api/sacco-settings';

async function get(url, token) {
  stub.reset();
  const res = await GET(fakeRequest(url, token));
  return { status: res.status, body: await res.json(), state: stub.state };
}

// ------------------------------------------------------------ authentication

test('a request with no token is refused', async () => {
  const r = await get(BASE);
  assert.equal(r.status, 401);
  assert.equal(r.body.sharePrice, undefined);
});

test('an unauthenticated read of a named group is refused', async () => {
  const r = await get(`${BASE}?group_code=MAL-999`);
  assert.equal(r.status, 401);
  assert.equal(r.body.sharePrice, undefined);
});

test('an unauthenticated request cannot make the route write', async () => {
  // NEW-777 has a saccos row, so this is the request that used to reach the service-role
  // auto-seed without any credential at all.
  const r = await get(`${BASE}?group_code=NEW-777`);
  assert.equal(r.status, 401);
  assert.equal(r.state.upserts.length, 0);
});

test('a token that resolves to no user is refused', async () => {
  const r = await get(`${BASE}?group_code=PEWOSA-001`, 'tok-forged');
  assert.equal(r.status, 401);
});

// ------------------------------------------------------------ scoping

test('a member reads their own group', async () => {
  const r = await get(`${BASE}?group_code=PEWOSA-001`, 'tok-bob');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 30000);
  assert.ok(!r.body.isDefault);
});

test('reading your own group costs no membership lookup', async () => {
  // The common path, and the settings screen refetches on every realtime event.
  const r = await get(`${BASE}?group_code=PEWOSA-001`, 'tok-bob');
  assert.ok(!r.state.queries.includes('sacco_memberships'));
});

test('a member cannot read another group', async () => {
  const r = await get(`${BASE}?group_code=MAL-999`, 'tok-bob');
  assert.equal(r.status, 403);
  assert.equal(r.body.sharePrice, undefined);
});

test('a code that does not exist is refused identically to one that does', async () => {
  // Otherwise the 403 is an oracle: it would tell a stranger which group codes are real,
  // which is the reconnaissance step the walk-the-codes attack needs.
  const foreign = await get(`${BASE}?group_code=MAL-999`, 'tok-bob');
  const missing = await get(`${BASE}?group_code=GHOST-404`, 'tok-bob');
  assert.equal(missing.status, foreign.status);
  assert.deepEqual(missing.body, foreign.body);
});

for (const pattern of ['%25', '*', 'PEWOSA-00_', 'MAL%25']) {
  test(`the wildcard '${pattern}' is refused`, async () => {
    const r = await get(`${BASE}?group_code=${pattern}`, 'tok-bob');
    assert.equal(r.status, 403);
  });
}

test('the camelCase groupCode alias is scoped too', async () => {
  const r = await get(`${BASE}?groupCode=MAL-999`, 'tok-bob');
  assert.equal(r.status, 403);
});

test('a lowercase spelling of an owned code is accepted', async () => {
  const r = await get(`${BASE}?group_code=pewosa-001`, 'tok-bob');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 30000);
});

// ------------------------------------------------------------ who counts as belonging

test('a founder reads the SACCO they founded, with no profiles.group_id', async () => {
  // saccoSettings.jsx falls back to the founded SACCO's code when the profile's group_id
  // resolves to no row, so this path legitimately asks for a code that is not group_id.
  const r = await get(`${BASE}?group_code=FND-555`, 'tok-frank');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 7000);
});

test('a membership of any role is enough to read -- not just admin', async () => {
  // Wider than the write path on purpose: every member sees the share price, but only an
  // admin may change it.
  const r = await get(`${BASE}?group_code=NEW-777`, 'tok-nomad');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 12000);
});

test('a founder of one group still cannot read another', async () => {
  const r = await get(`${BASE}?group_code=MAL-999`, 'tok-frank');
  assert.equal(r.status, 403);
});

test('someone linked to nothing cannot name a group', async () => {
  const r = await get(`${BASE}?group_code=PEWOSA-001`, 'tok-newbie');
  assert.equal(r.status, 403);
});

// ------------------------------------------------------------ no group code named

test('with no code named, the caller\'s own group answers', async () => {
  // Several screens ask this way. It used to be answered with whichever group's row had been
  // saved most recently.
  const r = await get(BASE, 'tok-bob');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 30000);
  assert.ok(!r.body.isDefault);
});

test('with no code named and one membership, that SACCO answers', async () => {
  const r = await get(BASE, 'tok-nomad');
  assert.equal(r.status, 200);
  assert.equal(r.body.sharePrice, 12000);
});

test('with no code named and no SACCO, the defaults answer', async () => {
  // A member between registration and approval. The defaults describe nobody, so this is
  // answered rather than refused -- the progress tracker still renders.
  const r = await get(BASE, 'tok-newbie');
  assert.equal(r.status, 200);
  assert.equal(r.body.isDefault, true);
  assert.ok(!FOREIGN_PRICES.includes(r.body.sharePrice));
});

test('with no code named and two memberships, the caller must say which', async () => {
  const r = await get(BASE, 'tok-multi');
  assert.equal(r.status, 400);
  assert.equal(r.body.sharePrice, undefined);
});

test('someone in two SACCOs can read either, and nothing else', async () => {
  const a = await get(`${BASE}?group_code=PEWOSA-001`, 'tok-multi');
  const b = await get(`${BASE}?group_code=MAL-999`, 'tok-multi');
  const c = await get(`${BASE}?group_code=NEW-777`, 'tok-multi');

  assert.equal(a.status, 200);
  assert.equal(a.body.sharePrice, 30000);
  assert.equal(b.status, 200);
  assert.equal(b.body.sharePrice, 99000);
  assert.equal(c.status, 403);
});
