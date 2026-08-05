/**
 * Reading back a week that has already been registered.
 *
 * Everything here guards the same failure: an admin opens a past meeting and is shown a
 * screen full of plausible numbers that belong to a different week, a different cycle, or to
 * no register at all. There is nothing on that screen to check them against, so every one of
 * these is silent when it goes wrong.
 *
 * 2026-01-07 is a Wednesday; the cycle that starts there runs to 2026-12-30, and the next
 * one begins 2027-01-06.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cycleKeyOf,
  findWeekRegister,
  statusOf,
  tallyAttendance,
  materialiseRegister
} from '../../src/utils/attendanceRegisters.js';

const ANCHOR = '2026-01-07';
const NEXT_CYCLE_ANCHOR = '2027-01-06';

const members = [
  { id: 'a', name: 'Aine' },
  { id: 'b', name: 'Bwire' },
  { id: 'c', name: 'Chandia' }
];

/** A stored register, newest-first order being the caller's responsibility. */
const register = (weekNumber, attendanceMap, extra = {}) => ({
  created_at: '2026-02-01T09:00:00Z',
  metadata: {
    group_code: 'PEWOSA-0001',
    week_number: weekNumber,
    attendance_map: attendanceMap,
    cycle_anchor: cycleKeyOf(ANCHOR),
    registered_at: '2026-02-01T09:00:00Z',
    ...extra
  }
});

test('cycleKeyOf normalises every shape the anchor is stored as', () => {
  const expected = '2026-01-07';
  assert.equal(cycleKeyOf(ANCHOR), expected);
  assert.equal(cycleKeyOf('2026-01-07T00:00:00Z'), expected);
  // A Monday anchor snaps forward to the meeting it belongs to, so both spellings of the
  // same cycle produce one key rather than two.
  assert.equal(cycleKeyOf('2026-01-05', 'Wednesday'), expected);
});

test('cycleKeyOf is null for a SACCO that was never onboarded', () => {
  // No anchor means no cycles to tell apart, and the week number is one an admin typed.
  assert.equal(cycleKeyOf(null), null);
  assert.equal(cycleKeyOf(undefined), null);
});

test('findWeekRegister returns the register for the week asked for', () => {
  const records = [
    register(4, { a: 'present', b: 'absent' }),
    register(3, { a: 'absent', b: 'present' })
  ];

  const found = findWeekRegister(records, {
    groupCode: 'PEWOSA-0001',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.deepEqual(found.attendance, { a: 'absent', b: 'present' });
});

test('findWeekRegister returns null for a meeting nobody recorded', () => {
  // The distinction this whole screen rests on: no register is not an empty register, and
  // must never be answered with a map the caller could mistake for one.
  const found = findWeekRegister([register(3, { a: 'present' })], {
    groupCode: 'PEWOSA-0001',
    weekNumber: 9,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.equal(found, null);
});

test('findWeekRegister takes the newest register for a corrected week', () => {
  const corrected = register(3, { a: 'excused' });
  corrected.metadata.registered_at = '2026-02-08T09:00:00Z';

  const found = findWeekRegister([corrected, register(3, { a: 'absent' })], {
    groupCode: 'PEWOSA-0001',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.deepEqual(found.attendance, { a: 'excused' });
  assert.equal(found.savedAt, '2026-02-08T09:00:00Z');
});

test('findWeekRegister does not hand one cycle the other cycle Week 3', () => {
  // Both cycles have a Week 3. Without the anchor on the record, the newer one wins and the
  // older meeting is unreachable through the dropdown -- while the screen shows the newer
  // register under the older week's name, with nothing to give it away.
  const thisCycle = register(3, { a: 'present' });
  const nextCycle = register(3, { a: 'absent' }, { cycle_anchor: cycleKeyOf(NEXT_CYCLE_ANCHOR) });

  const found = findWeekRegister([nextCycle, thisCycle], {
    groupCode: 'PEWOSA-0001',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.deepEqual(found.attendance, { a: 'present' });
});

test('findWeekRegister still finds registers saved before cycle keys existed', () => {
  // Which cycle these came from is not recoverable from the row. Hiding them would blank out
  // every register saved before the field was added, which is worse than the collision.
  const legacy = register(3, { a: 'present' });
  delete legacy.metadata.cycle_anchor;

  const found = findWeekRegister([legacy], {
    groupCode: 'PEWOSA-0001',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.deepEqual(found.attendance, { a: 'present' });
});

test('findWeekRegister ignores another group in the same result set', () => {
  const other = register(3, { z: 'absent' }, { group_code: 'BYS-8240' });

  const found = findWeekRegister([other], {
    groupCode: 'PEWOSA-0001',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.equal(found, null);
});

test('findWeekRegister matches a group code regardless of case and padding', () => {
  const found = findWeekRegister([register(3, { a: 'present' })], {
    groupCode: '  pewosa-0001 ',
    weekNumber: 3,
    cycleKey: cycleKeyOf(ANCHOR)
  });

  assert.deepEqual(found.attendance, { a: 'present' });
});

test('statusOf reports an unrecorded member as null, not present', () => {
  const attendance = { a: 'absent' };
  assert.equal(statusOf(attendance, 'a'), 'absent');
  // Joined after this meeting, so appears in no register from before they arrived.
  assert.equal(statusOf(attendance, 'c'), null);
  assert.equal(statusOf({}, 'a'), null);
  // Anything that is not one of the three statuses is not a status.
  assert.equal(statusOf({ a: 'maybe' }, 'a'), null);
});

test('tallyAttendance counts the member list, not the stored map', () => {
  // 'gone' left the SACCO but is still in the old map; 'c' joined after and is in no map.
  const attendance = { a: 'present', b: 'absent', gone: 'absent' };
  const counts = tallyAttendance(members, attendance);

  assert.deepEqual(counts, { present: 1, absent: 1, excused: 0, unmarked: 1, total: 3 });
});

test('tallyAttendance over a blank sheet marks everybody unaccounted for', () => {
  assert.deepEqual(
    tallyAttendance(members, {}),
    { present: 0, absent: 0, excused: 0, unmarked: 3, total: 3 }
  );
});

test('materialiseRegister saves the unmarked as present and drops departed members', () => {
  const saved = materialiseRegister(members, { b: 'absent', gone: 'absent' });

  assert.deepEqual(saved, { a: 'present', b: 'absent', c: 'present' });
  // The stored map describes the members the SACCO has, so a fine cannot be levied against
  // somebody who is no longer one.
  assert.equal('gone' in saved, false);
});

test('a saved register tallies to the whole membership', () => {
  const saved = materialiseRegister(members, { b: 'absent' });
  const counts = tallyAttendance(members, saved);

  assert.equal(counts.unmarked, 0);
  assert.equal(counts.present + counts.absent + counts.excused, counts.total);
});
