/**
 * What every member is told they owe.
 *
 * This is the file the API route, the admin arrears card and the member banner all agree
 * through, so a mistake here is not a display bug -- it is a member being chased for money
 * they do not owe, or a shortfall nobody is told about. It is also pure arithmetic with one
 * dependency, so there is no excuse for it being unverified.
 *
 * Every case fixes `today`. The default is `new Date()`, and a test that let it run would
 * pass today and fail next Wednesday.
 *
 * Calendar: 2026-01-07, 01-14, 01-21, 01-28, 02-04 are consecutive Wednesdays.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMemberDues,
  summariseDues,
  meetingWeeksBetween,
  normaliseCategory,
  MANDATORY_FUNDS
} from '../../src/utils/duesEngine.js';

const RATES = { development_fund: 1000, social_fund: 2000 };
const WED = 'Wednesday';

/** A landed contribution. */
const paid = (category, amount, date, extra = {}) => ({
  category, amount, status: 'completed', direction: 'credit', created_at: date, ...extra
});

const dues = (over = {}) => computeMemberDues({
  rates: RATES, meetingDay: WED, today: '2026-02-04', ...over
});

// ---------------------------------------------------------------- helpers

test('normaliseCategory folds the legacy spellings onto the canonical ones', () => {
  assert.equal(normaliseCategory('devt'), 'development_fund');
  assert.equal(normaliseCategory('social'), 'social_fund');
  assert.equal(normaliseCategory('  DEVT '), 'development_fund');
  assert.equal(normaliseCategory('development_fund'), 'development_fund');
  assert.equal(normaliseCategory('shares'), 'shares');
  assert.equal(normaliseCategory(null), '');
});

test('meetingWeeksBetween counts whole meeting weeks', () => {
  assert.equal(meetingWeeksBetween('2026-01-07', '2026-02-04', WED), 4);
  assert.equal(meetingWeeksBetween('2026-01-07', '2026-01-07', WED), 0);
});

test('meetingWeeksBetween snaps both ends, so any two days in a week give the same answer', () => {
  // Monday the 5th and Sunday the 11th both sit in the week of Wednesday the 7th.
  assert.equal(meetingWeeksBetween('2026-01-05', '2026-02-04', WED), 4);
  assert.equal(meetingWeeksBetween('2026-01-07', '2026-02-03', WED), 4);
});

test('meetingWeeksBetween clamps a backwards span to zero', () => {
  // A record dated after today cannot put a member in arrears.
  assert.equal(meetingWeeksBetween('2026-06-03', '2026-02-04', WED), 0);
  assert.equal(meetingWeeksBetween(null, '2026-02-04', WED), 0);
});

test('only development and social fund are weekly obligations', () => {
  assert.deepEqual(MANDATORY_FUNDS, ['development_fund', 'social_fund']);
});

// ---------------------------------------------------------------- rule 1: where counting starts

test('a stated join date is used and labelled as fact', () => {
  const r = dues({ transactions: [], joinedOn: '2026-01-07' });
  assert.equal(r.startDate, '2026-01-07');
  assert.equal(r.startSource, 'stated');
  assert.equal(r.weeksElapsed, 4);
  assert.equal(r.hasRecords, false, 'stated date, but nothing on file');
});

test('a stated join date wins even when it is LATER than the first record', () => {
  // The admin correcting the software. Refusing the correction whenever it disagreed would
  // make the field pointless.
  const r = dues({
    transactions: [paid('development_fund', 1000, '2026-01-07')],
    joinedOn: '2026-01-28'
  });
  assert.equal(r.startSource, 'stated');
  assert.equal(r.weeksElapsed, 1, 'one week from 28 Jan to 4 Feb');
  assert.equal(r.hasRecords, true);
});

test('without a stated date the member\'s own earliest record is used', () => {
  // Someone whose paper trail begins in week 4 is charged from week 4, not from the SACCO's
  // week 1 -- safe against false accusation.
  const r = dues({
    transactions: [paid('development_fund', 1000, '2026-01-28')],
    fallbackStart: '2026-01-07'
  });
  assert.equal(r.startDate, '2026-01-28');
  assert.equal(r.startSource, 'first_record');
  assert.equal(r.weeksElapsed, 1);
});

test('the earliest record of ANY category counts as proof of membership', () => {
  // A shares payment in week 1 proves they were here in week 1, so their fund obligations
  // run from there -- but shares pay nothing towards those funds.
  const r = dues({ transactions: [paid('shares', 100000, '2026-01-07')] });
  assert.equal(r.startSource, 'first_record');
  assert.equal(r.weeksElapsed, 4);
  assert.equal(r.funds.development_fund.owed, 4000);
  assert.equal(r.funds.social_fund.owed, 8000);
});

test('with neither, the SACCO fallback is used and flagged as an assumption', () => {
  const r = dues({ transactions: [], fallbackStart: '2026-01-07' });
  assert.equal(r.startSource, 'assumed');
  assert.equal(r.hasRecords, false);
  assert.equal(r.totalOwed, 12000);
});

test('with nothing at all, nothing is owed rather than something invented', () => {
  const r = dues({ transactions: [], joinedOn: null, fallbackStart: null });
  assert.equal(r.startDate, null);
  assert.equal(r.startSource, 'none');
  assert.equal(r.weeksElapsed, 0);
  assert.equal(r.totalOwed, 0);
  assert.equal(r.isBehind, false);
});

test('an unparseable join date is ignored, not treated as week zero', () => {
  const r = dues({
    transactions: [paid('development_fund', 1000, '2026-01-28')],
    joinedOn: 'not a date'
  });
  assert.equal(r.startSource, 'first_record');
  assert.equal(r.weeksElapsed, 1);
});

test('a join date in the future produces no arrears', () => {
  const r = dues({ transactions: [], joinedOn: '2026-06-03' });
  assert.equal(r.weeksElapsed, 0);
  assert.equal(r.totalOwed, 0);
});

// ---------------------------------------------------------------- rule 2: running totals

test('a member paid up to date owes nothing', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [
      paid('development_fund', 1000, '2026-01-07'), paid('social_fund', 2000, '2026-01-07'),
      paid('development_fund', 1000, '2026-01-14'), paid('social_fund', 2000, '2026-01-14'),
      paid('development_fund', 1000, '2026-01-21'), paid('social_fund', 2000, '2026-01-21'),
      paid('development_fund', 1000, '2026-01-28'), paid('social_fund', 2000, '2026-01-28')
    ]
  });
  assert.equal(r.totalExpected, 12000);
  assert.equal(r.totalPaid, 12000);
  assert.equal(r.totalOwed, 0);
  assert.equal(r.weeksBehind, 0);
  assert.equal(r.isBehind, false);
});

test('one lump sum clears a four-week backlog', () => {
  // Payments are a running total, not judged week by week -- how a treasurer reads a ledger.
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [
      paid('development_fund', 4000, '2026-02-02'),
      paid('social_fund', 8000, '2026-02-02')
    ]
  });
  assert.equal(r.totalOwed, 0);
  assert.equal(r.isBehind, false);
});

test('paying more than the minimum in one week reduces what is expected later', () => {
  // The social fund is a floor. A surplus lands in `paid` and offsets the running total.
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('social_fund', 8000, '2026-01-07')]
  });
  assert.equal(r.funds.social_fund.expected, 8000);
  assert.equal(r.funds.social_fund.paid, 8000);
  assert.equal(r.funds.social_fund.owed, 0);
});

test('a partial payment leaves the remainder, rounded up to whole weeks', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('development_fund', 2500, '2026-01-14')]
  });
  const dev = r.funds.development_fund;
  assert.equal(dev.expected, 4000);
  assert.equal(dev.paid, 2500);
  assert.equal(dev.owed, 1500);
  assert.equal(dev.weeksBehind, 2, 'ceil(1500 / 1000)');
});

test('overpayment does not become a negative debt', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('development_fund', 99000, '2026-01-07')]
  });
  assert.equal(r.funds.development_fund.owed, 0);
  assert.equal(r.funds.development_fund.weeksBehind, 0);
});

// ---------------------------------------------------------------- rule 3: the in-progress week

test('the current in-progress week is not yet arrears', () => {
  // Four meetings have happened by 4 Feb (7, 14, 21, 28 Jan); that day's own meeting is not
  // counted until it has passed.
  assert.equal(dues({ joinedOn: '2026-01-07', today: '2026-02-03' }).weeksElapsed, 4);
  assert.equal(dues({ joinedOn: '2026-01-07', today: '2026-02-04' }).weeksElapsed, 4);
  assert.equal(dues({ joinedOn: '2026-01-07', today: '2026-02-05' }).weeksElapsed, 5);
});

test('paying early is credit against the backlog, not money set aside', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    today: '2026-02-04',
    transactions: [paid('development_fund', 5000, '2026-02-04')]
  });
  assert.equal(r.funds.development_fund.expected, 4000, 'this week is not owed yet');
  assert.equal(r.funds.development_fund.paid, 5000, 'but the payment counts');
  assert.equal(r.funds.development_fund.owed, 0);
});

// ---------------------------------------------------------------- statuses and direction

test('pending money is reported apart from paid and does not clear the debt', () => {
  // A member who has just submitted should be told it is waiting, not simply nagged -- but
  // an unverified declaration is not a payment.
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [{ category: 'development_fund', amount: 1000, status: 'pending',
                     direction: 'credit', created_at: '2026-01-07' }]
  });
  const dev = r.funds.development_fund;
  assert.equal(dev.paid, 0);
  assert.equal(dev.pending, 1000);
  assert.equal(dev.owed, 4000, 'pending does not reduce what is owed');
  assert.equal(r.totalPending, 1000);
  assert.equal(r.hasRecords, false, 'a pending row is not yet a record');
});

test('approved counts as landed alongside completed', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [
      paid('development_fund', 2000, '2026-01-07', { status: 'approved' }),
      paid('development_fund', 2000, '2026-01-14')
    ]
  });
  assert.equal(r.funds.development_fund.paid, 4000);
  assert.equal(r.funds.development_fund.owed, 0);
});

test('rejected and cancelled rows count as neither paid nor pending', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [
      paid('development_fund', 4000, '2026-01-07', { status: 'rejected' }),
      paid('social_fund', 8000, '2026-01-07', { status: 'cancelled' })
    ]
  });
  assert.equal(r.totalPaid, 0);
  assert.equal(r.totalPending, 0);
  assert.equal(r.totalOwed, 12000);
});

test('a debit reverses a credit instead of adding to it', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [
      paid('development_fund', 4000, '2026-01-07'),
      paid('development_fund', 1000, '2026-01-21', { direction: 'debit' })
    ]
  });
  assert.equal(r.funds.development_fund.paid, 3000);
  assert.equal(r.funds.development_fund.owed, 1000);
});

test('legacy category spellings are counted, not read as never paid', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('devt', 4000, '2026-01-07'), paid('social', 8000, '2026-01-07')]
  });
  assert.equal(r.totalOwed, 0);
});

test('a row with no date still counts as payment, but proves no start date', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [{ category: 'development_fund', amount: 4000, status: 'completed',
                     direction: 'credit', created_at: null }]
  });
  assert.equal(r.funds.development_fund.paid, 4000);
  assert.equal(r.hasRecords, false);
});

test('completed_at and approved_at stand in when created_at is absent', () => {
  const r = dues({
    transactions: [{ category: 'development_fund', amount: 1000, status: 'completed',
                     direction: 'credit', completed_at: '2026-01-28' }]
  });
  assert.equal(r.startDate, '2026-01-28');
  assert.equal(r.startSource, 'first_record');
});

// ---------------------------------------------------------------- shape and edges

test('weeksBehind is the worst fund, not the sum of them', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('development_fund', 4000, '2026-01-07')]
  });
  assert.equal(r.funds.development_fund.weeksBehind, 0);
  assert.equal(r.funds.social_fund.weeksBehind, 4);
  assert.equal(r.weeksBehind, 4);
});

test('a zero rate produces no debt and no division by zero', () => {
  const r = computeMemberDues({
    transactions: [], rates: {}, meetingDay: WED,
    joinedOn: '2026-01-07', today: '2026-02-04'
  });
  assert.equal(r.funds.development_fund.rate, 0);
  assert.equal(r.funds.development_fund.weeksBehind, 0);
  assert.equal(Number.isFinite(r.totalOwed), true);
  assert.equal(r.totalOwed, 0);
});

test('called with no arguments at all it returns a usable zero result', () => {
  const r = computeMemberDues();
  assert.equal(r.totalOwed, 0);
  assert.equal(r.startSource, 'none');
  assert.equal(r.isBehind, false);
});

test('non-numeric amounts are treated as zero, not NaN', () => {
  const r = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('development_fund', 'abc', '2026-01-07'),
                   paid('development_fund', null, '2026-01-14')]
  });
  assert.equal(r.funds.development_fund.paid, 0);
  assert.equal(Number.isNaN(r.totalOwed), false);
});

test('a full 52-week year across two DST shifts is exactly 52 weeks', () => {
  // Counted in date differences, never in week_number -- cycle numbers wrap at 52 and
  // subtracting them would be meaningless.
  const r = dues({ joinedOn: '2026-01-07', today: '2027-01-06', transactions: [] });
  assert.equal(r.weeksElapsed, 52);
  assert.equal(r.funds.development_fund.expected, 52000);
  assert.equal(r.funds.social_fund.expected, 104000);
});

// ---------------------------------------------------------------- summariseDues

test('summariseDues adds up the SACCO figure and names who to chase first', () => {
  const rows = [
    { totalOwed: 12000, totalPending: 0, startSource: 'stated', name: 'A',
      funds: { development_fund: { owed: 4000 }, social_fund: { owed: 8000 } } },
    { totalOwed: 3000, totalPending: 500, startSource: 'assumed', name: 'B',
      funds: { development_fund: { owed: 1000 }, social_fund: { owed: 2000 } } },
    { totalOwed: 0, totalPending: 0, startSource: 'assumed', name: 'C',
      funds: { development_fund: { owed: 0 }, social_fund: { owed: 0 } } }
  ];
  const s = summariseDues(rows);

  assert.equal(s.totalOwed, 15000);
  assert.equal(s.totalPending, 500);
  assert.equal(s.developmentOwed, 5000);
  assert.equal(s.socialOwed, 10000);
  assert.equal(s.memberCount, 3);
  assert.equal(s.membersBehind, 2, 'C owes nothing');
  assert.equal(s.worst.name, 'A');
});

test('summariseDues separates the assumed backlog from the measured one', () => {
  // So an admin can tell a measured figure from an assumed one before chasing anybody. A
  // member who owes nothing is not counted however their start was derived.
  const rows = [
    { totalOwed: 12000, totalPending: 0, startSource: 'stated', funds: {} },
    { totalOwed: 3000, totalPending: 0, startSource: 'assumed', funds: {} },
    { totalOwed: 0, totalPending: 0, startSource: 'assumed', funds: {} }
  ];
  const s = summariseDues(rows);
  assert.equal(s.assumedMembers, 1);
  assert.equal(s.assumedOwed, 3000);
});

test('summariseDues never counts a stated join date as assumed, however empty the ledger', () => {
  const s = summariseDues([
    { totalOwed: 9000, totalPending: 0, startSource: 'stated', funds: {} }
  ]);
  assert.equal(s.assumedMembers, 0);
  assert.equal(s.assumedOwed, 0);
});

test('summariseDues on an empty SACCO is all zeros with no worst member', () => {
  const s = summariseDues([]);
  assert.equal(s.totalOwed, 0);
  assert.equal(s.membersBehind, 0);
  assert.equal(s.memberCount, 0);
  assert.equal(s.worst, null);
});

test('summariseDues agrees with computeMemberDues end to end', () => {
  // The rollup and the per-member figures must reconcile -- they are shown on the same card.
  const alice = dues({ joinedOn: '2026-01-07', transactions: [] });
  const bob = dues({
    joinedOn: '2026-01-07',
    transactions: [paid('development_fund', 4000, '2026-01-07'),
                   paid('social_fund', 8000, '2026-01-07')]
  });
  const s = summariseDues([alice, bob]);

  assert.equal(s.totalOwed, alice.totalOwed + bob.totalOwed);
  assert.equal(s.totalOwed, 12000);
  assert.equal(s.membersBehind, 1);
  assert.equal(s.developmentOwed, 4000);
  assert.equal(s.socialOwed, 8000);
});
