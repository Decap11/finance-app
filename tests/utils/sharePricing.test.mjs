import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SHARE_PRICE,
  SHARE_QTY_MIN,
  SHARE_QTY_MAX,
  wantsShares,
  parseShareQuantity,
  resolveShareUnitPrice,
  shareContributionAmount,
  sharePriceDisagreement,
  describeShareRequest,
  parseShareDescription,
  shareCountOf,
  shareUnitPriceOf,
  formatShs
} from '../../src/utils/sharePricing.js';

describe('wantsShares', () => {
  test('blank and zero mean "not buying shares this week"', () => {
    for (const raw of [undefined, null, '', '   ', 0, '0', '0.0']) {
      assert.equal(wantsShares(raw), false, `${JSON.stringify(raw)} should not be a shares request`);
    }
  });

  test('anything else is an attempt to buy shares, including the invalid ones', () => {
    // The point of routing these through parseShareQuantity rather than dropping them: the
    // old route did `Number(shares) || 0` and then `if (numShares > 0)`, so -3 and 2.5 were
    // handled by silently filing no shares transaction at all.
    for (const raw of ['1', 3, '10', -3, 2.5, '99', 'abc']) {
      assert.equal(wantsShares(raw), true, `${JSON.stringify(raw)} should reach validation`);
    }
  });
});

describe('parseShareQuantity', () => {
  test('accepts whole numbers within the allowed range', () => {
    for (let qty = SHARE_QTY_MIN; qty <= SHARE_QTY_MAX; qty++) {
      assert.deepEqual(parseShareQuantity(qty), { ok: true, quantity: qty });
      assert.deepEqual(parseShareQuantity(String(qty)), { ok: true, quantity: qty });
    }
  });

  test('rejects a fraction, which is what breaks the multiple-of-price rule', () => {
    const result = parseShareQuantity(2.5);
    assert.equal(result.ok, false);
    assert.match(result.error, /whole/i);
  });

  test('rejects outside 1 to 10, in both directions', () => {
    assert.equal(parseShareQuantity(0).ok, false);
    assert.equal(parseShareQuantity(-3).ok, false);
    assert.equal(parseShareQuantity(SHARE_QTY_MAX + 1).ok, false);
    assert.match(parseShareQuantity(11).error, /between 1 and 10/i);
  });

  test('rejects what is not a number at all', () => {
    assert.equal(parseShareQuantity('abc').ok, false);
    assert.equal(parseShareQuantity(Infinity).ok, false);
    assert.equal(parseShareQuantity(NaN).ok, false);
  });
});

describe('resolveShareUnitPrice', () => {
  test('takes the price when the settings describe a real group', () => {
    assert.deepEqual(
      resolveShareUnitPrice({ sharePrice: 5000, groupCode: 'BYS-8240' }),
      { ok: true, unitPrice: 5000 }
    );
  });

  test('refuses rather than guessing when the settings could not be read', () => {
    // This is the fault the whole module exists to close: the route opened with
    // `let sharePrice = 25000` and improved on it inside a try that swallowed its failure,
    // so a broken settings read charged every member 25,000 a share and told nobody.
    const result = resolveShareUnitPrice(null);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.error, /25,?000/);
  });

  test('refuses the app defaults, which describe no group', () => {
    const result = resolveShareUnitPrice({ sharePrice: DEFAULT_SHARE_PRICE, isDefault: true });
    assert.equal(result.ok, false);
    assert.match(result.error, /no share price configured/i);
  });

  test('refuses a price that is zero, negative or not a number', () => {
    for (const sharePrice of [0, -100, null, undefined, 'free']) {
      assert.equal(resolveShareUnitPrice({ sharePrice }).ok, false, `price ${sharePrice}`);
    }
  });
});

describe('sharePriceDisagreement', () => {
  test('agreement is silence', () => {
    assert.equal(sharePriceDisagreement(5000, 5000), null);
    assert.equal(sharePriceDisagreement('5000', 5000), null);
  });

  test('names both figures when the admin moved the price mid-form', () => {
    const message = sharePriceDisagreement(25000, 5000);
    assert.ok(message);
    assert.match(message, /5,000/);
    assert.match(message, /25,000/);
    assert.match(message, /Nothing was recorded/i);
  });

  test('a screen that could not confirm a price is a disagreement', () => {
    // Covers the stale localStorage cache and the pre-load submit: both arrive as a price
    // the client cannot vouch for, and neither may be charged.
    for (const shown of [undefined, null, 0, -1, 'unknown']) {
      assert.ok(sharePriceDisagreement(shown, 5000), `shown: ${shown}`);
    }
  });
});

describe('shareContributionAmount', () => {
  test('is the only multiplication, and it is exact', () => {
    assert.equal(shareContributionAmount(3, 25000), 75000);
    assert.equal(shareContributionAmount(1, 5000), 5000);
    assert.equal(shareContributionAmount(10, 1), 10);
  });

  test('every allowed quantity produces a multiple of the price', () => {
    for (const price of [1, 500, 5000, 25000, 33333]) {
      for (let qty = SHARE_QTY_MIN; qty <= SHARE_QTY_MAX; qty++) {
        assert.equal(shareContributionAmount(qty, price) % price, 0);
      }
    }
  });
});

describe('describeShareRequest / parseShareDescription', () => {
  test('what is written can be read back', () => {
    const description = describeShareRequest(3, 25000, 7);
    assert.equal(description, 'Contribution request: 3 share(s) @ Shs 25,000 | Week 7');
    assert.deepEqual(parseShareDescription(description), { quantity: 3, unitPrice: 25000 });
  });

  test('the format is pinned to en-US, whatever the server locale', () => {
    // Stored text parsed by a regex: a description written as "25.000" under a European
    // locale would read back as twenty-five, which is the same class of fault as the one
    // this module closes.
    assert.equal(formatShs(25000), '25,000');
    assert.match(describeShareRequest(1, 1500, 2), /Shs 1,500/);
  });

  test('reads the descriptions already in the database', () => {
    assert.deepEqual(
      parseShareDescription('Contribution request: 2 share(s) @ Shs 5,000 | Week 12'),
      { quantity: 2, unitPrice: 5000 }
    );
  });

  test('returns null rather than a guess for anything else', () => {
    assert.equal(parseShareDescription(''), null);
    assert.equal(parseShareDescription(null), null);
    assert.equal(parseShareDescription('Contribution request: Social Fund | Week 3'), null);
    assert.equal(parseShareDescription('Shares backfilled from the paper book'), null);
  });
});

describe('shareCountOf', () => {
  test('prefers the stored count over every derivation', () => {
    const tx = {
      share_count: 3,
      unit_price: 25000,
      amount: 75000,
      description: 'Contribution request: 3 share(s) @ Shs 25,000 | Week 7'
    };
    // The count must not move when the SACCO's current price does -- that retroactive
    // rewrite is the whole reason the column exists.
    assert.equal(shareCountOf(tx, 5000), 3);
    assert.equal(shareCountOf(tx, 25000), 3);
    assert.equal(shareCountOf(tx, 1), 3);
  });

  test('falls back to the description for rows written before 0033', () => {
    const legacy = {
      amount: 10000,
      description: 'Contribution request: 2 share(s) @ Shs 5,000 | Week 4'
    };
    assert.equal(shareCountOf(legacy, 25000), 2, 'the row says 2 at 5,000; today\'s price is irrelevant');
  });

  test('divides only as a last resort, for rows that state neither', () => {
    const lump = { amount: 75000, description: 'Backfilled shares' };
    assert.equal(shareCountOf(lump, 25000), 3);
    assert.equal(shareCountOf(lump, DEFAULT_SHARE_PRICE), 3);
  });

  test('an unusable fallback price yields 0, not Infinity', () => {
    assert.equal(shareCountOf({ amount: 75000 }, 0), 3, 'zero falls through to the default price');
    assert.equal(shareCountOf(null, 25000), 0);
  });
});

describe('shareUnitPriceOf', () => {
  test('reports the price charged, not the price today', () => {
    assert.equal(shareUnitPriceOf({ unit_price: 5000, amount: 10000, share_count: 2 }), 5000);
    assert.equal(
      shareUnitPriceOf({ amount: 10000, description: 'Contribution request: 2 share(s) @ Shs 5,000 | Week 4' }),
      5000
    );
  });

  test('null when the row never said, which is not the same as "the current price"', () => {
    assert.equal(shareUnitPriceOf({ amount: 75000, description: 'Backfilled shares' }), null);
    assert.equal(shareUnitPriceOf(null), null);
  });
});
