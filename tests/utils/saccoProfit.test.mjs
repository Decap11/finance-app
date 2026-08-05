import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectedInterestOf,
  totalProjectedInterestOf,
  realisedIncomeOf,
  grossProfitOf,
  INTEREST_EARNING_LOAN_STATUSES,
  REALISED_TRANSACTION_STATUSES
} from '../../src/utils/saccoProfit.js';

/** 500,000 at 5% a month over 6 months. Interest: 500,000 x 0.05 x 6 = 150,000. */
const sixMonthLoan = {
  amount_requested: 500_000,
  interest_rate: 5,
  term_months: 6
};

describe('projectedInterestOf', () => {
  test('flat interest across the term, matching total_repayable in 0023', () => {
    assert.equal(projectedInterestOf(sixMonthLoan), 150_000);
  });

  test('reconciles against the total_repayable the database computed', () => {
    // 0023: total_repayable = principal x (1 + rate/100 x months)
    const totalRepayable = 500_000 * (1 + (5 / 100) * 6);
    assert.equal(projectedInterestOf(sixMonthLoan), totalRepayable - 500_000);
  });

  test('an interest-free loan yields nothing', () => {
    assert.equal(projectedInterestOf({ ...sixMonthLoan, interest_rate: 0 }), 0);
  });

  test('the approved amount wins over the requested one', () => {
    // An admin who cuts a 500,000 request to 300,000 has lent 300,000, and that is what
    // earns interest.
    assert.equal(
      projectedInterestOf({ ...sixMonthLoan, amount_approved: 300_000 }),
      90_000
    );
  });

  test('a requested amount is used while no approved amount exists', () => {
    assert.equal(projectedInterestOf({ ...sixMonthLoan, amount_approved: null }), 150_000);
  });

  test('an approved amount of zero is respected, not treated as missing', () => {
    assert.equal(projectedInterestOf({ ...sixMonthLoan, amount_approved: 0 }), 0);
  });

  test('reads amount_requested -- there is no amount column on loans', () => {
    // The bug this module exists partly to close: selecting `amount` made PostgREST reject
    // the query outright, so the dashboard's interest line was always zero.
    assert.equal(projectedInterestOf({ amount: 500_000, interest_rate: 5, term_months: 6 }), 0);
  });

  test('a missing or malformed loan is worth nothing rather than NaN', () => {
    assert.equal(projectedInterestOf(null), 0);
    assert.equal(projectedInterestOf(undefined), 0);
    assert.equal(projectedInterestOf({}), 0);
    assert.equal(projectedInterestOf({ amount_requested: 'lots', interest_rate: 'some' }), 0);
  });
});

describe('totalProjectedInterestOf', () => {
  test('sums a loan book', () => {
    assert.equal(
      totalProjectedInterestOf([
        sixMonthLoan,
        { amount_requested: 100_000, interest_rate: 10, term_months: 2 }
      ]),
      170_000
    );
  });

  test('an empty book earns nothing', () => {
    assert.equal(totalProjectedInterestOf([]), 0);
  });

  test('anything that is not a list is nothing', () => {
    assert.equal(totalProjectedInterestOf(null), 0);
    assert.equal(totalProjectedInterestOf(undefined), 0);
  });

  test('only disbursed loans are meant to be counted', () => {
    // The filter belongs to the caller's query; this asserts the list it should filter by.
    assert.ok(INTEREST_EARNING_LOAN_STATUSES.includes('issued'));
    assert.ok(!INTEREST_EARNING_LOAN_STATUSES.includes('pending'));
    assert.ok(!INTEREST_EARNING_LOAN_STATUSES.includes('pending_fee'));
    assert.ok(!INTEREST_EARNING_LOAN_STATUSES.includes('rejected'));
  });
});

describe('realisedIncomeOf', () => {
  test('credits add up', () => {
    assert.equal(
      realisedIncomeOf([
        { amount: 5_000, direction: 'credit' },
        { amount: 5_000, direction: 'credit' },
        { amount: 10_000, direction: 'credit' }
      ]),
      20_000
    );
  });

  test('a reversal subtracts rather than inflating the total', () => {
    // A waived fine or refunded fee. Summing raw amounts would report 15,000 of income
    // from a SACCO that kept 5,000.
    assert.equal(
      realisedIncomeOf([
        { amount: 10_000, direction: 'credit' },
        { amount: 5_000, direction: 'debit' }
      ]),
      5_000
    );
  });

  test('a row with no direction counts as money in', () => {
    assert.equal(realisedIncomeOf([{ amount: 5_000 }]), 5_000);
  });

  test('nothing collected is zero, not NaN', () => {
    assert.equal(realisedIncomeOf([]), 0);
    assert.equal(realisedIncomeOf(null), 0);
    assert.equal(realisedIncomeOf([{ amount: null }, {}]), 0);
  });

  test('pending money is not income -- the caller filters on these', () => {
    assert.deepEqual(REALISED_TRANSACTION_STATUSES, ['completed', 'approved']);
    assert.ok(!REALISED_TRANSACTION_STATUSES.includes('pending'));
  });
});

describe('grossProfitOf', () => {
  test('the three sources add up', () => {
    assert.equal(
      grossProfitOf({ fines: 40_000, applicationFees: 200_000, loanInterest: 150_000 }),
      390_000
    );
  });

  test('application fees land in the total -- the point of the change', () => {
    const withoutFees = grossProfitOf({ fines: 40_000, loanInterest: 150_000 });
    const withFees = grossProfitOf({ fines: 40_000, loanInterest: 150_000, applicationFees: 200_000 });
    assert.equal(withFees - withoutFees, 200_000);
  });

  test('a source that was never supplied is zero, not missing', () => {
    assert.equal(grossProfitOf({ applicationFees: 5_000 }), 5_000);
    assert.equal(grossProfitOf({}), 0);
    assert.equal(grossProfitOf(), 0);
  });

  test('junk in one source does not poison the total', () => {
    assert.equal(grossProfitOf({ fines: 'plenty', applicationFees: 5_000 }), 5_000);
  });
});
