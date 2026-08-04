/**
 * Weekly mandatory fund arrears.
 *
 * Development fund and social fund are owed every meeting week, by every member. Shares are not
 * (1-10, the member's choice) and fines are not (levied for a reason, not owed on a schedule) --
 * so those two are the only funds this file knows about.
 *
 * The social fund rate is a MINIMUM: a member meets the week with that amount or anything above
 * it. That needs no special case here -- `expected` is built from the minimum, which is what is
 * owed, and a surplus simply lands in `paid`. What it does mean is that giving extra in one week
 * reduces what is expected in later ones, which follows from the running-total rule below and is
 * the same arithmetic that lets a lump sum clear a backlog.
 *
 * Arrears are DERIVED, never stored. There is no scheduler in this app to write a "week
 * passed" row every meeting day, and a derived number self-heals: backfill a record that was
 * missing and the shortfall corrects itself on the next read. The whole thing is pure
 * arithmetic over transactions the caller has already fetched, so the API route, the admin
 * card, the member banner and the test script all agree by construction.
 */

import { getMeetingDayOnOrAfter } from './meetingDateUtils';

/** The funds a member owes every week whether or not they contribute anything else. */
export const MANDATORY_FUNDS = ['development_fund', 'social_fund'];

/** Money that has actually landed. Anything else is not yet a payment. */
const PAID_STATUSES = new Set(['completed', 'approved']);

/** Declared but not verified. Reported apart from `paid` so a member who has just paid is
 *  told their submission is waiting, rather than simply nagged for money they have sent. */
const PENDING_STATUSES = new Set(['pending']);

const MS_PER_WEEK = 7 * 86400000;

/**
 * Folds the legacy category spellings onto the canonical ones.
 *
 * The same two aliases are already guarded against in the weekly report
 * (saccoSettings.jsx) and the heatmap (calendarHeatMap.jsx); a row written under an old
 * spelling must not silently count as "never paid".
 */
export function normaliseCategory(raw) {
  const cat = String(raw || '').trim().toLowerCase();
  if (cat === 'devt') return 'development_fund';
  if (cat === 'social') return 'social_fund';
  return cat;
}

/**
 * Whole meeting weeks from one date to another.
 *
 * Both ends are snapped forward to the SACCO's meeting day first, which is what makes the
 * difference an exact multiple of seven days -- the same convention every other date in this
 * app follows. Negative spans clamp to 0: a record dated after today cannot put a member in
 * arrears.
 */
export function meetingWeeksBetween(from, to, meetingDay = 'Wednesday') {
  const start = getMeetingDayOnOrAfter(from, meetingDay);
  const end = getMeetingDayOnOrAfter(to, meetingDay);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end - start) / MS_PER_WEEK));
}

/**
 * What one member owes.
 *
 * @param {object[]} transactions  That member's rows: { category, amount, status, direction, created_at }.
 * @param {object}   rates         { development_fund, social_fund } -- the weekly amount for each.
 * @param {string}   meetingDay    The SACCO's meeting day.
 * @param {*}        joinedOn      profiles.joined_on -- the date an admin has STATED this member
 *                                 joined the SACCO. null when nobody has said.
 * @param {*}        fallbackStart Where to start counting for a member with no records at all
 *                                 -- the SACCO's week anchor, or its onboarding date.
 * @param {*}        today         Overridable so the arithmetic can be tested against fixed dates.
 *
 * The three rules that make the numbers what they are, all settled deliberately:
 *
 *  1. Counting starts at the earliest of three things, in this order of authority:
 *
 *         joined_on  ->  first record  ->  fallbackStart
 *          (fact)        (inference)      (last resort)
 *
 *     A stated join date always wins, because it is the one thing here that is known rather
 *     than deduced. Without it the member's OWN earliest record is used -- someone whose paper
 *     trail begins in week 20 of a 40-week SACCO is charged 20 weeks, not 39. That inference
 *     is safe against false accusation but has a blind spot it cannot close: it reads "was
 *     here since week 1 and paid nothing until week 20" as "joined in week 20", forgiving the
 *     nineteen unpaid weeks. Stating the join date is what closes it (migration 0031).
 *
 *     A member with neither falls back to `fallbackStart` and is flagged `hasRecords: false`,
 *     because that figure is an assumption rather than a measurement.
 *  2. Payments are a RUNNING TOTAL, not judged week by week. A member who clears three weeks
 *     with one lump sum is square, which is how a treasurer reads a paper ledger and how
 *     members actually pay.
 *  3. The current, in-progress week is excluded from `expected` but included in `paid`. A week
 *     has to have PASSED before missing it is arrears; and paying early is credit against the
 *     backlog, not money set aside.
 *
 * Note this works entirely in date differences, never in `week_number`. Cycle week numbers
 * wrap at 52, so a SACCO with three years of history has three separate rows numbered "week 7"
 * and subtracting them would be meaningless.
 */
export function computeMemberDues({
  transactions = [],
  rates = {},
  meetingDay = 'Wednesday',
  joinedOn = null,
  fallbackStart = null,
  today = new Date()
} = {}) {
  const rows = transactions.map((tx) => ({
    category: normaliseCategory(tx.category),
    amount: Number(tx.amount) || 0,
    status: String(tx.status || '').trim().toLowerCase(),
    // Contributions are always credits. Honoured anyway so an adjustment or a reversal
    // reduces what a member is credited with instead of increasing it.
    direction: String(tx.direction || 'credit').trim().toLowerCase(),
    date: tx.created_at || tx.completed_at || tx.approved_at || null
  }));

  // The member's earliest record of ANY kind that actually landed. A shares payment in week 5
  // is proof they were a member in week 5, so their fund obligations run from there too.
  let firstRecord = null;
  rows.forEach((r) => {
    if (!r.date || !PAID_STATUSES.has(r.status)) return;
    const d = getMeetingDayOnOrAfter(r.date, meetingDay);
    if (d && (!firstRecord || d < firstRecord)) firstRecord = d;
  });

  const hasRecords = Boolean(firstRecord);

  // A stated join date outranks the inference even when it is LATER than the first record --
  // it is the admin correcting the software, and refusing the correction whenever it happened
  // to disagree would make the field pointless. Only an unparseable date is ignored.
  const stated = joinedOn ? getMeetingDayOnOrAfter(joinedOn, meetingDay) : null;

  // Nothing on file and nothing stated: fall back to the SACCO's own Week 1. Somebody who has
  // never paid anything is exactly who should show as behind -- but the figure is an
  // assumption, not a measurement, so `hasRecords` carries that all the way to the UI. An
  // admin reading a large number needs to know whether it came from records or from the
  // absence of them.
  let startDate = stated || firstRecord;
  if (!startDate && fallbackStart) {
    startDate = getMeetingDayOnOrAfter(fallbackStart, meetingDay);
  }

  // Which of the three the figure actually rests on, so every surface can say so plainly.
  const startSource = stated ? 'stated' : (firstRecord ? 'first_record' : (startDate ? 'assumed' : 'none'));

  const weeksElapsed = startDate ? meetingWeeksBetween(startDate, today, meetingDay) : 0;

  const funds = {};
  let totalOwed = 0;
  let totalPending = 0;
  let totalExpected = 0;
  let totalPaid = 0;
  let weeksBehind = 0;

  MANDATORY_FUNDS.forEach((fund) => {
    const rate = Number(rates[fund]) || 0;
    const expected = weeksElapsed * rate;

    let paid = 0;
    let pending = 0;

    rows.forEach((r) => {
      if (r.category !== fund) return;
      const signed = r.direction === 'debit' ? -r.amount : r.amount;
      if (PAID_STATUSES.has(r.status)) paid += signed;
      else if (PENDING_STATUSES.has(r.status)) pending += signed;
    });

    const owed = Math.max(0, expected - paid);
    // With a fixed weekly rate this is exactly the number of weeks' worth outstanding, which
    // is the figure a member understands ("you are four weeks behind") far better than a
    // shilling total on its own.
    const behind = rate > 0 ? Math.ceil(owed / rate) : 0;

    funds[fund] = { rate, expected, paid, pending, owed, weeksBehind: behind };

    totalOwed += owed;
    totalPending += Math.max(0, pending);
    totalExpected += expected;
    totalPaid += paid;
    weeksBehind = Math.max(weeksBehind, behind);
  });

  return {
    startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
    // 'stated' | 'first_record' | 'assumed' | 'none'. Only 'stated' is a fact; the other two
    // are labelled as inference wherever they are shown.
    startSource,
    // false means this member has no records at all, so the start was assumed rather than
    // measured. Kept separate from startSource because a member can have a stated join date
    // AND no records -- an accurate figure that still deserves the "nothing on file" note.
    hasRecords,
    weeksElapsed,
    funds,
    totalExpected,
    totalPaid,
    totalOwed,
    totalPending,
    weeksBehind,
    isBehind: totalOwed > 0
  };
}

/**
 * Rolls per-member results up to the SACCO figure the admin card shows.
 *
 * `worst` drives the collapsed card's one-line summary, so it is the member the admin would
 * chase first.
 */
export function summariseDues(rows = []) {
  let totalOwed = 0;
  let totalPending = 0;
  let developmentOwed = 0;
  let socialOwed = 0;
  let membersBehind = 0;
  // How much of the total rests on a start nobody stated and no record supports. Reported so
  // an admin can tell a measured backlog from an assumed one before chasing anybody for it.
  // A member with a STATED join date is never counted here, however empty their ledger --
  // that figure is exact, and it is the one the join-date field exists to produce.
  let assumedMembers = 0;
  let assumedOwed = 0;
  let worst = null;

  rows.forEach((row) => {
    totalOwed += Number(row.totalOwed) || 0;
    totalPending += Number(row.totalPending) || 0;
    developmentOwed += Number(row.funds?.development_fund?.owed) || 0;
    socialOwed += Number(row.funds?.social_fund?.owed) || 0;

    if ((Number(row.totalOwed) || 0) > 0) {
      membersBehind += 1;
      if (!worst || row.totalOwed > worst.totalOwed) worst = row;
      if (row.startSource === 'assumed') {
        assumedMembers += 1;
        assumedOwed += Number(row.totalOwed) || 0;
      }
    }
  });

  return {
    totalOwed,
    totalPending,
    developmentOwed,
    socialOwed,
    membersBehind,
    assumedMembers,
    assumedOwed,
    memberCount: rows.length,
    worst
  };
}
