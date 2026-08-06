/**
 * Loads an API route file with its Supabase client swapped for a test stub.
 *
 * The route modules import '@supabase/supabase-js' and sibling utils at the top level, so
 * they cannot simply be imported here -- a real client would try to reach the network, and
 * the module reads its credentials from the environment as it loads. The source text is
 * rewritten so both come from globals the test controls, then loaded as a data: URL module.
 *
 * The point of going to this trouble rather than copying the function under test is that
 * these suites then exercise the SHIPPED source. A copy drifts from the file it was copied
 * from, and drifts most in exactly the direction the tests were written to prevent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Placeholders. createClient is stubbed, so these are never used to reach anything -- but
 * they must be non-empty, because the routes treat a missing anon key as "authentication is
 * not configured" and refuse before doing anything else.
 */
function setStubEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
}

/**
 * Points a relative import at the real module on disk.
 *
 * These are deliberately NOT stubbed. The utils the routes reach for -- sharePricing,
 * duesEngine, tenantState, subscriptionPlans -- are pure, already carry their own suites,
 * and are exactly the arithmetic a route test wants to be exercising. Stubbing them would
 * leave the route agreeing with a fiction.
 *
 * A data: URL module has no base to resolve './foo' against, which is why these have to
 * become absolute file: URLs rather than being left alone.
 */
function resolveRelative(routeRelPath, specifier) {
  const routeDir = path.dirname(path.join(REPO_ROOT, routeRelPath));
  let target = path.resolve(routeDir, specifier);
  if (!path.extname(target)) target += '.js';
  return pathToFileURL(target).href;
}

/**
 * @param {string} relPath        Route file, relative to the repo root.
 * @param {object} deps           { createClient, getActiveWeek } -- stubs to inject.
 * @returns the route's module namespace.
 */
export async function loadRoute(relPath, { createClient, getActiveWeek = () => null } = {}) {
  setStubEnv();

  globalThis.__stubCreateClient = createClient;
  globalThis.__stubGetActiveWeek = getActiveWeek;

  const source = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  let rewrites = 0;
  const bump = (text) => { rewrites++; return text; };

  let out = source.replace(
    "import { createClient } from '@supabase/supabase-js';",
    () => bump('const createClient = (...a) => globalThis.__stubCreateClient(...a);')
  );

  // NextResponse.json is the only member any of these routes uses, and it is a thin wrapper
  // over Response.json. Shimmed rather than imported so a route test never pulls the Next
  // server runtime into a plain node:test process.
  out = out.replace(
    /import \{ NextResponse \} from 'next\/server';/,
    () => bump('const NextResponse = { json: (b, i) => Response.json(b, i) };')
  );

  // Kept ahead of the general relative rewrite below, and kept stubbable, because the
  // settings suites drive the route through specific weeks of the cycle by controlling what
  // this returns. Everything else gets the real module.
  out = out.replace(
    /import \{ getActiveWeek, WEEKS_PER_CYCLE \} from '[^']+';/,
    () => bump('const getActiveWeek = (...a) => globalThis.__stubGetActiveWeek(...a);\n'
      + 'const WEEKS_PER_CYCLE = 52;')
  );

  // Matches the specifier only, so a multi-line `import {\n a,\n b\n} from '...'` is
  // rewritten the same way a single-line one is, with its named-import list untouched.
  out = out.replace(
    /from\s+'(\.[^']+)'/g,
    (_m, spec) => bump(`from '${resolveRelative(relPath, spec)}'`)
  );

  if (rewrites === 0) {
    throw new Error(`${relPath}: no import was rewritten -- the stub is not wired in. `
      + 'Check whether the route\'s import lines have changed.');
  }

  return import('data:text/javascript,' + encodeURIComponent(out));
}
