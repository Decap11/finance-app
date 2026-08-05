import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  lendingNetOf,
  capitalOnHandOf,
  outOnLoanOf,
  canFundLoan,
  loanShortfall,
  formatSignedShs
} from '../../src/utils/saccoCapital.js';

/** A SACCO that has collected 1,000,000 and lent none of it. */
const untouched = {
  contributed: 1_000_000,
  disbursedTotal: 0,
  repaidTotal: 0
};

/** The same SACCO, having just approved a 400,000 loan. */
const lending = {
  contributed: 1_000_000,
  disbursedTotal: 400_000,
  repaidTotal: 0
};

/** Halfway through repaying it: 220,000 of the 440,000 due has come back. */
const partlyRepaid = {
  contributed: 1_000_000,
  disbursedTotal: 400_000,
  repaidTotal: 220_000
};

/** Fully repaid at 10% — 440,000 returned against 400,000 lent. */
const repaidWithInterest = {
  contributed: 1_000_000,
  disbursedTotal: 400_000,
  repaidTotal: 440_000
};

describe('capitalOnHandOf', () => {
  test('a SACCO that has lent nothing holds what it collected', () => {
    assert.equal(capitalOnHandOf(untouched), 1_000_000);
  });

  test('approving a loan takes it straight out of the pot', () => {
    // The whole point of migration 0034. Before it, this stayed at 1,000,000 and the
    // 400,000 walked out of the door without any figure in the app moving.
    assert.equal(capitalOnHandOf(lending), 600_000);
  });

  test('repayments put it back as they arrive, not when the loan closes', () => {
    assert.equal(capitalOnHandOf(partlyRepaid), 820_000);
  });

  test('a loan repaid with interest leaves the SACCO better off than before it lent', () => {
    // 1,000,000 - 400,000 + 440,000. The 40,000 of interest is income recognised at the
    // moment it is actually received, rather than the projected principal x rate x term
    // the admin dashboard used to compute for itself.
    assert.equal(capitalOnHandOf(repaidWithInterest), 1_040_000);
  });

  test('is not floored at zero -- a SACCO that over-lent must be able to say so', () => {
    const overdrawn = { contributed: 100_000, disbursedTotal: 250_000, repaidTotal: 0 };
    assert.equal(capitalOnHandOf(overdrawn), -150_000);
  });

  test('missing position is zero, not NaN', () => {
    // The RPC is absent on a database without 0034, and every caller has to survive that
    // without printing "Shs NaN" over a money figure.
    assert.equal(capitalOnHandOf(null), 0);
    assert.equal(capitalOnHandOf(undefined), 0);
    assert.equal(capitalOnHandOf({}), 0);
  });

  test('reads numeric strings, which is what PostgREST sends for NUMERIC', () => {
    const asStrings = { contributed: '1000000', disbursedTotal: '400000', repaidTotal: '0' };
    assert.equal(capitalOnHandOf(asStrings), 600_000);
  });
});

describe('outOnLoanOf', () => {
  test('is what has gone out and not yet come back', () => {
    assert.equal(outOnLoanOf(lending), 400_000);
    assert.equal(outOnLoanOf(partlyRepaid), 180_000);
  });

  test('clamps at zero once repayments overtake disbursements', () => {
    // The asymmetry with capitalOnHandOf is deliberate: the interest surplus is real money
    // and belongs in the total, but "-40,000 out on loan" describes nothing.
    assert.equal(outOnLoanOf(repaidWithInterest), 0);
  });

  test('nothing lent, nothing out', () => {
    assert.equal(outOnLoanOf(untouched), 0);
    assert.equal(outOnLoanOf(null), 0);
  });
});

describe('the three figures reconcile', () => {
  // This is the invariant the Pools & Funds strip prints as three lines, and the reason
  // lendingNetOf exists separately from outOnLoanOf. If it ever fails, the card shows an
  // addition that does not add up, which is the fastest way to lose a member's trust in
  // every other number on the page.
  for (const [name, position] of Object.entries({
    untouched, lending, partlyRepaid, repaidWithInterest
  })) {
    test(`contributed + lendingNet === onHand (${name})`, () => {
      assert.equal(
        Number(position.contributed) + lendingNetOf(position),
        capitalOnHandOf(position)
      );
    });
  }
});

describe('canFundLoan / loanShortfall', () => {
  test('a loan within the pot can be funded and is short by nothing', () => {
    assert.equal(canFundLoan(600_000, 600_000), true);
    assert.equal(loanShortfall(600_000, 600_000), 0);
  });

  test('exactly the whole pot is allowed -- the database uses > , not >=', () => {
    // Must match approve_member_transaction's `IF v_tx.amount > v_on_hand`. A SACCO
    // lending its last shilling is solvent; refusing it here while the database allows it
    // would be a rule the admin cannot act on.
    assert.equal(canFundLoan(1_000_000, 1_000_000), true);
  });

  test('one shilling over is refused, and the shortfall names it', () => {
    assert.equal(canFundLoan(1_000_001, 1_000_000), false);
    assert.equal(loanShortfall(1_000_001, 1_000_000), 1);
  });

  test('nothing can be funded from a negative pot', () => {
    assert.equal(canFundLoan(1, -150_000), false);
    assert.equal(loanShortfall(100_000, -150_000), 250_000);
  });
});

describe('formatSignedShs', () => {
  test('puts the minus in front of the currency, where it can be seen', () => {
    assert.equal(formatSignedShs(-500_000), '−Shs 500,000');
  });

  test('positive amounts carry no sign', () => {
    assert.equal(formatSignedShs(500_000), 'Shs 500,000');
  });

  test('zero is not negative zero', () => {
    assert.equal(formatSignedShs(0), 'Shs 0');
    assert.equal(formatSignedShs(-0), 'Shs 0');
  });

  test('absent and unparseable amounts render as zero rather than NaN', () => {
    assert.equal(formatSignedShs(null), 'Shs 0');
    assert.equal(formatSignedShs(undefined), 'Shs 0');
  });
});
