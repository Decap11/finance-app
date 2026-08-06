/**
 * No API route may fall back from the service-role key to a public one.
 *
 * Two routes read `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY || ...`, so a
 * service key that was unset or misspelled in the deploy environment did not fail. The client
 * was still constructed, still authenticated, and still answered -- as an anonymous caller,
 * under RLS, seeing nothing.
 *
 * What that produced depended on the route, and neither outcome announced itself:
 *
 *   sacco-settings      matched no row, fell through to defaultSettings(), and returned a
 *                       25,000 share price to a group that charges 30,000. Every arrears
 *                       figure in the app is computed from those numbers.
 *   contribution-habits read no sacco_memberships rows, so its staff check answered "not
 *                       staff" for everybody and admins lost access to member habits.
 *
 * The scan below is over every route rather than those two, because the failure is a property
 * of the pattern and not of the files that happened to have it.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_ROOT = path.join(REPO_ROOT, 'src/app/api');

/** Every route.js under src/app/api, repo-relative. */
function routeFiles(dir = API_ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === 'route.js') out.push(path.relative(REPO_ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

const files = routeFiles();

/** Assignments of the form `const <name> = <expression>;`, comments removed. */
function assignmentFor(source, name) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const match = withoutComments.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

describe('the service-role key never degrades to a public key', () => {
  test('at least one route actually reads the service-role key', () => {
    // Guards the scan itself: if the routes were restructured so none of them matched, every
    // assertion below would pass by describing nothing.
    const users = files.filter((f) =>
      fs.readFileSync(path.join(REPO_ROOT, f), 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY')
    );
    assert.ok(users.length >= 5, `expected several service-role routes, found ${users.length}`);
  });

  for (const file of files) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    if (!source.includes('SUPABASE_SERVICE_ROLE_KEY')) continue;

    test(`${file} does not fall back to a public key`, () => {
      const expr = assignmentFor(source, '\\w*[Ss]erviceKey');
      assert.ok(expr, `${file}: could not find the service key assignment`);

      // An anon key reached through any spelling is the same mistake. '' is the correct
      // fallback: it is falsy, so the point-of-use check can see it and refuse.
      assert.doesNotMatch(
        expr,
        /ANON_KEY/,
        `${file}: service-role key falls back to an anon key -- ${expr}`
      );
      assert.doesNotMatch(
        expr,
        /PUBLISHABLE/i,
        `${file}: service-role key falls back to a publishable key -- ${expr}`
      );
    });

    // The assertion above reads the declaration only, and that is exactly how four routes
    // kept the defect after it was supposedly fixed: platform, admin/dividends,
    // loans/guarantors and user-vaults each declared `... || ''` correctly and then wrote
    // `createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey)` inside a
    // getSupabaseAdmin() helper. The declaration was clean, the client was still anonymous,
    // and the suite was green. Whatever the key is called, the downgrade must not reappear
    // anywhere in the file.
    test(`${file} does not degrade the key at the point of use`, () => {
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      assert.doesNotMatch(
        withoutComments,
        /\w*[Ss]erviceKey\s*\|\|/,
        `${file}: a service-role client falls back to another key at its call site. An `
        + 'anonymous client is refused by RLS rather than erroring, so the route answers '
        + 'with nothing and the screen reports empty instead of broken.'
      );
    });
  }
});

describe('a missing service-role key is refused rather than worked around', () => {
  test('getActiveSaccoSettings refuses to answer without one', () => {
    // Throwing rather than returning defaults is the whole point: a thrown error reaches a
    // 500 or a logged failure, while defaults are indistinguishable from a real answer and
    // become the share price the dues arithmetic runs on.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'src/app/api/sacco-settings/route.js'), 'utf8'
    );
    const fn = source.slice(source.indexOf('export async function getActiveSaccoSettings'));
    const guard = fn.slice(0, fn.indexOf('createClient('));

    assert.match(guard, /if\s*\(\s*!supabaseServiceKey\s*\)/, 'guard must precede the client');
    assert.match(guard, /throw new Error/, 'a missing key must throw, not fall through');
  });

  test('contribution-habits refuses the staff check rather than denying it', () => {
    // The distinction matters: with no key the server cannot tell whether the caller is
    // staff, and answering 403 would state as fact something it never established.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'src/app/api/contribution-habits/route.js'), 'utf8'
    );
    const guard = source.slice(
      source.indexOf('targetMemberId !== user.id'),
      source.indexOf('createClient(supabaseUrl, supabaseServiceKey)')
    );

    assert.match(guard, /if\s*\(\s*!supabaseServiceKey\s*\)/, 'guard must precede the client');
    assert.match(guard, /status:\s*500/, 'must be a server error, not a 403');
  });

  test('neither guard sits at module scope, which would fail the production build', () => {
    // CI builds with placeholder public values and no secrets -- deliberately, since a build
    // makes no requests. A throw at import time would fail the build rather than the
    // misconfigured deployment, so both checks belong at the point of use.
    for (const file of [
      'src/app/api/sacco-settings/route.js',
      'src/app/api/contribution-habits/route.js'
    ]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const beforeFirstExport = source.slice(0, source.indexOf('export '));
      assert.doesNotMatch(
        beforeFirstExport,
        /throw new Error/,
        `${file}: throws at module scope, which breaks \`next build\``
      );
    }
  });
});
