/**
 * Forthcoming Meeting Day Date Alignment Utility
 * Ensures transaction dates approved or recorded prior to a SACCO's configured meeting day
 * are systematically rendered under the forthcoming meeting day date of that week,
 * 100% in sync with the Contribution Habit Tracker.
 */

const DAY_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

/**
 * Returns ordinal suffix (st, nd, rd, th) for a given day number.
 */
export function getOrdinal(d) {
  if (d > 3 && d < 21) return 'th';
  switch (d % 10) {
    case 1:  return 'st';
    case 2:  return 'nd';
    case 3:  return 'rd';
    default: return 'th';
  }
}

/**
 * Given a raw date and configured meeting day (e.g. 'Wednesday'),
 * calculates the exact date of the meeting day for that week.
 */
export function getForthcomingMeetingDate(rawDateInput, meetingDayName = 'Wednesday') {
  if (!rawDateInput) return new Date();
  
  const rawDate = new Date(rawDateInput);
  if (isNaN(rawDate.getTime())) return new Date();

  const cleanDayName = (meetingDayName || 'Wednesday').trim().toLowerCase();
  const targetDayIndex = DAY_MAP[cleanDayName] !== undefined ? DAY_MAP[cleanDayName] : 3; // Default Wednesday
  const rawDayIndex = rawDate.getDay();

  let daysToAdd = (targetDayIndex - rawDayIndex + 7) % 7;
  
  const meetingDate = new Date(rawDate);
  meetingDate.setDate(rawDate.getDate() + daysToAdd);
  return meetingDate;
}

/** A SACCO's savings cycle. The week number runs 1..52 and then a new cycle begins. */
export const WEEKS_PER_CYCLE = 52;

/**
 * Parses anything the app stores a date as -- a Date, an ISO timestamp, a 'YYYY-MM-DD'
 * string -- into midnight UTC of that calendar day.
 *
 * UTC on purpose. The week arithmetic below counts whole days between two dates, and doing
 * that in local time silently loses an hour across a DST boundary, which is enough to push
 * a meeting into the wrong week twice a year.
 */
function toUTCDay(input) {
  if (!input) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
  }
  const str = String(input);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) ? `${str}T00:00:00Z` : str;
  const d = new Date(dateOnly);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The SACCO meeting date on or after the given date. A date already on the meeting day is
 * returned unchanged.
 *
 * The UTC twin of getForthcomingMeetingDate above, and the mirror of
 * meeting_day_on_or_after() in migration 0030. Snapping both ends of a span to the meeting
 * day is what makes the difference between them an exact multiple of seven days.
 */
export function getMeetingDayOnOrAfter(dateInput, meetingDayName = 'Wednesday') {
  const d = toUTCDay(dateInput);
  if (!d) return null;
  const target = DAY_MAP[(meetingDayName || 'Wednesday').trim().toLowerCase()] ?? 3;
  d.setUTCDate(d.getUTCDate() + ((target - d.getUTCDay() + 7) % 7));
  return d;
}

/**
 * Which week of its own 52-week cycle a date falls in, counted from the anchor -- the
 * meeting date the SACCO treats as Week 1.
 *
 * Mirrors sacco_week_of() in migration 0030, including the behaviour for dates BEFORE the
 * anchor: they belong to an earlier cycle and still get a true 1-52 position, which is why
 * the modulo is taken twice.
 */
export function getSaccoWeekOf(dateInput, anchorInput, meetingDayName = 'Wednesday') {
  const on = getMeetingDayOnOrAfter(dateInput, meetingDayName);
  const anchor = getMeetingDayOnOrAfter(anchorInput, meetingDayName);
  if (!on || !anchor) return null;

  const weeks = Math.round((on - anchor) / 86400000 / 7);
  return ((weeks % WEEKS_PER_CYCLE) + WEEKS_PER_CYCLE) % WEEKS_PER_CYCLE + 1;
}

/**
 * The SACCO's current week. Derived rather than stored, which is what makes it advance on
 * its own every meeting day.
 *
 * Clamped at 52: past that the cycle is over and an admin starts a new one, which re-anchors
 * the count. Returns null when the SACCO has no anchor, and the caller falls back to the
 * typed current_week.
 */
export function getActiveWeek(anchorInput, meetingDayName = 'Wednesday', todayInput = new Date()) {
  const anchor = getMeetingDayOnOrAfter(anchorInput, meetingDayName);
  const today = getMeetingDayOnOrAfter(todayInput, meetingDayName);
  if (!anchor || !today) return null;

  const elapsed = Math.round((today - anchor) / 86400000 / 7) + 1;
  return Math.max(1, Math.min(WEEKS_PER_CYCLE, elapsed));
}

/**
 * The meeting date a given week number of the current cycle falls on.
 *
 * The inverse of getSaccoWeekOf: that maps a date to a week, this maps a week back to its
 * date. Screens that let an admin pick a week out of a dropdown need it -- "Week 7" alone
 * does not tell anybody which meeting they are looking at, and picking the wrong one is
 * only visible once the date is on screen beside it.
 *
 * Returns null without an anchor, since an unanchored SACCO's week numbers are typed by
 * hand and correspond to no date at all.
 */
export function getMeetingDateForWeek(anchorInput, weekNumber, meetingDayName = 'Wednesday') {
  const anchor = getMeetingDayOnOrAfter(anchorInput, meetingDayName);
  const week = Number(weekNumber);
  if (!anchor || !Number.isFinite(week) || week < 1) return null;

  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
  return d;
}

/**
 * Formats a transaction's date into a user-friendly string aligned to the SACCO meeting day.
 * Always synchronized with the Contribution Habit Tracker.
 * Example output: "3rd August, week 1" or "4th August, week 1"
 */
export function formatTransactionMeetingDate(transaction, meetingDayName = 'Wednesday', fallbackWeekNum = 1) {
  if (!transaction) return '';

  const rawDateStr = transaction.completed_at || transaction.approved_at || transaction.created_at;
  const meetingDate = getForthcomingMeetingDate(rawDateStr, meetingDayName);

  const day = meetingDate.getDate();
  const month = meetingDate.toLocaleDateString('en-US', { month: 'short' });

  let weekNum = null;
  if (transaction.week_number) {
    weekNum = Number(transaction.week_number);
  } else if (transaction.description) {
    const match = transaction.description.match(/week\s*(\d+)/i);
    if (match) {
      weekNum = parseInt(match[1], 10);
    }
  }

  if (!weekNum) {
    weekNum = fallbackWeekNum || 1;
  }

  return `${day}${getOrdinal(day)} ${month}, week ${weekNum}`;
}
