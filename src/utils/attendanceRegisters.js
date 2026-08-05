/**
 * Finding and reading a week's attendance register.
 *
 * A register is one row in `audit_events` with entity_type 'sacco_attendance', carrying the
 * whole week's map in its metadata. Saving appends a row rather than updating one, so a week
 * that has been corrected has several and the newest is the truth.
 *
 * The arithmetic lives here rather than in WeeklyAttendanceManager because two of the three
 * rules below are the kind that go wrong silently -- an admin reviewing a past meeting is
 * given a screen full of numbers with nothing to check them against, so a register matched
 * to the wrong week looks exactly like a register matched to the right one.
 */

import { getMeetingDayOnOrAfter, WEEKS_PER_CYCLE } from './meetingDateUtils.js';

export { WEEKS_PER_CYCLE };

/** The three things a member can be on a register. Anything else is "not marked". */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'excused'];

/**
 * The identity of a 52-week cycle, as stored on each register it produced.
 *
 * Week numbers repeat: every cycle has a Week 3. Without this, the second year of a SACCO's
 * life writes its Week 3 register under the same key as the first year's, and since the
 * newest row wins, last year's meeting becomes unreachable through the week dropdown and
 * this year's silently takes its place on screen.
 *
 * The anchor date IS the cycle -- start_new_sacco_cycle moves it forward 52 weeks and that
 * is the only thing that changes -- so it needs no separate counter. Normalised through the
 * meeting-day snap so a stored 'YYYY-MM-DD' and a full ISO timestamp of the same day cannot
 * produce two different keys for one cycle.
 *
 * Null for a SACCO that has never been onboarded: it has no anchor, its week number is typed
 * by hand, and it therefore has no cycles to tell apart.
 */
export function cycleKeyOf(anchorInput, meetingDayName = 'Wednesday') {
  const anchor = getMeetingDayOnOrAfter(anchorInput, meetingDayName);
  return anchor ? anchor.toISOString().slice(0, 10) : null;
}

/**
 * Whether a stored register belongs to the cycle now being viewed.
 *
 * Registers written before the cycle key existed carry no anchor, and which cycle they came
 * from is not recoverable from the row. They are accepted rather than hidden: refusing them
 * would blank out every register saved before this field was added, which is a worse answer
 * than the collision it protects against.
 */
function sameCycle(recordedKey, cycleKey) {
  if (!recordedKey || !cycleKey) return true;
  return recordedKey === cycleKey;
}

/**
 * The register for one week, or null if that meeting was never recorded.
 *
 * `records` must arrive newest-first; the first match wins, which is what makes re-saving a
 * week a correction rather than a duplicate.
 *
 * Null is a real answer here, not a failure — see the note in tallyAttendance about why it
 * must not be turned back into a full house of present members.
 */
export function findWeekRegister(records, { groupCode, weekNumber, cycleKey = null } = {}) {
  const wantedGroup = String(groupCode || '').trim().toLowerCase();
  const wantedWeek = Number(weekNumber);
  if (!wantedGroup || !Number.isFinite(wantedWeek)) return null;

  const match = (records || []).find((r) => {
    const meta = r?.metadata;
    if (!meta || !meta.attendance_map) return false;
    if (String(meta.group_code || '').trim().toLowerCase() !== wantedGroup) return false;
    if (Number(meta.week_number) !== wantedWeek) return false;
    return sameCycle(meta.cycle_anchor ?? null, cycleKey);
  });

  if (!match) return null;

  return {
    attendance: match.metadata.attendance_map || {},
    // registered_at is written by the save; created_at is the row's own clock and covers
    // registers written before that field existed.
    savedAt: match.metadata.registered_at || match.created_at || null
  };
}

/**
 * A member's status on a register, or null when the register does not mention them.
 *
 * The null matters. This used to read `attendance[id] || 'present'`, which meant a member
 * who joined after the meeting -- and so appears in no register from before they arrived --
 * was shown as having attended it.
 */
export function statusOf(attendance, memberId) {
  const status = attendance?.[memberId];
  return ATTENDANCE_STATUSES.includes(status) ? status : null;
}

/**
 * The counts behind the tiles, taken over the member list rather than over the stored map.
 *
 * Counting the map's own values instead is what let the tiles and the rows disagree: a
 * member who has since left the SACCO stayed in an old map and kept being counted with no
 * row to show for it, while one who joined later had a row but no entry to count.
 */
export function tallyAttendance(members, attendance) {
  const counts = { present: 0, absent: 0, excused: 0, unmarked: 0, total: 0 };

  for (const member of members || []) {
    if (!member?.id) continue;
    counts.total += 1;
    const status = statusOf(attendance, member.id);
    if (status) counts[status] += 1;
    else counts.unmarked += 1;
  }

  return counts;
}

/**
 * The map that actually gets saved: everybody the admin did not mark is recorded present.
 *
 * That is the group's own convention -- a register is taken by calling out the absentees --
 * and it is applied here, at the point of saving, rather than by pre-filling the screen.
 * Pre-filling was indistinguishable from a saved all-present register, so a week nobody had
 * touched looked exactly like a week everybody had attended.
 */
export function materialiseRegister(members, attendance) {
  const complete = {};
  for (const member of members || []) {
    if (!member?.id) continue;
    complete[member.id] = statusOf(attendance, member.id) || 'present';
  }
  return complete;
}
