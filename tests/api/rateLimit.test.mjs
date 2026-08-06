import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientIp, checkRateLimit, tooManyRequests } from '../../src/utils/rateLimit.js';

/**
 * The rate limiter, and the two properties of it that are easy to get wrong silently.
 *
 * The first is which end of x-forwarded-for is the caller. Taking the last entry yields the
 * CDN's own address, which buckets every visitor in the world into one counter -- the limit
 * still "works" in a test with a single caller and locks the entire app out at peak.
 *
 * The second is what happens when the limiter itself is unavailable. Migration 0037 is
 * applied by hand like every other file in this project, so the deployed code will exist
 * before the function does. It has to admit the request in that window, and it has to be
 * possible to tell that apart from a request that was genuinely checked.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A Supabase-alike whose rpc() does whatever the test needs. */
function adminStub(rpc) {
  return { rpc: (fn, args) => Promise.resolve(rpc(fn, args)) };
}

function headers(map) {
  return { headers: { get: (k) => map[k.toLowerCase()] ?? null } };
}

describe('clientIp', () => {
  test('takes the first entry of x-forwarded-for, not the last', () => {
    // Left to right: the client, then each proxy that handled it. The last entry is the
    // edge, and bucketing on that is a global limit wearing a per-caller costume.
    assert.equal(
      clientIp(headers({ 'x-forwarded-for': '41.210.0.7, 76.76.21.21, 10.0.0.1' })),
      '41.210.0.7'
    );
  });

  test('trims whitespace around the entry', () => {
    assert.equal(clientIp(headers({ 'x-forwarded-for': '  41.210.0.7  , 10.0.0.1' })), '41.210.0.7');
  });

  test('falls back to x-real-ip', () => {
    assert.equal(clientIp(headers({ 'x-real-ip': '41.210.0.9' })), '41.210.0.9');
  });

  test('an unidentifiable caller gets a bucket rather than an exemption', () => {
    // Sharing one bucket is deliberate. Exempting them would exempt exactly the requests
    // most likely to be automated.
    assert.equal(clientIp(headers({})), 'unknown');
    assert.equal(clientIp(headers({ 'x-forwarded-for': '' })), 'unknown');
  });
});

describe('checkRateLimit', () => {
  test('passes the bucket, identifier and limits through to the function', async () => {
    let seen = null;
    const admin = adminStub((fn, args) => {
      seen = { fn, args };
      return { data: true, error: null };
    });

    await checkRateLimit(admin, {
      bucket: 'register-sacco',
      identifier: '41.210.0.7',
      limit: 5,
      windowSeconds: 3600
    });

    assert.equal(seen.fn, 'check_rate_limit');
    assert.deepEqual(seen.args, {
      p_bucket: 'register-sacco',
      p_identifier: '41.210.0.7',
      p_limit: 5,
      p_window_seconds: 3600
    });
  });

  test('true admits the request', async () => {
    const admin = adminStub(() => ({ data: true, error: null }));
    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });
    assert.deepEqual(result, { allowed: true, degraded: false });
  });

  test('false refuses it', async () => {
    const admin = adminStub(() => ({ data: false, error: null }));
    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });
    assert.equal(result.allowed, false);
  });

  test('a missing function admits the request and says so', async () => {
    // The state between deploying this code and pasting 0037 into the SQL editor.
    const admin = adminStub(() => ({
      data: null,
      error: { message: 'function public.check_rate_limit(...) does not exist', code: '42883' }
    }));

    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });

    assert.equal(result.allowed, true,
      'A signup page that refuses everyone because a migration has not run yet is worse '
      + 'than the unlimited signup page this replaces.');
    assert.equal(result.degraded, true,
      'The caller must be able to tell "within limit" from "never actually checked".');
  });

  test('a thrown error admits the request rather than propagating', async () => {
    const admin = { rpc: () => { throw new Error('ECONNREFUSED'); } };
    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });
    assert.deepEqual(result, { allowed: true, degraded: true });
  });

  test('a rejected promise admits the request', async () => {
    const admin = { rpc: () => Promise.reject(new Error('timeout')) };
    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });
    assert.equal(result.allowed, true);
  });

  test('a null answer is treated as not-checked, not as refused', async () => {
    const admin = adminStub(() => ({ data: null, error: null }));
    const result = await checkRateLimit(admin, { bucket: 'b', identifier: 'i', limit: 1, windowSeconds: 60 });
    assert.equal(result.allowed, true);
    assert.equal(result.degraded, true);
  });
});

describe('tooManyRequests', () => {
  test('answers 429 and says how long to wait', async () => {
    const res = tooManyRequests(3600);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '3600');

    const body = await res.json();
    assert.equal(body.retry_after_seconds, 3600);
    assert.match(body.error, /too many/i);
  });
});

describe('the limiter is actually wired into the endpoints that need it', () => {
  // Source-level, because the alternative is a suite that proves the helper works
  // perfectly while nothing calls it.
  for (const [file, bucket] of [
    ['src/app/api/register-sacco/route.js', 'register-sacco'],
    ['src/app/api/client-errors/route.js', 'client-errors']
  ]) {
    test(`${file} calls checkRateLimit`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.match(src, /checkRateLimit\(/, `${file} imports the limiter but never calls it.`);
      assert.ok(src.includes(`'${bucket}'`), `${file} does not name its own bucket.`);
      assert.match(src, /tooManyRequests\(/, `${file} never returns a 429.`);
    });
  }

  test('the migration that backs it is present and re-runnable', () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, 'supabase/migrations/0037_20260806_rate-limiting.sql'),
      'utf8'
    );
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.rate_limit_hits/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.check_rate_limit/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path/,
      'A SECURITY DEFINER function without a pinned search_path can be redirected to a '
      + 'table the caller controls.');
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.check_rate_limit/,
      'The function takes its own limit as an argument, so a caller able to invoke it '
      + 'directly could pass a limit high enough to exempt themselves.');
    assert.match(sql, /record_migration\(\s*\n?\s*'0037'/,
      'Every migration records itself in the 0032 ledger.');
  });
});
