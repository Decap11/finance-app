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
  const month = meetingDate.toLocaleDateString('en-US', { month: 'long' });

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
