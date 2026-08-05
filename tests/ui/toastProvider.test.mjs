import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * That the toast provider is actually mounted.
 *
 * ToastProvider was written, styled, exported and imported by three components -- and
 * mounted nowhere. useToast() therefore always fell through to its missing-provider
 * fallback, which routed four of its five methods to console.log, so every toast the app
 * raised went to a console nobody had open while the screen said nothing. Confirmations
 * and failures alike: "Transaction approved successfully", "Failed to save targets".
 *
 * Nothing failed. No test broke, the build passed, and the only symptom was a UI that
 * quietly never spoke. These are the assertions that would have caught it.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Source with its comments removed.
 *
 * Assertions about what the code does have to read the code. The comment explaining this
 * bug names the call it warns against, and matching that prose would fail the test for
 * documenting the fix.
 *
 * Line comments are only stripped where `//` opens the line, so a `https://` inside a
 * string survives.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ToastProvider is mounted in the app tree', () => {
  test('the root layout imports it', () => {
    assert.match(
      read('src/app/layout.tsx'),
      /import\s*\{[^}]*\bToastProvider\b[^}]*\}\s*from\s*['"][^'"]*ToastContext['"]/,
      'src/app/layout.tsx must import ToastProvider'
    );
  });

  test('the root layout renders it', () => {
    assert.match(
      read('src/app/layout.tsx'),
      /<ToastProvider>/,
      'Importing ToastProvider is not enough -- it has to be rendered'
    );
  });

  test('it wraps the children, not merely sits beside them', () => {
    // The failure this catches: <ToastProvider /> rendered as a sibling of {children}, which
    // mounts the container but puts no provider above any screen, so useToast() still finds
    // no context and every toast is still lost.
    const layout = read('src/app/layout.tsx');
    const open = layout.indexOf('<ToastProvider>');
    const close = layout.indexOf('</ToastProvider>');
    const children = layout.indexOf('{children}');

    assert.ok(open !== -1 && close !== -1, 'ToastProvider must be an element with children');
    assert.ok(
      open < children && children < close,
      '{children} must render inside <ToastProvider>...</ToastProvider>'
    );
  });
});

describe('a missing provider cannot fail silently again', () => {
  test('no toast method routes a user-facing message to console.log', () => {
    // console.log was the whole problem: invisible in a browser console nobody opens, and
    // indistinguishable from ordinary noise when they do.
    assert.doesNotMatch(
      stripComments(read('src/context/ToastContext.jsx')),
      /console\.log/,
      'A message meant for the user must never be dropped into a console.log'
    );
  });

  test('development throws rather than swallowing the message', () => {
    const source = read('src/context/ToastContext.jsx');
    assert.match(source, /NODE_ENV\s*!==\s*['"]production['"]/, 'Fallback must be env-aware');
    assert.match(source, /throw new Error/, 'A missing provider must be loud in development');
  });

  test('production still degrades instead of white-screening', () => {
    // There is no error boundary in the app router yet, so a throw in production would
    // replace a missing toast with a blank page -- worse than the bug being fixed.
    const source = read('src/context/ToastContext.jsx');
    assert.match(
      source,
      /return\s+FALLBACK_TOAST/,
      'Production must return a fallback rather than throw'
    );
  });
});

describe('every consumer of useToast is inside the provider', () => {
  test('all callers live under src/, which the root layout wraps entirely', () => {
    // ToastProvider wraps {children} in the root layout, so every route is beneath it. This
    // asserts the premise that makes that sufficient: nothing calls useToast from outside
    // the rendered app -- a script, or an API route, where no React tree exists at all.
    const callers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(jsx?|tsx?)$/.test(entry.name) && read(rel).includes('useToast(')) {
          callers.push(rel);
        }
      }
    };
    walk('src');

    const outsideTree = callers.filter((f) => f.startsWith('src/app/api/'));
    assert.deepEqual(outsideTree, [], 'An API route has no React tree and cannot raise a toast');

    // Guards against the file being renamed or moved without this test being updated.
    assert.ok(
      callers.includes('src/context/ToastContext.jsx'),
      'Expected to find the hook definition itself'
    );
    assert.ok(callers.length > 1, 'Expected at least one component to consume useToast');
  });
});
