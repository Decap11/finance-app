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
import { fileURLToPath } from 'node:url';

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
 * @param {string} relPath        Route file, relative to the repo root.
 * @param {object} deps           { createClient, getActiveWeek } -- stubs to inject.
 * @returns the route's module namespace.
 */
export async function loadRoute(relPath, { createClient, getActiveWeek = () => null } = {}) {
  setStubEnv();

  globalThis.__stubCreateClient = createClient;
  globalThis.__stubGetActiveWeek = getActiveWeek;

  const source = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');

  const rewritten = source
    .replace(
      "import { createClient } from '@supabase/supabase-js';",
      'const createClient = (...a) => globalThis.__stubCreateClient(...a);'
    )
    .replace(
      /import \{ getActiveWeek, WEEKS_PER_CYCLE \} from '[^']+';/,
      'const getActiveWeek = (...a) => globalThis.__stubGetActiveWeek(...a);\n'
      + 'const WEEKS_PER_CYCLE = 52;'
    );

  if (rewritten === source) {
    throw new Error(`${relPath}: no import was rewritten -- the stub is not wired in. `
      + 'Check whether the route\'s import lines have changed.');
  }

  return import('data:text/javascript,' + encodeURIComponent(rewritten));
}
