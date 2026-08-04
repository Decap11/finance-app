/**
 * resolveAdministeredSacco -- which SACCO a settings write is allowed to land on.
 *
 * The group code used to be taken straight from the POST body and checked only against "is
 * this caller an admin of *something*", then written with the service-role client, which
 * bypasses RLS. Any SACCO admin could name another SACCO's group code and rewrite its share
 * price, fund amounts, fine and loan fees and lock state. Group codes are ACRONYM-NUMBER, so
 * the target did not have to be known in advance.
 *
 * Three ways to administer a SACCO, mirroring the authorization inside
 * approve_member_transaction (migration 0024) plus the gap ProtectedRoute self-heals:
 *
 *   1. saccos.admin_profile_id           -- the founder
 *   2. sacco_memberships.role = 'admin'  -- promoted by make_member_admin
 *   3. profiles.role = 'admin' for their own group_id, while no other account has claimed it
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRoute } from '../helpers/routeModule.mjs';
import { stubClientFactory } from '../helpers/supabaseStub.mjs';

const ALICE = 'alice-uuid';
const MALLORY = 'mallory-uuid';

const baseDb = {
  profiles: [
    { id: ALICE, role: 'admin', group_id: 'PEWOSA-001' },
    { id: MALLORY, role: 'admin', group_id: 'MAL-999' },
    { id: 'bob-uuid', role: 'member', group_id: 'PEWOSA-001' },
    { id: 'olivia-uuid', role: 'loan_officer', group_id: 'PEWOSA-001' }
  ],
  saccos: [
    { id: 'sacco-a', group_code: 'PEWOSA-001', created_at: '2026-01-07T00:00:00Z', admin_profile_id: ALICE },
    { id: 'sacco-b', group_code: 'MAL-999', created_at: '2026-02-04T00:00:00Z', admin_profile_id: MALLORY }
  ],
  sacco_memberships: [
    { profile_id: ALICE, sacco_id: 'sacco-a', role: 'admin' },
    { profile_id: MALLORY, sacco_id: 'sacco-b', role: 'admin' },
    { profile_id: 'olivia-uuid', sacco_id: 'sacco-a', role: 'loan_officer' }
  ]
};

const { resolveAdministeredSacco } = await loadRoute(
  'src/app/api/sacco-settings/route.js', { createClient: stubClientFactory(baseDb) }
);

/** Runs the resolver against a fixture, as a given user. */
const resolve = (db, userId, requested) =>
  resolveAdministeredSacco(
    stubClientFactory(db)('url', 'key'),
    { id: userId, user_metadata: {} },
    requested
  );

// ------------------------------------------------------------ the attack

test('an admin of one SACCO cannot target another', async () => {
  const r = await resolve(baseDb, MALLORY, 'PEWOSA-001');
  assert.equal(r.status, 403);
});

test('lowercasing the target does not evade the check', async () => {
  const r = await resolve(baseDb, MALLORY, 'pewosa-001');
  assert.equal(r.status, 403);
});

test('an ilike wildcard does not evade the check', async () => {
  // The candidate set is compared by exact normalised string, so a pattern matches nothing.
  const r = await resolve(baseDb, MALLORY, '%');
  assert.equal(r.status, 403);
});

// ------------------------------------------------------------ legitimate writers

test('an admin edits their own SACCO', async () => {
  const r = await resolve(baseDb, ALICE, 'PEWOSA-001');
  assert.ok(!r.error);
  assert.equal(r.groupCode, 'PEWOSA-001');
  assert.equal(r.sacco.id, 'sacco-a');
});

test('naming no code resolves to the caller\'s own SACCO', async () => {
  const alice = await resolve(baseDb, ALICE, undefined);
  assert.equal(alice.groupCode, 'PEWOSA-001');

  const mallory = await resolve(baseDb, MALLORY, undefined);
  assert.equal(mallory.groupCode, 'MAL-999');
});

test('an admin promoted by membership may write, even without founding the SACCO', async () => {
  const db = {
    ...baseDb,
    saccos: [{ id: 'sacco-a', group_code: 'PEWOSA-001', created_at: null, admin_profile_id: 'someone-else' }],
    sacco_memberships: [{ profile_id: ALICE, sacco_id: 'sacco-a', role: 'admin' }]
  };
  const r = await resolve(db, ALICE, 'PEWOSA-001');
  assert.ok(!r.error);
  assert.equal(r.sacco.id, 'sacco-a');
});

// ------------------------------------------------------------ who is refused

test('a plain member is refused', async () => {
  const r = await resolve(baseDb, 'bob-uuid', 'PEWOSA-001');
  assert.equal(r.status, 403);
});

test('a loan officer is refused -- approving a transaction is not setting the share price', async () => {
  const r = await resolve(baseDb, 'olivia-uuid', 'PEWOSA-001');
  assert.equal(r.status, 403);
});

test('an unknown caller is refused', async () => {
  const r = await resolve(baseDb, 'nobody', 'PEWOSA-001');
  assert.equal(r.status, 403);
});

// ------------------------------------------------------------ the SACCO row that does not exist yet

test('an admin whose saccos row has not materialised may still write, with a null id', async () => {
  // ProtectedRoute self-heals this state; the settings row carries the values until it does.
  const db = { ...baseDb, saccos: [baseDb.saccos[1]] };
  const r = await resolve(db, ALICE, 'PEWOSA-001');
  assert.ok(!r.error);
  assert.equal(r.sacco.id, null);
});

test('that path cannot be used to claim a code somebody else owns', async () => {
  const db = { ...baseDb, saccos: [baseDb.saccos[1]] };
  const r = await resolve(db, ALICE, 'MAL-999');
  assert.equal(r.status, 403);
});

test('an unclaimed row is adopted by the admin of its group', async () => {
  const db = {
    ...baseDb,
    saccos: [{ id: 'sacco-c', group_code: 'PEWOSA-001', created_at: null, admin_profile_id: null }]
  };
  const r = await resolve(db, ALICE, 'PEWOSA-001');
  assert.ok(!r.error);
  assert.equal(r.sacco.id, 'sacco-c');
});
