import { describe, expect, it } from 'vitest';
import {
  changedCells,
  contractHours,
  dayHours,
  formatHours,
  isChanged,
  nextSundayTurn,
  parseTime,
  pauseMinutes,
  productionStaffing,
  scheduleWarnings,
  weekDates,
  weekHours,
  weekStartOf,
  withTyped,
  workedHours,
  type Block,
  type KindRule,
} from './schedule';

const kinds = new Map<string, KindRule>([
  ['office', { id: 'office', counts_hours: true }],
  ['free', { id: 'free', counts_hours: false }],
]);
const block = (person_id: string, day: number, slot: number, start_time: string | null, end_time: string | null, kind_id: string | null = null): Block => ({
  person_id, day, slot, start_time, end_time, kind_id,
});

describe('hours', () => {
  // Freddy, week of 11.10.2026, as on the sheet: 44.00.
  const freddy = [
    block('f', 1, 1, '06:30', '08:30'), block('f', 1, 2, '08:30', '15:30', 'office'),
    block('f', 2, 1, '06:30', '08:30'), block('f', 2, 2, '08:30', '15:30', 'office'),
    block('f', 3, 1, '06:30', '08:30'), block('f', 3, 2, '08:30', '14:30', 'office'),
    block('f', 4, 1, '08:00', '15:30', 'office'), block('f', 4, 2, '15:00', '16:30'),
    block('f', 5, 1, '06:30', '15:30'),
  ];

  it('adds both blocks of a day', () => {
    expect(dayHours(freddy, 'f', 1, kinds)).toBe(9);
  });

  it('totals the week as the sheet did, pauses included', () => {
    expect(formatHours(weekHours(freddy, 'f', kinds))).toBe('44.00');
  });

  it('takes the pause of each day off for the hours worked', () => {
    // 9 + 9 + 8 + 9 + 9 planned; half an hour of pause on each of the five days.
    expect(workedHours(freddy, 'f', kinds)).toBe(41.5);
  });

  it('does not count a day off, with or without times', () => {
    const off = [block('p', 5, 1, null, null, 'free'), block('p', 6, 1, '08:00', '12:00', 'free')];
    expect(weekHours(off, 'p', kinds)).toBe(0);
  });
});

describe('pause', () => {
  it('follows the day, at the limits the law gives', () => {
    expect(pauseMinutes(5.5)).toBe(0);
    expect(pauseMinutes(5.75)).toBe(15);
    expect(pauseMinutes(7)).toBe(15);
    expect(pauseMinutes(7.5)).toBe(30);
    expect(pauseMinutes(9)).toBe(30);
    expect(pauseMinutes(9.5)).toBe(60);
  });
});

describe('warnings', () => {
  const people = [
    { id: 'lead', min_hours: null, max_hours: 45, is_lead: true },
    { id: 'patty', min_hours: 31, max_hours: null, is_lead: false },
  ];

  it('warns under the minimum and over the maximum, but not for an empty row', () => {
    const blocks = [
      ...[1, 2, 3, 4, 5].map((d) => block('lead', d, 1, '06:00', '16:00')), // 50 h planned, 45 worked
      block('lead', 6, 1, '06:00', '11:00'), // and five more
      block('patty', 1, 1, '08:00', '16:00'), // 8 h planned, 7.5 worked
    ];
    const w = scheduleWarnings(blocks, people, kinds);
    expect(w).toContainEqual({ kind: 'over', person_id: 'lead', hours: 50, bound: 45 });
    expect(w).toContainEqual({ kind: 'under', person_id: 'patty', hours: 7.5, bound: 31 });
    expect(scheduleWarnings(blocks.filter((b) => b.person_id === 'lead'), people, kinds).some((x) => x.kind === 'under')).toBe(false);
  });

  it('warns on a day of production without a lead', () => {
    const w = scheduleWarnings([block('patty', 2, 1, '10:00', '12:00')], people, kinds);
    expect(w).toContainEqual({ kind: 'no_lead', day: 2 });
  });

  it('asks for no lead on a Sunday of cooking and maintenance', () => {
    const w = scheduleWarnings([block('patty', 0, 1, '10:00', '12:00', 'office')], people, kinds);
    expect(w.some((x) => x.kind === 'no_lead')).toBe(false);
  });

  it('warns on hours during a day off or an approved absence', () => {
    const blocks = [block('lead', 2, 1, '08:00', '12:00'), block('lead', 2, 2, null, null, 'free'), block('lead', 3, 1, '08:00', '12:00')];
    const w = scheduleWarnings(blocks, people, kinds, new Map([['lead', new Set([3])]]));
    expect(w).toContainEqual({ kind: 'day_off', person_id: 'lead', day: 2 });
    expect(w).toContainEqual({ kind: 'absence', person_id: 'lead', day: 3 });
  });
});

describe('what is typed into the sheet', () => {
  it('reads a time however it is typed', () => {
    expect(parseTime('0630')).toBe('06:30');
    expect(parseTime('630')).toBe('06:30');
    expect(parseTime('6:30')).toBe('06:30');
    expect(parseTime('6.30')).toBe('06:30');
    expect(parseTime('17')).toBe('17:00');
    expect(parseTime('1730')).toBe('17:30');
    expect(parseTime(' ')).toBe('');
  });

  it('refuses what is not a time', () => {
    expect(parseTime('2530')).toBeNull();
    expect(parseTime('1275')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});

describe('people in production', () => {
  // Monday 12.10.2026, a day of Chip (6.5 people), as on the sheet.
  const monday = [
    block('freddy', 1, 1, '06:30', '08:30'), block('freddy', 1, 2, '08:30', '15:30', 'office'),
    block('rafael', 1, 1, '07:00', '16:30'), block('patty', 1, 1, '07:30', '15:30'), block('marco', 1, 1, '07:30', '17:00'),
    block('jefferson', 1, 1, '07:30', '15:30', 'office'), block('bruce', 1, 1, '08:00', '17:00'), block('gabriel', 1, 1, '08:30', '15:30'),
    block('jorge', 1, 1, '06:30', '17:00'), block('coople', 1, 1, '11:30', '14:00'),
  ];
  const products = [{ id: 'chip', people_needed: 6.5 }, { id: 'azul', people_needed: 6 }, { id: 'bio', people_needed: null }];

  it('counts each person by their production hours against a full day', () => {
    const day = productionStaffing(monday, { '1': ['chip'] }, products)[1];
    expect(day).toEqual({ day: 1, count: 6.3, need: 6.5, short: true });
  });

  it('takes the product that needs most, and none when there is no figure', () => {
    expect(productionStaffing(monday, { '1': ['azul', 'chip'] }, products)[1].need).toBe(6.5);
    expect(productionStaffing(monday, { '1': ['azul'] }, products)[1].short).toBe(false);
    expect(productionStaffing(monday, { '1': ['bio'] }, products)[1]).toMatchObject({ need: null, short: false });
    expect(productionStaffing(monday, {}, products)[0]).toEqual({ day: 0, count: 0, need: null, short: false });
  });
});

describe('typing over the saved week', () => {
  const saved = [block('a', 1, 1, '07:00', '15:00', 'office'), block('a', 2, 1, null, null, 'free'), block('a', 3, 1, '08:00', '12:00')];

  it('changes a block once both times are there, and keeps its kind', () => {
    const out = withTyped(saved, { 'a:1:1': { start: '07:30', end: '15:00' } }, kinds);
    expect(out).toContainEqual(block('a', 1, 1, '07:30', '15:00', 'office'));
    expect(out).toHaveLength(3);
  });

  it('adds a production block in an empty slot', () => {
    expect(withTyped(saved, { 'a:1:2': { start: '15:00', end: '17:00' } }, kinds)).toContainEqual(block('a', 1, 2, '15:00', '17:00'));
  });

  it('waits while a slot has one time, or the two out of order', () => {
    expect(withTyped(saved, { 'a:4:1': { start: '07:00', end: '' } }, kinds)).toEqual(saved);
    expect(withTyped(saved, { 'a:3:1': { start: '13:00', end: '12:00' } }, kinds)).toEqual(saved);
  });

  it('removes an emptied block, but leaves a day off as the whole day', () => {
    expect(withTyped(saved, { 'a:3:1': { start: '', end: '' } }, kinds)).toHaveLength(2);
    expect(withTyped(saved, { 'a:2:1': { start: '', end: '' } }, kinds)).toContainEqual(block('a', 2, 1, null, null, 'free'));
  });
});

describe('the contract', () => {
  it('is a share of 42 hours worked', () => {
    expect(contractHours(100)).toBe(42);
    expect(contractHours(70)).toBe(29.4);
    expect(contractHours(60)).toBe(25.2);
    expect(contractHours(null)).toBeNull();
  });
});

describe('changes after a version', () => {
  it('marks the cells that differ, an emptied one included', () => {
    const v1 = [block('a', 1, 1, '07:00', '15:00'), block('a', 2, 1, '07:00', '15:00'), block('b', 1, 1, '08:00', '12:00')];
    const now = [block('a', 1, 1, '07:00', '15:00'), block('a', 2, 1, '07:30', '15:00'), block('b', 3, 1, '08:00', '12:00')];
    const changed = changedCells(v1, now);
    expect(isChanged(changed, 'a', 1)).toBe(false);
    expect(isChanged(changed, 'a', 2)).toBe(true);
    expect(isChanged(changed, 'b', 1)).toBe(true);
    expect(isChanged(changed, 'b', 3)).toBe(true);
  });

  it('does not mind seconds on a time', () => {
    expect(changedCells([block('a', 1, 1, '07:00:00', '15:00:00')], [block('a', 1, 1, '07:00', '15:00')]).size).toBe(0);
  });
});

describe('Sundays', () => {
  const members = [{ id: 'patty', sunday_order: 1 }, { id: 'jorge', sunday_order: 2 }, { id: 'freddy', sunday_order: 3 }];

  it('gives the turn to whoever came longest ago, then by the order', () => {
    expect(nextSundayTurn(members, [])).toBe('patty');
    expect(nextSundayTurn(members, [{ person_id: 'patty', duty_date: '2026-10-11' }])).toBe('jorge');
    expect(nextSundayTurn(members, [
      { person_id: 'patty', duty_date: '2026-10-11' },
      { person_id: 'jorge', duty_date: '2026-10-18' },
      { person_id: 'freddy', duty_date: '2026-10-04' },
    ])).toBe('freddy');
  });

  it('finds the week of a date', () => {
    expect(weekStartOf('2026-10-14')).toBe('2026-10-11');
    expect(weekStartOf('2026-10-11')).toBe('2026-10-11');
    expect(weekDates('2026-10-11')[6]).toBe('2026-10-17');
  });
});
