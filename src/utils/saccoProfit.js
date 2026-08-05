/**
 * What a SACCO has EARNED — expressed once.
 *
 * Distinct from `saccoCapital.js`, and the difference is worth stating because the two are
 * easy to confuse. Capital is a position: cash the SACCO is holding right now. Profit is a
 * cumulative total: everything the SACCO has ever earned on top of what members put in.
 * A shilling of fine income is in both. A shilling of member contribution is in capital
 * only — it is money the SACCO received but did not earn.
 *
 * Three sources, and they are not the same kind of number:
 *
 *   Fines          — realised. Money collected, sitting in the ledger as completed rows.
 *   Application fees — realised. Same, and the reason this module exists: the fee was
 *                    written to the ledger from the day loans shipped and counted toward
 *                    nothing, so a SACCO charging 5,000 a loan could process forty of them
 *                    and see no evidence anywhere in the app that it had earned 200,000.
 *   Loan interest  — PROJECTED. This is the interest a loan will yield if it runs its full
 *                    term and is repaid in full, not interest received. See below.
 *
 * The projection is the honest description of what the admin dashboard has always shown,
 * not an improvement on it. Realised interest is knowable — it is the surplus in
 * `lendingNetOf` once a book is repaid — but that figure only becomes non-zero at the end
 * of a term, and an admin looking at a young loan book would read a flat zero and conclude
 * their lending earns nothing. Both readings are defensible; this module keeps the existing
 * one and labels it, rather than changing what the card means without being asked.
 */

/**
 * Loan statuses whose interest counts toward the projection.
 *
 * A loan that has not been disbursed yields nothing — the money never left, and an
 * application that is later refused would otherwise inflate the figure for as long as it
 * sat in the queue. 'active' and 'repaid' are not statuses this schema writes, but they
 * have appeared in older queries against this table and cost nothing to tolerate.
 */
export const INTEREST_EARNING_LOAN_STATUSES = ['issued', 'active', 'completed', 'repaid'];

/** Transaction states that mean the money is actually in. */
export const REALISED_TRANSACTION_STATUSES = ['completed', 'approved'];

/**
 * Flat interest across the whole term, which is how this application has quoted a loan
 * since day one.
 *
 * Must agree with `total_repayable` in migration 0023:
 *
 *     total_repayable = principal x (1 + (rate / 100) x months)
 *
 * so the interest alone is `principal x (rate / 100) x months`. If the database ever moves
 * to reducing-balance, this is the second of the two places to change, and the first is
 * that migration.
 *
 * Reads `amount_requested`, which is the column the table actually has. `loans.amount` does
 * not exist; selecting it makes PostgREST reject the entire query, which is how the
 * dashboard's interest line spent its whole life displaying zero.
 */
export function projectedInterestOf(loan) {
  if (!loan) return 0;
  const principal = Number(loan.amount_approved ?? loan.amount_requested) || 0;
  const rate = Number(loan.interest_rate) || 0;
  const months = Number(loan.term_months) || 0;
  return principal * (rate / 100) * months;
}

/** The same, summed over a loan book. */
export function totalProjectedInterestOf(loans) {
  if (!Array.isArray(loans)) return 0;
  return loans.reduce((sum, loan) => sum + projectedInterestOf(loan), 0);
}

/**
 * Sum a set of ledger rows, respecting direction.
 *
 * Signed rather than absolute, and deliberately: a waived fine or a refunded fee is written
 * as a debit, and summing raw amounts would count the reversal as more income. Matches how
 * `sacco_capital_on_hand` in 0034 adds the same categories up.
 */
export function realisedIncomeOf(transactions) {
  if (!Array.isArray(transactions)) return 0;
  return transactions.reduce((sum, tx) => {
    const amount = Number(tx?.amount) || 0;
    return tx?.direction === 'debit' ? sum - amount : sum + amount;
  }, 0);
}

/**
 * The headline. Kept as a named function rather than three additions at the call site so
 * that adding a fourth source is one edit in one file, which is precisely the change that
 * was awkward when the fee needed adding.
 */
export function grossProfitOf({ fines = 0, applicationFees = 0, loanInterest = 0 } = {}) {
  return (Number(fines) || 0) + (Number(applicationFees) || 0) + (Number(loanInterest) || 0);
}
