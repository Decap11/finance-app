/**
 * What a SACCO's capital IS — expressed once.
 *
 * The app used to have two answers and neither was right. The admin dashboard summed every
 * row `get_sacco_total_balances` returned, savings included; the Pools & Funds ring summed
 * four of them, savings excluded. So the same SACCO had two "total capital" figures on two
 * screens, and an admin comparing them found a discrepancy exactly the size of every
 * member's savings.
 *
 * Worse, neither figure moved when money was lent. A loan leaves the box as a
 * `loan_disbursement` transaction, which is in none of the contribution categories, so both
 * numbers climbed steadily while the cash they described walked out of the door. There was
 * nowhere in the app to answer "where is this loan coming from", because nothing anywhere
 * tracked a quantity the loan could come out of.
 *
 * The rule now, matching `sacco_capital_on_hand` in migration 0034:
 *
 *     on hand = contributions + fines + repayments received − principal disbursed
 *
 * Savings are excluded. They are members' own money held on their behalf — a liability, not
 * the SACCO's capital, and not the SACCO's to lend.
 *
 * The database is the authority on all of this; these helpers exist so that the two screens
 * presenting it, and the guard that refuses an unaffordable loan, cannot drift into
 * describing the same numbers differently.
 */

/**
 * What lending has done to the pot, signed.
 *
 * Negative while money is out with borrowers. Positive once a book has been repaid — a
 * repayment carries interest, so a fully recovered loan returns more than it lent, and the
 * surplus is real income the SACCO now holds.
 */
export function lendingNetOf(capital) {
  if (!capital) return 0;
  return (Number(capital.repaidTotal) || 0) - (Number(capital.disbursedTotal) || 0);
}

/**
 * Contributed plus the effect of lending. This is the headline figure — the one that has to
 * fall the moment an admin approves a loan.
 *
 * Deliberately NOT clamped at zero. A negative result means the SACCO has lent more than it
 * ever collected, which is precisely the condition worth knowing about, and flooring it is
 * how it goes unnoticed for a year.
 */
export function capitalOnHandOf(capital) {
  if (!capital) return 0;
  return (Number(capital.contributed) || 0) + lendingNetOf(capital);
}

/**
 * How much of the pot is currently sitting with borrowers.
 *
 * Clamped, unlike `capitalOnHandOf`, and the asymmetry is deliberate: once repayments
 * overtake disbursements the raw difference goes negative, and "−40,000 is out on loan" is
 * not a sentence about anything. The surplus belongs in the total, not in this figure.
 */
export function outOnLoanOf(capital) {
  if (!capital) return 0;
  return Math.max(-lendingNetOf(capital), 0);
}

/**
 * Can this SACCO fund a loan of `amount` right now?
 *
 * Mirrors the check in `approve_member_transaction`, which is the one that actually
 * decides. This is for telling an admin before they click, never for deciding on the
 * database's behalf — a rule enforced in two places is free to disagree with itself, and
 * the copy in the browser is the one an attacker gets to edit.
 */
export function canFundLoan(amount, onHand) {
  return (Number(amount) || 0) <= (Number(onHand) || 0);
}

/**
 * How far short the SACCO is of funding `amount`. Zero when it can be funded.
 */
export function loanShortfall(amount, onHand) {
  const gap = (Number(amount) || 0) - (Number(onHand) || 0);
  return gap > 0 ? gap : 0;
}

/**
 * Money with the sign in front of the currency rather than inside the number:
 * "−Shs 500,000", not "Shs -500,000".
 *
 * At the size the headline renders inside the doughnut, a hyphen tucked between "Shs" and a
 * digit is easy to miss entirely — and the one figure on that card where the sign carries
 * the whole meaning is the one that has gone negative.
 */
export function formatSignedShs(amount) {
  const value = Number(amount) || 0;
  return `${value < 0 ? "−" : ""}Shs ${Math.abs(value).toLocaleString()}`;
}
