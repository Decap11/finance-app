/**
 * The date arithmetic every other number in this app is built on.
 *
 * Worth testing ahead of the things that consume it: an off-by-one week here becomes a week
 * of arrears a member is told they owe, a register saved against the wrong meeting, and a
 * transaction filed under the wrong week number -- all three at once, and all silently.
 *
 * Dates are chosen from a real calendar rather than generated: 2026-01-07 is a Wednesday,
 * 2026-01-05 a Monday, 2026-01-11 a Sunday.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrdinal,
  getForthcomingMeetingDate,
  getMeetingDayOnOrAfter,
  getSaccoWeekOf,
  getActiveWeek,
  formatTransactionMeetingDate,
  WEEKS_PER_CYCLE
} from '../../src/utils/meetingDateUtils.js';

const iso = (d) => d.toISOString().slice(0, 10);

test('getOrdinal covers the teens exception', () => {
  assert.equal(getOrdinal(1), 'st');
  assert.equal(getOrdinal(2), 'nd');
  assert.equal(getOrdinal(3), 'rd');
  assert.equal(getOrdinal(4), 'th');
  // 11th/12th/13th, not 11st/12nd/13rd.
  assert.equal(getOrdinal(11), 'th');
  assert.equal(getOrdinal(12), 'th');
  assert.equal(getOrdinal(13), 'th');
  assert.equal(getOrdinal(21), 'st');
  assert.equal(getOrdinal(22), 'nd');
  assert.equal(getOrdinal(23), 'rd');
});

test('getMeetingDayOnOrAfter leaves a date already on the meeting day alone', () => {
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-07', 'Wednesday')), '2026-01-07');
});

test('getMeetingDayOnOrAfter snaps forward, never back', () => {
  // Monday and Sunday both belong to the Wednesday that follows them.
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05', 'Wednesday')), '2026-01-07');
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-11', 'Wednesday')), '2026-01-14');
  // The day after the meeting waits a full week for the next one.
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-08', 'Wednesday')), '2026-01-14');
});

test('getMeetingDayOnOrAfter accepts every shape a date is stored as', () => {
  const expected = '2026-01-07';
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05', 'Wednesday')), expected);
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05T14:30:00Z', 'Wednesday')), expected);
  assert.equal(iso(getMeetingDayOnOrAfter(new Date(2026, 0, 5), 'Wednesday')), expected);
});

test('getMeetingDayOnOrAfter is case- and whitespace-insensitive, and defaults to Wednesday', () => {
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05', '  wednesday ')), '2026-01-07');
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05', 'MONDAY')), '2026-01-05');
  // An unrecognised day falls back to Wednesday rather than producing NaN.
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05', 'Notaday')), '2026-01-07');
  assert.equal(iso(getMeetingDayOnOrAfter('2026-01-05')), '2026-01-07');
});

test('getMeetingDayOnOrAfter returns null for nothing and for nonsense', () => {
  assert.equal(getMeetingDayOnOrAfter(null, 'Wednesday'), null);
  assert.equal(getMeetingDayOnOrAfter('', 'Wednesday'), null);
  assert.equal(getMeetingDayOnOrAfter('not a date', 'Wednesday'), null);
  assert.equal(getMeetingDayOnOrAfter(new Date('nope'), 'Wednesday'), null);
});

test('snapped dates are always an exact multiple of seven days apart', () => {
  // The property the whole week count rests on. Every day of one week must land on the same
  // meeting date, so any two snapped dates differ by whole weeks.
  const days = ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
                '2026-03-09', '2026-03-10', '2026-03-11'];
  const snapped = days.map((d) => getMeetingDayOnOrAfter(d, 'Wednesday').getTime());
  assert.equal(new Set(snapped).size, 1, 'one week of dates should snap to one meeting');

  const base = getMeetingDayOnOrAfter('2026-01-07', 'Wednesday').getTime();
  for (const d of ['2026-02-04', '2026-06-17', '2026-11-11', '2027-01-06']) {
    const diff = getMeetingDayOnOrAfter(d, 'Wednesday').getTime() - base;
    assert.equal(diff % (7 * 86400000), 0, `${d} should be a whole number of weeks from the anchor`);
  }
});

test('the week count survives a daylight-saving boundary', () => {
  // The reason toUTCDay exists. Northern-hemisphere DST shifts on 2026-03-29 and 2026-10-25;
  // counting in local time loses an hour across each and rounds a week short.
  const before = getMeetingDayOnOrAfter('2026-03-25', 'Wednesday'); // 25 Mar, a Wednesday
  const after = getMeetingDayOnOrAfter('2026-04-01', 'Wednesday');  // 1 Apr, the next one
  assert.equal((after - before) / 86400000, 7);

  const autumnBefore = getMeetingDayOnOrAfter('2026-10-21', 'Wednesday');
  const autumnAfter = getMeetingDayOnOrAfter('2026-10-28', 'Wednesday');
  assert.equal((autumnAfter - autumnBefore) / 86400000, 7);
});

test('getSaccoWeekOf counts from the anchor, one-based', () => {
  const anchor = '2026-01-07';
  assert.equal(getSaccoWeekOf('2026-01-07', anchor, 'Wednesday'), 1, 'the anchor itself is week 1');
  assert.equal(getSaccoWeekOf('2026-01-14', anchor, 'Wednesday'), 2);
  assert.equal(getSaccoWeekOf('2026-02-04', anchor, 'Wednesday'), 5);
});

test('getSaccoWeekOf gives a date mid-week the week its meeting falls in', () => {
  const anchor = '2026-01-07';
  // Thursday the 8th is already past that week's meeting, so it belongs to week 2.
  assert.equal(getSaccoWeekOf('2026-01-08', anchor, 'Wednesday'), 2);
  assert.equal(getSaccoWeekOf('2026-01-13', anchor, 'Wednesday'), 2);
});

test('getSaccoWeekOf wraps into the next cycle rather than exceeding 52', () => {
  const anchor = '2026-01-07';
  const week52 = new Date(Date.UTC(2026, 0, 7) + 51 * 7 * 86400000);
  const week53 = new Date(Date.UTC(2026, 0, 7) + 52 * 7 * 86400000);
  assert.equal(getSaccoWeekOf(week52, anchor, 'Wednesday'), WEEKS_PER_CYCLE);
  assert.equal(getSaccoWeekOf(week53, anchor, 'Wednesday'), 1, 'week 53 is week 1 of the next cycle');
});

test('getSaccoWeekOf gives dates BEFORE the anchor a true 1-52 position', () => {
  // Documented behaviour: an earlier cycle, not a negative or zero week. This is why the
  // modulo is taken twice.
  const anchor = '2026-01-07';
  assert.equal(getSaccoWeekOf('2025-12-31', anchor, 'Wednesday'), WEEKS_PER_CYCLE);
  const oneCycleBack = new Date(Date.UTC(2026, 0, 7) - 52 * 7 * 86400000);
  assert.equal(getSaccoWeekOf(oneCycleBack, anchor, 'Wednesday'), 1);
});

test('getSaccoWeekOf returns null without an anchor', () => {
  assert.equal(getSaccoWeekOf('2026-01-07', null, 'Wednesday'), null);
  assert.equal(getSaccoWeekOf(null, '2026-01-07', 'Wednesday'), null);
});

test('getActiveWeek advances by itself as the weeks pass', () => {
  const anchor = '2026-01-07';
  assert.equal(getActiveWeek(anchor, 'Wednesday', '2026-01-07'), 1);
  assert.equal(getActiveWeek(anchor, 'Wednesday', '2026-01-14'), 2);
  assert.equal(getActiveWeek(anchor, 'Wednesday', '2026-02-04'), 5);
});

test('getActiveWeek treats the days between meetings as the coming week', () => {
  // The stored current_week column is a cache and goes stale here; the derived value must
  // not. Thursday is already working towards the next meeting.
  const anchor = '2026-01-07';
  assert.equal(getActiveWeek(anchor, 'Wednesday', '2026-01-08'), 2);
  assert.equal(getActiveWeek(anchor, 'Wednesday', '2026-01-13'), 2);
});

test('getActiveWeek clamps to the cycle in both directions', () => {
  const anchor = '2026-01-07';
  const wayLater = new Date(Date.UTC(2026, 0, 7) + 80 * 7 * 86400000);
  assert.equal(getActiveWeek(anchor, 'Wednesday', wayLater), WEEKS_PER_CYCLE);
  // A SACCO whose anchor is in the future is still on week 1, not week zero or negative.
  assert.equal(getActiveWeek('2027-01-06', 'Wednesday', '2026-01-07'), 1);
});

test('getActiveWeek returns null with no anchor, so callers fall back to the typed week', () => {
  assert.equal(getActiveWeek(null, 'Wednesday', '2026-02-04'), null);
  assert.equal(getActiveWeek('', 'Wednesday', '2026-02-04'), null);
});

test('getForthcomingMeetingDate agrees with the UTC twin on plain dates', () => {
  // Two implementations of the same idea live in this file -- one local-time, one UTC. They
  // must not disagree about which meeting a date belongs to.
  for (const d of ['2026-01-05', '2026-01-07', '2026-01-08', '2026-06-17']) {
    const local = getForthcomingMeetingDate(d, 'Wednesday');
    const utc = getMeetingDayOnOrAfter(d, 'Wednesday');
    assert.equal(
      `${local.getFullYear()}-${local.getMonth()}-${local.getDate()}`,
      `${utc.getUTCFullYear()}-${utc.getUTCMonth()}-${utc.getUTCDate()}`,
      `disagreement on ${d}`
    );
  }
});

test('formatTransactionMeetingDate prefers the stored week number', () => {
  const out = formatTransactionMeetingDate(
    { created_at: '2026-01-05', week_number: 9 }, 'Wednesday', 1
  );
  assert.match(out, /week 9$/);
  assert.match(out, /^7th Jan/);
});

test('formatTransactionMeetingDate falls back to the week in the description, then the default', () => {
  assert.match(
    formatTransactionMeetingDate(
      { created_at: '2026-01-05', description: 'Contribution request: Social Fund | Week 12' },
      'Wednesday', 1
    ),
    /week 12$/
  );
  assert.match(
    formatTransactionMeetingDate({ created_at: '2026-01-05' }, 'Wednesday', 4),
    /week 4$/
  );
});

test('formatTransactionMeetingDate dates a row by when the money landed', () => {
  // completed_at outranks created_at: a contribution submitted on Monday and approved on
  // Thursday belongs to the meeting after, not the one before.
  const out = formatTransactionMeetingDate(
    { created_at: '2026-01-05', completed_at: '2026-01-08', week_number: 2 },
    'Wednesday', 1
  );
  assert.match(out, /^14th Jan/);
});

test('formatTransactionMeetingDate returns empty for nothing', () => {
  assert.equal(formatTransactionMeetingDate(null, 'Wednesday'), '');
});
