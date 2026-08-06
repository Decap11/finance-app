import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The developer portal at 440px and below.
 *
 * Two things make this breakpoint different from an ordinary "make it narrower" pass, and
 * both are silent failures rather than visible ones -- which is why they are asserted here
 * instead of left to a glance in devtools.
 *
 * The first is the root font size. responsive.css sets html { font-size: 48% } at 440px, so
 * 1rem is 7.68px and every rem-based size in developerPortal.css collapses with it:
 * .dev-state-origin lands at 7.3px, the table body at 10.4px, and .btn-dev-action at roughly
 * 21px tall. A rem value written inside this breakpoint therefore does not mean what it looks
 * like it means, so the fixes are in px -- the same reasoning the 480px block above it
 * already records. The assertions below check the sizes stayed in px.
 *
 * The second is that the restacked table depends on markup and CSS agreeing. Each <td> is
 * labelled by a data-label attribute that only becomes visible at this width, via
 * td::before { content: attr(data-label) }. A cell added later without one renders as a bare
 * value with no indication of which column it came from, and nothing about that fails a
 * build or looks wrong at desktop width. So the two files are checked against each other.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = fs.readFileSync(path.join(REPO_ROOT, 'src/styles/developerPortal.css'), 'utf8');
const PAGE = fs.readFileSync(path.join(REPO_ROOT, 'src/app/developer/page.jsx'), 'utf8');

/** The body of the @media (max-width: 440px) block, brace-matched. */
function mobileBlock() {
  const start = CSS.indexOf('@media (max-width: 440px)');
  assert.notEqual(start, -1, 'developerPortal.css has no 440px breakpoint.');

  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') {
      depth--;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error('Unbalanced braces in the 440px block.');
}

const MOBILE = mobileBlock();

describe('every table cell can name itself once the headings are gone', () => {
  // <td ...> openings, with whatever attributes follow.
  const cells = [...PAGE.matchAll(/<td\b([^>]*)>/g)].map((m) => m[1]);

  test('the page still has the cells this suite thinks it does', () => {
    assert.ok(cells.length >= 12, `Found only ${cells.length} <td> in the developer page.`);
  });

  test('each one carries a data-label, or is a colSpan empty-state row', () => {
    const unlabelled = cells.filter(
      (attrs) => !attrs.includes('data-label') && !attrs.includes('colSpan')
    );

    assert.deepEqual(
      unlabelled,
      [],
      'A <td> with no data-label renders below 440px as a value with no column name, '
      + 'because the thead is hidden and td::before supplies the label from that attribute.'
    );
  });

  test('the label is actually rendered from the attribute', () => {
    assert.match(MOBILE, /content:\s*attr\(data-label\)/,
      'The data-label attributes are set in the markup but nothing displays them.');
  });

  test('the heading cells opt out deliberately rather than by omission', () => {
    // data-label="" is the SACCO name -- it becomes the card's heading, so it must be an
    // explicit empty label with a rule to match, not a missing attribute.
    assert.ok(PAGE.includes('data-label=""'), 'No heading cell is marked.');
    assert.match(MOBILE, /td\[data-label=''\]::before\s*\{\s*display:\s*none/,
      'data-label="" would otherwise render an empty label box.');
  });

  test('the colSpan empty-state row is not given a label box either', () => {
    assert.match(MOBILE, /td\[colspan\]::before\s*\{\s*display:\s*none/,
      '"No Saccos registered..." spans the row and has no column to name.');
  });
});

describe('the table stops being a table', () => {
  test('rows and cells become blocks', () => {
    assert.match(MOBILE, /\.dev-table\s+td\s*\{[^}]*display:\s*flex/,
      'Cells must leave table layout, or the row still lays out in seven columns.');
  });

  test('the headings are hidden accessibly, not removed', () => {
    const thead = MOBILE.match(/\.dev-table\s+thead\s*\{([^}]*)\}/);
    assert.ok(thead, 'No rule hides the thead at this width.');
    assert.doesNotMatch(thead[1], /display:\s*none/,
      'display:none drops the headings from the accessibility tree as well as the screen. '
      + 'Clip them instead so a screen reader still announces the table structure.');
    assert.match(thead[1], /clip:|position:\s*absolute/);
  });

  test('nothing scrolls sideways once the rows are stacked', () => {
    assert.match(MOBILE, /\.dev-table-container\s*\{[^}]*overflow-x:\s*visible/,
      'The container keeps overflow-x:auto from the base rule, which leaves a horizontal '
      + 'scrollbar under content that no longer overflows.');
  });

  test('the columns hidden at 670px come back', () => {
    // 670px hides nth-child(4) and (5) -- the administrator and the plan -- because seven
    // columns will not fit. Stacked, there are no columns to fit, and those two are the
    // ones an operator opens the directory to read.
    assert.match(MOBILE, /nth-child\(4\)/);
    assert.match(MOBILE, /nth-child\(5\)/);
    const restore = MOBILE.match(/nth-child\(5\)\s*\{([^}]*)\}/);
    assert.match(restore[1], /display:\s*flex/,
      'Without this the 670px display:none still applies and the directory silently omits '
      + 'the administrator email on a phone.');
  });
});

describe('sizes survive the 48% root font size', () => {
  /** Declarations that would be misread if written in rem at this breakpoint. */
  const SIZE_PROPS = /(?:^|\n)\s*(font-size|min-height)\s*:\s*([^;]+);/g;

  test('font-size and min-height are in px, not rem', () => {
    const offenders = [];
    for (const [, prop, value] of MOBILE.matchAll(SIZE_PROPS)) {
      if (/\drem/.test(value)) offenders.push(`${prop}: ${value}`);
    }

    assert.deepEqual(
      offenders,
      [],
      'html is at 48% here, so 1rem is 7.68px. A rem font-size in this block renders at '
      + 'roughly half the size it reads as.'
    );
  });

  test('the action buttons get a real touch target', () => {
    const btn = MOBILE.match(/\.btn-dev-action\s*\{([^}]*)\}/);
    assert.ok(btn, '.btn-dev-action is not resized at this breakpoint.');

    const minHeight = btn[1].match(/min-height:\s*(\d+)px/);
    assert.ok(minHeight, '.btn-dev-action has no px min-height.');
    assert.ok(
      Number(minHeight[1]) >= 44,
      `.btn-dev-action is ${minHeight[1]}px tall. These buttons put a tenant on hold or `
      + 'delete it and all of its data permanently -- 44px is the minimum comfortable '
      + 'target, and the rem sizing leaves them at about 21px.'
    );
  });

  test('the buttons stack instead of crowding a row', () => {
    assert.match(MOBILE, /\.dev-actions\s*\{[^}]*flex-direction:\s*column/,
      'Two or three actions side by side at 440px are a mis-tap away from each other, and '
      + 'one of them is irreversible.');
  });

  test('the subscription select does not zoom the page on iOS', () => {
    const select = MOBILE.match(/\.sub-select\s*\{([^}]*)\}/);
    assert.ok(select, '.sub-select is not resized at this breakpoint.');
    const size = select[1].match(/font-size:\s*(\d+)px/);
    assert.ok(size && Number(size[1]) >= 16,
      'Safari zooms the viewport when a control under 16px takes focus, and this control '
      + "changes a tenant's billing status.");
  });

  test('no text is left below 10px', () => {
    const sizes = [...MOBILE.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 10, 'Suspiciously few px font sizes -- did the block shrink?');
    const tiny = sizes.filter((s) => s < 10);
    assert.deepEqual(tiny, [], `Text at ${tiny.join('px, ')}px is not readable on a phone.`);
  });
});
