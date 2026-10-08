import { describe, expect, it } from 'vitest';
import {
  arrivalVerdict,
  buildExpectedReport,
  differenceText,
  dueDate,
  expectedNoticesDue,
  groupExpected,
  hasDifference,
  isLate,
  mondayOf,
  nextWorkingDay,
  type ExpectedStatus,
  type NoticeCandidate,
  type ReportExpected,
} from './expected';

// 2026-10-08 is a Thursday; the week runs Mon 05 – Fri 09.
const TODAY = '2026-10-08';

const entry = (id: string, when: { day?: string; week?: string }, status: ExpectedStatus = 'expected') => ({
  id,
  status,
  expected_date: when.day ?? null,
  expected_week: when.week ?? null,
  due_date: dueDate({ expected_date: when.day ?? null, expected_week: when.week ?? null }),
});

describe('days and weeks', () => {
  it('finds the Monday of any day', () => {
    expect(mondayOf('2026-10-08')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  });

  it('a week is due on its Friday, a day on itself', () => {
    expect(dueDate({ expected_date: '2026-10-08', expected_week: null })).toBe('2026-10-08');
    expect(dueDate({ expected_date: null, expected_week: '2026-10-05' })).toBe('2026-10-09');
  });

  it('is late only once its day — or its whole week — has passed', () => {
    expect(isLate(entry('a', { day: '2026-10-07' }), TODAY)).toBe(true);
    expect(isLate(entry('b', { day: TODAY }), TODAY)).toBe(false);
    expect(isLate(entry('c', { week: '2026-10-05' }), TODAY)).toBe(false);
    expect(isLate(entry('c', { week: '2026-10-05' }), '2026-10-10')).toBe(true);
    expect(isLate(entry('d', { day: '2026-10-01' }, 'arrived'), TODAY)).toBe(false);
  });

  it('skips the weekend to the next working day', () => {
    expect(nextWorkingDay('2026-10-08')).toBe('2026-10-09');
    expect(nextWorkingDay('2026-10-09')).toBe('2026-10-12');
    expect(nextWorkingDay('2026-10-10')).toBe('2026-10-12');
  });
});

describe('groupExpected', () => {
  it('orders what did not arrive, today, tomorrow, then days and weeks ahead', () => {
    const sections = groupExpected(
      [
        entry('week-next', { week: '2026-10-12' }),
        entry('later', { day: '2026-10-14' }),
        entry('tomorrow', { day: '2026-10-09' }),
        entry('late', { day: '2026-10-06' }),
        entry('today', { day: TODAY }),
        entry('monday', { day: '2026-10-12' }),
        entry('week-now', { week: '2026-10-05' }),
        entry('gone', { day: '2026-10-07' }, 'arrived'),
      ],
      TODAY,
    );
    expect(sections.map((s) => [s.kind, s.items.map((i) => i.id)])).toEqual([
      ['late', ['late']],
      ['today', ['today']],
      ['tomorrow', ['tomorrow']],
      ['week', ['week-now']],
      ['day', ['monday']],
      ['week', ['week-next']],
      ['day', ['later']],
    ]);
  });
});

describe('on arrival', () => {
  const lines = [
    { name: 'Maíz amarillo', quantity: '7.000', received_quantity: '6.000' },
    { name: 'Maíz blanco', quantity: '9.000', received_quantity: '9.000' },
    { name: 'Maíz azul', quantity: 1, received_quantity: null },
  ];

  it('a line nobody counted is not a difference', () => {
    expect(hasDifference(lines)).toBe(true);
    expect(hasDifference(lines.slice(1))).toBe(false);
  });

  it('writes one line per difference', () => {
    expect(differenceText(lines, (l, expected, received) => `${l.name}: ${expected} / ${received}`)).toBe('Maíz amarillo: 7 / 6');
  });

  it('judges the arrival day against the day or the week', () => {
    const day = { expected_date: '2026-10-08', expected_week: null };
    const week = { expected_date: null, expected_week: '2026-10-05' };
    expect(arrivalVerdict(day, '2026-10-08')).toEqual({ verdict: 'on_time', days: 0 });
    expect(arrivalVerdict(day, '2026-10-06')).toEqual({ verdict: 'early', days: 2 });
    expect(arrivalVerdict(day, '2026-10-12')).toEqual({ verdict: 'late', days: 4 });
    expect(arrivalVerdict(week, '2026-10-07')).toEqual({ verdict: 'on_time', days: 0 });
    expect(arrivalVerdict(week, '2026-10-12')).toEqual({ verdict: 'late', days: 3 });
  });
});

describe('expectedNoticesDue', () => {
  const list: NoticeCandidate[] = [
    entry('today', { day: TODAY }),
    entry('tomorrow', { day: '2026-10-09' }),
    entry('monday', { day: '2026-10-12' }),
    entry('late', { day: '2026-10-06' }),
    entry('week', { week: '2026-10-12' }),
    entry('cancelled', { day: TODAY }, 'cancelled'),
  ];
  const at = (today: string, clock: string) => expectedNoticesDue(list, { today, clock }).map((n) => `${n.kind}:${n.deliveryId}`);

  it('tells the receivers in the morning of the day', () => {
    expect(at(TODAY, '06:45')).toEqual(['morning:today']);
  });

  it('tells whoever entered it once the working day after has started', () => {
    expect(at(TODAY, '08:05')).toEqual(['morning:today', 'late:late']);
  });

  it('announces tomorrow in the afternoon, and not the morning again', () => {
    expect(at(TODAY, '15:10')).toEqual(['eve:tomorrow', 'late:late']);
  });

  it('announces Monday on Friday afternoon', () => {
    expect(at('2026-10-09', '15:10')).toContain('eve:monday');
    expect(at('2026-10-08', '15:10')).not.toContain('eve:monday');
  });

  it('announces a week without a day on its Monday morning', () => {
    expect(at('2026-10-12', '07:00')).toContain('week:week');
    expect(at('2026-10-13', '07:00')).not.toContain('week:week');
  });

  it('keeps what is late for Monday when the day after is a weekend', () => {
    expect(at('2026-10-10', '09:00')).not.toContain('late:late');
    expect(at('2026-10-12', '09:00')).toContain('late:late');
  });
});

describe('buildExpectedReport', () => {
  const row = (id: string, supplier: string, over: Partial<ReportExpected>): ReportExpected => ({
    id,
    supplier_id: supplier,
    supplier_name: supplier,
    status: 'expected',
    expected_date: '2026-10-06',
    expected_week: null,
    due_date: '2026-10-06',
    moved_count: 0,
    arrived_on: null,
    reception_id: null,
    reception_number: null,
    ...over,
  });

  it('counts per supplier and lists what came late or never came', () => {
    const report = buildExpectedReport(
      [
        row('1', 'Rovey', { status: 'arrived', arrived_on: '2026-10-06', reception_id: 'r1', reception_number: 'GR-1' }),
        row('2', 'Rovey', { status: 'arrived', arrived_on: '2026-10-08', reception_id: 'r2', reception_number: 'GR-2', moved_count: 1 }),
        row('3', 'Rovey', {}),
        row('4', 'El Sol', { status: 'cancelled' }),
        row('5', 'El Sol', { expected_date: '2026-10-20', due_date: '2026-10-20' }),
      ],
      TODAY,
    );
    expect(report.summary).toEqual({ expected: 4, onTime: 1, early: 0, late: 1, notArrived: 1, pending: 1, cancelled: 1, moved: 1 });
    expect(report.suppliers.map((s) => [s.name, s.expected, s.late, s.notArrived, s.cancelled])).toEqual([
      ['Rovey', 3, 1, 1, 0],
      ['El Sol', 1, 0, 0, 1],
    ]);
    expect(report.lateArrivals.map((l) => [l.id, l.days])).toEqual([['2', 2], ['3', null]]);
  });
});
