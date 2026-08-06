import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoute } from '../helpers/routeModule.mjs';
import { stubClientFactory, fakeRequest } from '../helpers/supabaseStub.mjs';

/**
 * One property, asserted across every API route in the app: an anonymous caller gets
 * refused.
 *
 * This exists because the page-level guards are client-side only. ProtectedRoute is a
 * "use client" component, so everything it enforces -- the login redirect, the non-admin
 * bounce off /admin, the billing lockout -- is advisory. Anyone can skip it by calling
 * these routes directly with curl, and nothing in the browser is in a position to stop
 * them. What actually stands between an anonymous request and this SACCO's money is the
 * check at the top of each handler, plus RLS behind it.
 *
 * So this suite is the load-bearing one. If it passes, client-only page guards cost a
 * bypasser an empty shell and no data. If any route here fails, that route is the hole,
 * and no amount of guarding in React closes it.
 *
 * The route list is read off disk rather than written out by hand. A new route file that
 * nobody classified fails this suite by existing, which is the point: the failure mode
 * being defended against is somebody adding an endpoint and no one noticing it never
 * learned to say no.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_ROOT = path.join(REPO_ROOT, 'src/app/api');

/**
 * Routes that answer an anonymous caller on purpose. Each needs a reason, because adding
 * to this set is how a route stops being covered by the assertion below.
 */
const PUBLIC_ROUTES = new Map([
  [
    'subscription-plans',
    'A price list. The payments screen renders it before anything about the caller is '
    + 'known, and it discloses nothing that is not already on the marketing page.'
  ],
  [
    'register-sacco',
    'Sign-up. There is no session yet by definition -- this is the route that creates one. '
    + 'It is rate limited for that reason: it is unauthenticated and it creates auth users '
    + 'with the service role.'
  ],
  [
    'client-errors',
    'Error intake. A failure on the login page is exactly the kind worth hearing about, so '
    + 'requiring a session would filter out the reports that matter most. It reads nothing, '
    + 'answers 204 regardless, truncates and scrubs everything it records, and is rate '
    + 'limited because it is a public write.'
  ]
]);

/** Every HTTP verb a route handler in this app exports. */
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

/** Walks src/app/api and returns each route file, repo-relative, with its URL path. */
function discoverRoutes(dir = API_ROOT) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...discoverRoutes(full));
    } else if (entry.name === 'route.js' || entry.name === 'route.ts') {
      const relPath = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      const urlPath = path.relative(API_ROOT, path.dirname(full)).split(path.sep).join('/');
      found.push({ relPath, urlPath });
    }
  }
  return found;
}

const ROUTES = discoverRoutes();

describe('every API route refuses an anonymous caller', () => {
  test('the app still has the routes this suite thinks it does', () => {
    assert.ok(
      ROUTES.length >= 20,
      `Found only ${ROUTES.length} route files under src/app/api. If routes moved, this `
      + 'suite is no longer covering them.'
    );
  });

  for (const { relPath, urlPath } of ROUTES) {
    const isPublic = PUBLIC_ROUTES.has(urlPath);

    describe(`/api/${urlPath}`, () => {
      let mod;

      before(async () => {
        // An empty fixture. Nothing here should be reachable without a token, so any route
        // that reads a row at all has already failed the assertion by the time it matters.
        const createClient = stubClientFactory({ __tokens: {} });
        mod = await loadRoute(relPath, { createClient });
      });

      test('exports at least one handler', () => {
        const exported = METHODS.filter((m) => typeof mod[m] === 'function');
        assert.ok(exported.length > 0, `${relPath} exports no HTTP handler.`);
      });

      if (isPublic) {
        test(`is deliberately public -- ${PUBLIC_ROUTES.get(urlPath)}`, () => {
          assert.ok(PUBLIC_ROUTES.get(urlPath).length > 40,
            'A public route needs a stated reason, not just an entry.');
        });
        return;
      }

      for (const method of METHODS) {
        test(`${method} without a token is refused`, async (t) => {
          if (typeof mod[method] !== 'function') return t.skip(`no ${method} handler`);

          // A body is supplied so that a handler which parses input before authenticating
          // still reaches its auth check; without one it would reject on the parse and the
          // assertion below would pass for the wrong reason.
          const req = fakeRequest(`https://app.test/api/${urlPath}`, null, {});
          const res = await mod[method](req);

          assert.ok(res, `${method} returned nothing at all.`);
          assert.notEqual(res.status, 200,
            `${method} /api/${urlPath} answered an anonymous caller with 200. Page-level `
            + 'guards are client-side, so this route is reachable with curl.');
          assert.ok(
            res.status === 401 || res.status === 403,
            `${method} /api/${urlPath} refused an anonymous caller with ${res.status}. `
            + 'Expected 401 or 403 so the client can tell "sign in again" from a real fault.'
          );
        });
      }
    });
  }
});
