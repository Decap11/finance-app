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
 * card and the member banner all agree by construction.
 *
 * Covered by tests/utils/duesEngine.test.mjs -- `npm test`. This header claimed a test script
 * for some time before one existed.
 */

// Extension included deliberately. Next resolves it either way, but Node's own ESM loader
// does not -- and without it `node --test` cannot import this file at all.
import { getMeetingDayOnOrAfter, getSaccoWeekOf } from './meetingDateUtils.js';

/** The funds a member owes every week whether or not they contribute anything else. */
export const MANDATORY_FUNDS = ['development_fund', 'social_fund'];

/**
 * What happened to one week's obligation.
 *
 * The four are deliberately distinct. A running total can only ever say "square" or "short",
 * and that is what let a missed week vanish the moment somebody paid a lump sum -- or, worse,
 * the moment somebody paid AHEAD, because credit from week 5 silently answered for week 10
 * and no screen in the app ever mentioned it.
 *
 *   PAID         money for this week arrived in this week. The ordinary case.
 *   PREPAID      covered by money that arrived BEFORE this meeting. The member is not in
 *                debt, but they did not contribute at this meeting -- which is a different
 *                fact, and the one the habit tracker is drawing.
 *   SETTLED_LATE covered, by money that arrived after this meeting had passed. This is the
 *                arrears payment, and naming it is the whole point: the week stops being a
 *                permanent black mark without the payment being disguised as punctual.
 *   PARTIAL      some money landed against this week, but less than the rate.
 *   UNPAID       nothing.
 */
export const WEEK_PAID = 'paid';
export const WEEK_PREPAID = 'prepaid';
export const WEEK_SETTLED_LATE = 'settled_late';
export const WEEK_PARTIAL = 'partial';
export const WEEK_UNPAID = 'unpaid';

/** A week still short of its rate -- what an admin chases and what a settlement clears. */
export function isOutstanding(status) {
  return status === WEEK_UNPAID || status === WEEK_PARTIAL;
}

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
 * Lays one fund's payments against the weeks they answer for.
 *
 * Three passes, in this order, and the order is the whole design:
 *
 *  1. ATTRIBUTED. A row carrying `week_number` was filed against a specific week on purpose
 *     -- that is what settle_mandatory_weeks (migration 0038) writes when an admin registers
 *     an arrears payment. An explicit statement of intent outranks any inference, so those
 *     land on their stated week before anything else is decided.
 *  2. SAME WEEK. Money that arrived in week N's own meeting week answers for week N. This
 *     pass is what keeps this ledger and the contribution heatmap telling the same story:
 *     the heatmap draws a payment on the meeting it was received at, and without this pass
 *     the two would disagree on every member who has ever been behind.
 *  3. FIFO. Whatever is left -- surplus, lump sums, catch-up money -- fills the earliest
 *     short week first, the way a treasurer clears the oldest debt from a paper ledger.
 *
 * Pass 2 before pass 3 is the part that matters. Pure FIFO is defensible accounting but it
 * makes "which week is outstanding" meaningless: money would always clear the oldest debt,
 * so the gap would slide to the most recent weeks and a member who paid punctually every
 * week except one would be reported as behind on the LATEST week rather than the one they
 * actually missed. That is precisely the question this ledger exists to answer.
 *
 * FIFO for the remainder is what keeps the answer stable. Allocating newest-first would let
 * a member's whole history re-shuffle every time they paid, so a week could flip from
 * settled back to unpaid with nobody having touched it.
 *
 * `budget` is the NET of the fund (credits less debits), not the sum of the credit rows, so
 * a reversal cannot leave weeks looking covered by money that was taken back. Only credits
 * go in the queue; the debits are already priced into the budget.
 */
function allocateFund({ weeks, payments, budget, fund, rate }) {
  if (rate <= 0) return;

  let remaining = Math.max(0, budget);

  const spend = (week, wanted, date, attributed) => {
    const slot = week.funds[fund];
    const take = Math.min(wanted, remaining, slot.expected - slot.applied);
    if (take <= 0) return 0;
    slot.applied += take;
    remaining -= take;
    // The LAST money to land on a week decides how it reads: a week half-covered on time
    // and finished three weeks later was, in the end, settled late.
    if (!slot.coveredOn || date > slot.coveredOn) slot.coveredOn = date;
    if (attributed) slot.attributed = true;
    return take;
  };

  const isShort = (w) => w.funds[fund].applied < w.funds[fund].expected;
  // Payment dates are already snapped to their meeting day, so this is an exact lookup.
  const byMeeting = new Map(weeks.map((w) => [w.meetingDate.getTime(), w]));
  const queue = payments.map((p) => ({ ...p }));

  // Pass 1 -- rows that name their week.
  queue.forEach((p) => {
    if (p.amount <= 0 || !p.weekNumber) return;
    const target = weeks.find((w) => w.weekNumber === p.weekNumber && isShort(w));
    if (target) p.amount -= spend(target, p.amount, p.date, true);
  });

  // Pass 2 -- money that landed on the meeting it was owed at.
  queue.forEach((p) => {
    if (p.amount <= 0) return;
    const target = byMeeting.get(p.date.getTime());
    if (target) p.amount -= spend(target, p.amount, p.date, false);
  });

  // Pass 3 -- everything left over, oldest short week first.
  const spill = queue.filter((p) => p.amount > 0).sort((a, b) => a.date - b.date);
  let cursor = 0;
  for (const week of weeks) {
    if (remaining <= 0) break;
    while (isShort(week) && cursor < spill.length) {
      const p = spill[cursor];
      const used = spend(week, p.amount, p.date, false);
      p.amount -= used;
      if (used === 0) break;
      if (p.amount <= 0) cursor += 1;
    }
  }
}

/** How a week reads once every shilling has been laid against it. */
function classifyWeek(slot, meetingDate) {
  if (slot.applied <= 0) return WEEK_UNPAID;
  if (slot.applied < slot.expected) return WEEK_PARTIAL;
  if (!slot.coveredOn) return WEEK_PAID;
  if (slot.coveredOn > meetingDate) return WEEK_SETTLED_LATE;
  if (slot.coveredOn < meetingDate) return WEEK_PREPAID;
  return WEEK_PAID;
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
  // The SACCO's Week 1. Only needed to put a 1-52 cycle number on each ledger week; the
  // arithmetic itself still runs entirely on dates, so a SACCO with no anchor gets the full
  // ledger with `weekNumber: null` rather than no ledger at all.
  weekAnchor = null,
  today = new Date()
} = {}) {
  const rows = transactions.map((tx) => ({
    category: normaliseCategory(tx.category),
    amount: Number(tx.amount) || 0,
    status: String(tx.status || '').trim().toLowerCase(),
    // Contributions are always credits. Honoured anyway so an adjustment or a reversal
    // reduces what a member is credited with instead of increasing it.
    direction: String(tx.direction || 'credit').trim().toLowerCase(),
    date: tx.created_at || tx.completed_at || tx.approved_at || null,
    // Set only by an admin registering a payment against a named week. Null everywhere
    // else, including on every contribution a member files for themselves.
    weekNumber: Number(tx.week_number) || null
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

  // One entry per meeting week that has PASSED, oldest first. The in-progress week is
  // excluded for the same reason it is excluded from `expected` -- a week has to be over
  // before missing it means anything.
  const weeks = [];
  for (let i = 0; i < weeksElapsed; i += 1) {
    const meetingDate = new Date(startDate.getTime() + i * MS_PER_WEEK);
    const entry = {
      ordinal: i + 1,
      meetingDate,
      weekNumber: weekAnchor ? getSaccoWeekOf(meetingDate, weekAnchor, meetingDay) : null,
      funds: {}
    };
    MANDATORY_FUNDS.forEach((fund) => {
      entry.funds[fund] = {
        expected: Number(rates[fund]) || 0,
        applied: 0,
        coveredOn: null,
        attributed: false
      };
    });
    weeks.push(entry);
  }

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
    const payments = [];

    rows.forEach((r) => {
      if (r.category !== fund) return;
      const signed = r.direction === 'debit' ? -r.amount : r.amount;
      if (PAID_STATUSES.has(r.status)) {
        paid += signed;
        // Only credits go in the queue -- debits are already netted out of `paid`, which
        // is what caps the allocation below.
        if (signed > 0 && r.date) {
          payments.push({
            amount: signed,
            date: getMeetingDayOnOrAfter(r.date, meetingDay),
            weekNumber: r.weekNumber
          });
        }
      } else if (PENDING_STATUSES.has(r.status)) pending += signed;
    });

    allocateFund({ weeks, payments, budget: paid, fund, rate });

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

  // Classified only once every fund has been allocated, then flattened into the list the
  // admin card, the member banner and the settlement endpoint all read. `outstandingWeeks`
  // is the answer to "who owes what, for which week" -- the question a running total could
  // never be asked.
  const outstandingWeeks = [];
  const ledger = weeks.map((week) => {
    const iso = week.meetingDate.toISOString().slice(0, 10);
    const out = { ordinal: week.ordinal, weekNumber: week.weekNumber, meetingDate: iso, funds: {} };

    MANDATORY_FUNDS.forEach((fund) => {
      const slot = week.funds[fund];
      const status = classifyWeek(slot, week.meetingDate);
      const shortfall = Math.max(0, slot.expected - slot.applied);

      out.funds[fund] = {
        expected: slot.expected,
        applied: slot.applied,
        shortfall,
        status,
        // True when an admin filed this money against this week by name rather than the
        // engine inferring it. Shown so a settled week can be told from a deduced one.
        attributed: slot.attributed,
        coveredOn: slot.coveredOn ? slot.coveredOn.toISOString().slice(0, 10) : null
      };

      if (slot.expected > 0 && isOutstanding(status)) {
        outstandingWeeks.push({
          ordinal: week.ordinal,
          weekNumber: week.weekNumber,
          meetingDate: iso,
          fund,
          expected: slot.expected,
          applied: slot.applied,
          shortfall,
          status
        });
      }
    });

    return out;
  });

  return {
    weeks: ledger,
    outstandingWeeks,
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
