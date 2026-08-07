/**
 * When a loan's monthly checkpoints fall, and which of them are due.
 *
 * A loan taken on 28 September over three months is owed attention on 28 October,
 * 28 November and 28 December -- the same day of each following month until the term
 * elapses or the loan is cleared. This file turns a loan row into that list of dates and
 * says where today sits in it.
 *
 * DERIVED, never stored, for the same reason arrears are (see duesEngine.js): there is no
 * scheduler in this app. Nothing runs at midnight to write a "reminder due" row, so a
 * stored schedule would be a table that is only ever correct immediately after somebody
 * happened to open a page. Recomputing on every read cannot drift, and a loan repaid early
 * stops producing reminders the moment its balance reaches zero, with nothing to clean up.
 *
 * Covered by tests/utils/loanSchedule.test.mjs -- `npm test`.
 */

/** Loan states that are still owed money and therefore still worth a reminder. */
const LIVE_STATUSES = new Set(['disbursed', 'issued', 'active', 'overdue']);

/** Where today sits relative to one checkpoint. */
export const CHECKPOINT_PASSED = 'passed';
export const CHECKPOINT_DUE_TODAY = 'due_today';
export const CHECKPOINT_UPCOMING = 'upcoming';

const MS_PER_DAY = 86400000;

/**
 * Parses whatever a date is stored as into midnight UTC of that calendar day.
 *
 * UTC deliberately, matching meetingDateUtils: this file counts whole days between dates,
 * and local-time day arithmetic loses an hour across a DST boundary -- enough to move a
 * reminder onto the wrong day twice a year.
 */
export function toUTCDay(input) {
  if (!input) return null;
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The same day-of-month, N months on, clamped to the end of a short month.
 *
 * 31 January plus one month is 28 February (29 in a leap year), because there is no 31st.
 * Without the clamp the native Date rolls over into 3 March, which would put a reminder in
 * the wrong month entirely.
 *
 * Every checkpoint is computed from the ORIGINAL start day rather than from the previous
 * checkpoint. That is what keeps a loan taken on the 31st landing on the 31st of every
 * month that has one: chaining would clamp 31 January to 28 February and then never
 * recover, walking the whole schedule back three days for the rest of the term.
 */
export function addMonthsClamped(date, months) {
  const start = toUTCDay(date);
  if (!start) return null;

  const day = start.getUTCDate();
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Whole days from one day to another. Negative when `to` is earlier. */
export function daysBetween(from, to) {
  const a = toUTCDay(from);
  const b = toUTCDay(to);
  if (!a || !b) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The date a loan's clock starts.
 *
 * Disbursement first, because that is when the member actually received the money and
 * therefore when the term begins. The rest are fallbacks for rows written before the
 * lifecycle columns existed, or backfilled by log_historical_record.
 */
export function loanStartDate(loan = {}) {
  return toUTCDay(
    loan.disbursed_at || loan.approved_at || loan.requested_at || loan.created_at || null
  );
}

/**
 * Every monthly checkpoint for one loan, with today's position marked.
 *
 * @param {object} loan   A loans row: { term_months, disbursed_at, due_date, status, outstanding_balance }.
 * @param {*}      today  Overridable so the arithmetic can be tested against fixed dates.
 *
 * Returns null when the loan has no usable start date or no term -- a loan nobody can date
 * cannot be scheduled, and inventing a start would produce reminders against a fiction.
 */
export function loanCheckpoints(loan = {}, today = new Date()) {
  const start = loanStartDate(loan);
  const term = Number(loan.term_months) || 0;
  if (!start || term <= 0) return null;

  const now = toUTCDay(today);
  const checkpoints = [];

  for (let month = 1; month <= term; month += 1) {
    const date = addMonthsClamped(start, month);
    const offset = daysBetween(now, date);

    checkpoints.push({
      month,
      date: date.toISOString().slice(0, 10),
      // The last checkpoint is the end of the agreed term -- the date the loan should be
      // fully repaid by, not merely another instalment.
      isFinal: month === term,
      daysAway: offset,
      status: offset === 0
        ? CHECKPOINT_DUE_TODAY
        : offset < 0 ? CHECKPOINT_PASSED : CHECKPOINT_UPCOMING
    });
  }

  return checkpoints;
}

/**
 * One loan, as the admin reminder list needs it.
 *
 * `dueToday` is the flag the whole feature exists for: it is true on the loan's own
 * monthly anniversary and on no other day, which is exactly "notify me on that same date
 * of the following months".
 */
export function summariseLoan(loan = {}, today = new Date()) {
  const checkpoints = loanCheckpoints(loan, today);
  const outstanding = Number(loan.outstanding_balance) || 0;
  const status = String(loan.status || '').trim().toLowerCase();

  // Cleared inside the term, or closed by any route. Either way the reminders stop --
  // "till the loan is cleared" is the other half of the rule, and this is where a repaid
  // loan silently drops out of the list with nothing to tidy up.
  const isLive = LIVE_STATUSES.has(status) && outstanding > 0;

  if (!checkpoints) {
    return {
      loanId: loan.id || null,
      schedulable: false,
      isLive,
      outstanding,
      checkpoints: [],
      dueToday: false,
      monthsRemaining: null,
      nextCheckpoint: null,
      finalDate: loan.due_date || null,
      isOverdue: false,
      daysOverdue: 0
    };
  }

  const remaining = checkpoints.filter((c) => c.status !== CHECKPOINT_PASSED);
  const finalPoint = checkpoints[checkpoints.length - 1];
  const daysPastFinal = -(finalPoint.daysAway);

  return {
    loanId: loan.id || null,
    schedulable: true,
    isLive,
    outstanding,
    checkpoints,
    // True only on an anniversary date, and only while the loan is still owed.
    dueToday: isLive && checkpoints.some((c) => c.status === CHECKPOINT_DUE_TODAY),
    // Checkpoints not yet passed, today's included. This is the "period remaining".
    monthsRemaining: remaining.length,
    nextCheckpoint: remaining[0] || null,
    // The stored due_date wins when it exists -- an admin may have agreed a date that is
    // not exactly start plus term, and the agreement outranks the arithmetic.
    finalDate: loan.due_date || finalPoint.date,
    isOverdue: isLive && daysPastFinal > 0,
    daysOverdue: isLive && daysPastFinal > 0 ? daysPastFinal : 0
  };
}

/**
 * The whole SACCO's live loans, ranked by how much they need the admin today.
 *
 * Overdue first, then whatever falls due today, then by nearest checkpoint. That ordering
 * is the point of the list: it opens on the loan the admin should act on first.
 */
export function summariseLoanReminders(loans = [], today = new Date()) {
  const rows = loans
    .map((loan) => ({ ...summariseLoan(loan, today), loan }))
    .filter((row) => row.isLive);

  rows.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.isOverdue && b.isOverdue) return b.daysOverdue - a.daysOverdue;
    if (a.dueToday !== b.dueToday) return a.dueToday ? -1 : 1;
    const an = a.nextCheckpoint?.daysAway ?? Infinity;
    const bn = b.nextCheckpoint?.daysAway ?? Infinity;
    return an - bn;
  });

  return {
    rows,
    dueToday: rows.filter((r) => r.dueToday).length,
    overdue: rows.filter((r) => r.isOverdue).length,
    liveLoans: rows.length,
    totalOutstanding: rows.reduce((sum, r) => sum + r.outstanding, 0)
  };
}
