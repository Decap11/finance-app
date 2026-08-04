import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/**
 * The service worker's routing rules, tested against the one property that matters:
 * a request carrying money must never be answerable from cache.
 *
 * public/sw.js is written for the ServiceWorkerGlobalScope, so it cannot be imported. It is
 * evaluated here in a vm context with the handful of globals it touches stubbed out, which
 * lets the real shipped file be tested rather than a copy of its logic -- a copy would go on
 * passing after somebody edited the original.
 */

const ORIGIN = 'https://pewosa.example';
let sw;

before(async () => {
  const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');

  const listeners = {};
  const context = {
    self: {
      location: new URL(ORIGIN),
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
    fetch: async () => ({ ok: true }),
    Request,
    Response,
    URL,
    console
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  sw = context;
});

/** A request the worker will see, with only the fields its predicates read. */
function req(url, { method = 'GET', destination = '', mode = 'no-cors', range = false } = {}) {
  return {
    method,
    destination,
    mode,
    headers: { has: (h) => range && h.toLowerCase() === 'range' },
    url
  };
}

describe('the ledger is never cacheable', () => {
  test('every /api/* route is off limits, whatever it is', () => {
    const paths = [
      '/api/user-transactions',
      '/api/user-balances',
      '/api/sacco-balances',
      '/api/sacco-settings',
      '/api/loans',
      '/api/dues',
      '/api/admin/fines',
      '/api/platform'
    ];

    for (const path of paths) {
      const url = new URL(path, ORIGIN);
      assert.equal(
        sw.isOffLimits(req(url.href), url),
        true,
        `${path} must never be served from cache -- a stale balance gets acted on`
      );
    }
  });

  test('Supabase is off limits: it carries both the data and the auth tokens', () => {
    const urls = [
      'https://abcdefgh.supabase.co/rest/v1/transactions?select=*',
      'https://abcdefgh.supabase.co/auth/v1/token?grant_type=refresh_token',
      'https://abcdefgh.supabase.co/realtime/v1/websocket'
    ];

    for (const href of urls) {
      const url = new URL(href);
      assert.equal(sw.isOffLimits(req(href), url), true, `${href} must not be intercepted`);
    }
  });

  test('a write is never cached, and never replayed from here', () => {
    const url = new URL('/', ORIGIN);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(
        sw.isOffLimits(req(url.href, { method }), url),
        true,
        `${method} must be off limits`
      );
    }
  });

  test('an unknown third-party origin is left alone', () => {
    const url = new URL('https://tracker.example/collect');
    assert.equal(sw.isOffLimits(req(url.href), url), true);
  });

  test('range requests are left alone -- a naive cache.put answers them wrongly', () => {
    const url = new URL('/video.mp4', ORIGIN);
    assert.equal(sw.isOffLimits(req(url.href, { range: true }), url), true);
  });
});

describe('the shell is cacheable', () => {
  test('same-origin GETs for the app itself are not off limits', () => {
    for (const path of ['/', '/dashboard', '/offline', '/_next/static/chunks/main.js']) {
      const url = new URL(path, ORIGIN);
      assert.equal(
        sw.isOffLimits(req(url.href), url),
        false,
        `${path} should be eligible for the shell cache`
      );
    }
  });

  test('the font and icon CDNs the layout loads are allowed', () => {
    for (const href of [
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://fonts.gstatic.com/s/inter/v1/font.woff2',
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
    ]) {
      const url = new URL(href);
      assert.equal(sw.isOffLimits(req(href), url), false, `${href} should be cacheable`);
    }
  });

  test('only content-hashed build output is treated as immutable', () => {
    // Cache-first is safe for /_next/static because the filename changes when the bytes do.
    assert.equal(sw.isHashedAsset(new URL('/_next/static/chunks/abc123.js', ORIGIN)), true);

    // Everything else must not be, or a deploy would never reach an installed member.
    assert.equal(sw.isHashedAsset(new URL('/dashboard', ORIGIN)), false);
    assert.equal(sw.isHashedAsset(new URL('/api/user-balances', ORIGIN)), false);
    assert.equal(sw.isHashedAsset(new URL('https://fonts.gstatic.com/x.woff2')), false);
  });

  test('static asset kinds are recognised by destination', () => {
    for (const destination of ['style', 'script', 'font', 'image']) {
      const url = new URL(`/images/logo.png`, ORIGIN);
      assert.equal(sw.isAsset(req(url.href, { destination }), url), true, destination);
    }

    const doc = new URL('/dashboard', ORIGIN);
    assert.equal(sw.isAsset(req(doc.href, { destination: 'document' }), doc), false);
  });
});

describe('the worker declares what it needs', () => {
  test('every cache it opens survives its own cleanup', async () => {
    // activate() deletes every pewosa-* cache that is not in the keep set. A cache constant
    // added without being added there would be created on use and wiped on the next
    // activation -- which presents as caching that silently stops working after a deploy.
    const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');

    const declared = [...source.matchAll(/const (\w+_CACHE) = `pewosa-/g)].map((m) => m[1]);
    assert.ok(declared.length > 0, 'expected at least one pewosa-* cache constant');

    const keepSet = source.match(/const keep = new Set\(\[([^\]]*)\]\)/);
    assert.ok(keepSet, 'activate() must build a keep set');

    for (const name of declared) {
      assert.ok(
        keepSet[1].includes(name),
        `${name} is opened but missing from the keep set in activate(), so it is deleted on every activation`
      );
    }
  });

  test('the offline fallback is a real route in this app', async () => {
    const { access } = await import('node:fs/promises');
    // /offline is precached on install with cache.add, which REJECTS on a non-2xx response.
    // If the route were removed, install would fail and the worker would never activate --
    // taking the whole PWA down, not just the offline page.
    await access(new URL('../../src/app/offline/page.tsx', import.meta.url));
  });
});
