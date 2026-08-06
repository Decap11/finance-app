/**
 * That the App Router has error boundaries at all, and that they use this version's API.
 *
 * There were none. No error.tsx, no global-error.tsx, no not-found.tsx anywhere in the tree --
 * so an uncaught render error in any component gave a member a blank screen with their
 * savings behind it, and a mistyped URL gave them Next's stock 404.
 *
 * The prop assertions are not pedantry. This version of Next names the recovery callback
 * `retry`; earlier versions named it `reset`, and that is what most examples still show.
 * Destructuring `reset` compiles, type-checks and renders -- the button is simply dead,
 * which is only discoverable by triggering a real error and clicking it.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(REPO_ROOT, rel));

describe('the boundaries exist', () => {
  for (const [file, why] of [
    ['src/app/error.tsx', 'catches render errors below the root layout'],
    ['src/app/global-error.tsx', 'catches errors thrown by the root layout itself'],
    ['src/app/not-found.tsx', 'a URL matching no route']
  ]) {
    test(`${file} -- ${why}`, () => {
      assert.ok(exists(file), `${file} is missing`);
    });
  }
});

describe('the boundaries use this version of the Next API', () => {
  for (const file of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
    test(`${file} is a Client Component`, () => {
      // Next refuses to build an error boundary that is not one.
      assert.match(read(file).slice(0, 200), /^["']use client["']/, `${file} needs "use client"`);
    });

    test(`${file} takes retry, not the older reset`, () => {
      const source = read(file);
      assert.match(source, /\bretry\b/, `${file} must accept the retry prop`);
      assert.match(source, /retry\(\)/, `${file} must actually call retry()`);
      assert.doesNotMatch(
        source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
        /\breset\b/,
        `${file} destructures reset -- this version passes retry, so the button would be dead`
      );
    });
  }

  test('global-error supplies its own html and body', () => {
    // It replaces the root layout when it renders, so nothing else provides them.
    const source = read('src/app/global-error.tsx');
    assert.match(source, /<html/, 'global-error must render <html>');
    assert.match(source, /<body/, 'global-error must render <body>');
  });

  test('global-error does not export metadata', () => {
    // Not supported from a Client Component; the tab title comes from React's <title>.
    const source = read('src/app/global-error.tsx');
    assert.doesNotMatch(source, /export const metadata/, 'unsupported in a Client Component');
    assert.match(source, /<title>/, 'set the tab title with <title> instead');
  });
});

describe('what a member is told', () => {
  test('no boundary renders the raw error message', () => {
    // Server errors reach the browser as a generic message plus a digest precisely so
    // internals do not leak. Rendering error.message undoes that, and tells a member nothing
    // beyond the fact that their SACCO's software is broken.
    for (const file of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
      assert.doesNotMatch(read(file), /\{\s*error\.message\s*\}/, `${file} renders error.message`);
      assert.doesNotMatch(read(file), /\{\s*error\.stack\s*\}/, `${file} renders a stack trace`);
    }
  });

  test('both error boundaries surface the digest so a report can be matched to a log', () => {
    for (const file of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
      assert.match(read(file), /error\.digest/, `${file} should show the digest`);
    }
  });

  test('every boundary says the member records are intact', () => {
    // The one thing somebody looking at a broken savings screen needs to know.
    for (const file of ['src/app/error.tsx', 'src/app/global-error.tsx', 'src/app/not-found.tsx']) {
      assert.match(
        read(file),
        /unaffected|untouched|not recorded/,
        `${file} must state that the member's records are unharmed`
      );
    }
  });

  test('the shared notice carries no stylesheet import', () => {
    // global-error replaces the root layout and receives none of the app's global styles, so
    // a notice built on layout.css would render as unstyled text in exactly that case.
    assert.doesNotMatch(
      read('src/Components/FailureNotice.tsx'),
      /^import\s+["'].*\.css["']/m,
      'FailureNotice must not depend on a stylesheet'
    );
  });
});
