/**
 * When an admin gets reminded about a loan.
 *
 * The rule in one sentence: the same day of each following month, from disbursement until
 * the term elapses or the balance reaches zero. Everything below pins one part of that.
 *
 * Every case fixes `today`. The default is `new Date()`, and a test that let it run would
 * pass today and fail next month.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMonthsClamped,
  daysBetween,
  loanStartDate,
  loanCheckpoints,
  summariseLoan,
  summariseLoanReminders
} from '../../src/utils/loanSchedule.js';

/** A live loan, disbursed on the 28th of September over three months. */
const loan = (over = {}) => ({
  id: 'loan-1',
  disbursed_at: '2026-09-28',
  term_months: 3,
  status: 'active',
  outstanding_balance: 300000,
  ...over
});

const iso = (d) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ month arithmetic

test('addMonthsClamped keeps the same day of the month', () => {
  assert.equal(iso(addMonthsClamped('2026-09-28', 1)), '2026-10-28');
  assert.equal(iso(addMonthsClamped('2026-09-28', 2)), '2026-11-28');
  assert.equal(iso(addMonthsClamped('2026-09-28', 3)), '2026-12-28');
});

test('addMonthsClamped rolls the year over', () => {
  assert.equal(iso(addMonthsClamped('2026-11-15', 3)), '2027-02-15');
});

test('addMonthsClamped clamps to the last day of a short month', () => {
  // There is no 31 February. Native Date would roll this over into March.
  assert.equal(iso(addMonthsClamped('2026-01-31', 1)), '2026-02-28');
  assert.equal(iso(addMonthsClamped('2026-03-31', 1)), '2026-04-30');
});

test('addMonthsClamped honours a leap February', () => {
  assert.equal(iso(addMonthsClamped('2028-01-31', 1)), '2028-02-29');
});

test('a clamped month does not drag the rest of the schedule back', () => {
  // The whole reason each checkpoint is computed from the START rather than from the
  // previous one. Chaining would clamp January's 31st to 28 February and never recover.
  const points = loanCheckpoints(
    { disbursed_at: '2026-01-31', term_months: 3 },
    '2026-01-31'
  );

  assert.deepEqual(points.map((c) => c.date), ['2026-02-28', '2026-03-31', '2026-04-30']);
});

test('daysBetween counts whole days in both directions', () => {
  assert.equal(daysBetween('2026-09-28', '2026-10-28'), 30);
  assert.equal(daysBetween('2026-10-28', '2026-09-28'), -30);
  assert.equal(daysBetween('2026-09-28', '2026-09-28'), 0);
});

// ------------------------------------------------------------------ the start date

test('the clock starts at disbursement, not at the request', () => {
  const d = loanStartDate({ requested_at: '2026-09-01', approved_at: '2026-09-20', disbursed_at: '2026-09-28' });
  assert.equal(iso(d), '2026-09-28');
});

test('a row with no disbursement falls back, in order', () => {
  assert.equal(iso(loanStartDate({ requested_at: '2026-09-01', approved_at: '2026-09-20' })), '2026-09-20');
  assert.equal(iso(loanStartDate({ requested_at: '2026-09-01' })), '2026-09-01');
  assert.equal(loanStartDate({}), null);
});

// ------------------------------------------------------------------ the checkpoints

test('a 3-month loan taken on 28 September is owed attention on the 28th of each month', () => {
  const points = loanCheckpoints(loan(), '2026-09-28');

  assert.equal(points.length, 3);
  assert.deepEqual(points.map((c) => c.date), ['2026-10-28', '2026-11-28', '2026-12-28']);
  // Disbursement day itself is not a checkpoint -- the first reminder is a month later.
  assert.equal(points.every((c) => c.status === 'upcoming'), true);
  assert.equal(points[2].isFinal, true);
});

test('an anniversary date reads as due today, and only that date', () => {
  assert.equal(summariseLoan(loan(), '2026-10-28').dueToday, true);
  assert.equal(summariseLoan(loan(), '2026-11-28').dueToday, true);
  assert.equal(summariseLoan(loan(), '2026-12-28').dueToday, true);

  assert.equal(summariseLoan(loan(), '2026-10-27').dueToday, false);
  assert.equal(summariseLoan(loan(), '2026-10-29').dueToday, false);
});

test('the period remaining counts down month by month', () => {
  assert.equal(summariseLoan(loan(), '2026-09-28').monthsRemaining, 3);
  assert.equal(summariseLoan(loan(), '2026-10-28').monthsRemaining, 3); // today still counts
  assert.equal(summariseLoan(loan(), '2026-10-29').monthsRemaining, 2);
  assert.equal(summariseLoan(loan(), '2026-12-28').monthsRemaining, 1);
  assert.equal(summariseLoan(loan(), '2026-12-29').monthsRemaining, 0);
});

test('the next checkpoint is the one to chase', () => {
  const s = summariseLoan(loan(), '2026-11-01');
  assert.equal(s.nextCheckpoint.date, '2026-11-28');
  assert.equal(s.nextCheckpoint.daysAway, 27);
});

// ------------------------------------------------------------------ stopping

test('reminders stop the moment the balance reaches zero', () => {
  // Cleared inside the term. 28 November would otherwise be an anniversary.
  const s = summariseLoan(loan({ outstanding_balance: 0 }), '2026-11-28');
  assert.equal(s.isLive, false);
  assert.equal(s.dueToday, false);
});

test('reminders stop once the loan is closed, whatever the balance says', () => {
  assert.equal(summariseLoan(loan({ status: 'completed' }), '2026-11-28').isLive, false);
  assert.equal(summariseLoan(loan({ status: 'rejected' }), '2026-11-28').isLive, false);
  assert.equal(summariseLoan(loan({ status: 'cancelled' }), '2026-11-28').isLive, false);
  // Still awaiting approval is not yet a loan anybody is repaying.
  assert.equal(summariseLoan(loan({ status: 'pending' }), '2026-11-28').isLive, false);
});

test('an unpaid loan past its final date is overdue, and says by how long', () => {
  const s = summariseLoan(loan(), '2027-01-11');
  assert.equal(s.isOverdue, true);
  assert.equal(s.daysOverdue, 14);
  assert.equal(s.monthsRemaining, 0);
});

test('a loan repaid after its term is not chased', () => {
  const s = summariseLoan(loan({ outstanding_balance: 0, status: 'completed' }), '2027-01-11');
  assert.equal(s.isOverdue, false);
});

test('an agreed due_date outranks start-plus-term', () => {
  const s = summariseLoan(loan({ due_date: '2027-01-15' }), '2026-09-28');
  assert.equal(s.finalDate, '2027-01-15');
});

test('a loan nobody can date produces no schedule rather than a fictional one', () => {
  const s = summariseLoan({ status: 'active', outstanding_balance: 5000, term_months: 3 }, '2026-10-28');
  assert.equal(s.schedulable, false);
  assert.equal(s.dueToday, false);
  assert.deepEqual(s.checkpoints, []);

  const noTerm = summariseLoan({ status: 'active', outstanding_balance: 5000, disbursed_at: '2026-09-28' }, '2026-10-28');
  assert.equal(noTerm.schedulable, false);
});

// ------------------------------------------------------------------ the admin list

test('the list is ranked by what needs acting on first', () => {
  const overdue = loan({ id: 'overdue', disbursed_at: '2026-01-28', term_months: 3 });
  const todayDue = loan({ id: 'today' });
  const later = loan({ id: 'later', disbursed_at: '2026-10-20', term_months: 6 });

  const s = summariseLoanReminders([later, todayDue, overdue], '2026-10-28');

  assert.deepEqual(s.rows.map((r) => r.loanId), ['overdue', 'today', 'later']);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueToday, 1);
  assert.equal(s.liveLoans, 3);
});

test('cleared loans are left out of the list entirely', () => {
  const s = summariseLoanReminders(
    [loan(), loan({ id: 'paid', outstanding_balance: 0, status: 'completed' })],
    '2026-10-28'
  );

  assert.equal(s.liveLoans, 1);
  assert.equal(s.totalOutstanding, 300000);
});

test('an empty book is not an error', () => {
  const s = summariseLoanReminders([], '2026-10-28');
  assert.deepEqual(s.rows, []);
  assert.equal(s.dueToday, 0);
  assert.equal(s.totalOutstanding, 0);
});
