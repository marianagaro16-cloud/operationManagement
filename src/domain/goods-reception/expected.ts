import { addDays, daysBetween, type BusinessDate } from '@/lib/datetime';

/**
 * Expected deliveries: what the office announced is coming.
 *
 * Pure, like the rest of `domain/goods-reception`: which entries are late,
 * how the list is laid out, what differs on arrival, which notices are due
 * and what the report says. Mirrors
 * 20270103090000_expected_deliveries.sql; the database is the boundary.
 */

export const EXPECTED_STATUSES = ['expected', 'arrived', 'cancelled'] as const;
export type ExpectedStatus = (typeof EXPECTED_STATUSES)[number];

export const STORAGE_TYPES = ['dry', 'refrigerated', 'frozen'] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

export const LINE_UNITS = ['units', 'boxes', 'kg', 'pallets', 'bags', 'liters'] as const;
export type LineUnit = (typeof LINE_UNITS)[number];

/** The Monday of a date's week. */
export function mondayOf(date: BusinessDate): BusinessDate {
  // 2024-01-01 was a Monday.
  const offset = ((daysBetween('2024-01-01', date) % 7) + 7) % 7;
  return addDays(date, -offset);
}

/** The last day an entry can arrive on time: its day, or the Friday of its week. */
export function dueDate(d: { expected_date: string | null; expected_week: string | null }): BusinessDate {
  return d.expected_date ?? addDays(d.expected_week!, 4);
}

/** Still expected once its day — or its whole week — has passed. */
export function isLate(d: { status: ExpectedStatus; due_date: string }, today: BusinessDate): boolean {
  return d.status === 'expected' && d.due_date < today;
}

/* ------------------------------- the list ------------------------------- */

export type ExpectedSectionKind = 'late' | 'today' | 'tomorrow' | 'day' | 'week';

export interface ExpectedSection<T> {
  key: string;
  kind: ExpectedSectionKind;
  /** The day, or the Monday of a week without a day; null for what is late. */
  date: BusinessDate | null;
  items: T[];
}

type Datable = { status: ExpectedStatus; expected_date: string | null; expected_week: string | null; due_date: string };

/**
 * The open entries as the floor reads them: what did not arrive, today,
 * tomorrow, then each day ahead — a week without a day standing at its Monday.
 */
export function groupExpected<T extends Datable>(deliveries: T[], today: BusinessDate): ExpectedSection<T>[] {
  const tomorrow = addDays(today, 1);
  const sections = new Map<string, ExpectedSection<T>>();
  const put = (key: string, kind: ExpectedSectionKind, date: BusinessDate | null, item: T) => {
    const section = sections.get(key) ?? { key, kind, date, items: [] };
    section.items.push(item);
    sections.set(key, section);
  };

  for (const d of deliveries.filter((x) => x.status === 'expected')) {
    if (isLate(d, today)) put('late', 'late', null, d);
    else if (d.expected_date === today) put('today', 'today', today, d);
    else if (d.expected_date === tomorrow) put('tomorrow', 'tomorrow', tomorrow, d);
    else if (d.expected_date) put(`day-${d.expected_date}`, 'day', d.expected_date, d);
    else put(`week-${d.expected_week}`, 'week', d.expected_week, d);
  }

  const rank: Record<ExpectedSectionKind, number> = { late: 0, today: 1, tomorrow: 2, day: 3, week: 3 };
  return [...sections.values()]
    .map((s) => ({ ...s, items: [...s.items].sort((a, b) => a.due_date.localeCompare(b.due_date)) }))
    .sort((a, b) =>
      rank[a.kind] !== rank[b.kind]
        ? rank[a.kind] - rank[b.kind]
        : (a.date ?? '') !== (b.date ?? '')
          ? (a.date ?? '').localeCompare(b.date ?? '')
          : a.kind === 'day' ? -1 : 1,
    );
}

/* ------------------------------ on arrival ------------------------------ */

export interface ComparedLine {
  quantity: number | string;
  received_quantity: number | string | null;
}

/** Counted and not what was announced. A line nobody counted is not a difference. */
export function lineDiffers(line: ComparedLine): boolean {
  return line.received_quantity !== null && Number(line.received_quantity) !== Number(line.quantity);
}

export function hasDifference(lines: ComparedLine[]): boolean {
  return lines.some(lineDiffers);
}

/** A quantity without trailing zeros: 7, 12.5. */
export function formatQuantity(value: number | string): string {
  return String(Number(value));
}

/**
 * The difference, written for an incident: one line per product.
 * `phrase` builds the sentence so this stays free of i18n.
 */
export function differenceText<T extends ComparedLine>(
  lines: T[],
  phrase: (line: T, expected: string, received: string) => string,
): string {
  return lines
    .filter(lineDiffers)
    .map((l) => phrase(l, formatQuantity(l.quantity), formatQuantity(l.received_quantity!)))
    .join('\n');
}

export type ArrivalVerdict = 'on_time' | 'early' | 'late';

/** How the arrival day compares with what was announced; a week is on time on any of its days. */
export function arrivalVerdict(
  d: { expected_date: string | null; expected_week: string | null },
  arrivedOn: BusinessDate,
): { verdict: ArrivalVerdict; days: number } {
  const first = d.expected_date ?? d.expected_week!;
  const last = dueDate(d);
  if (arrivedOn < first) return { verdict: 'early', days: daysBetween(arrivedOn, first) };
  if (arrivedOn > last) return { verdict: 'late', days: daysBetween(last, arrivedOn) };
  return { verdict: 'on_time', days: 0 };
}

/* -------------------------------- notices ------------------------------- */

export type ExpectedNoticeKind = 'eve' | 'morning' | 'week' | 'late';

export interface NoticeCandidate {
  id: string;
  status: ExpectedStatus;
  expected_date: string | null;
  expected_week: string | null;
  due_date: string;
}

export interface DueNotice {
  deliveryId: string;
  kind: ExpectedNoticeKind;
  /** The day the notice is about: the ledger key with the delivery and the kind. */
  noticeDate: BusinessDate;
}

/** To the receivers, the afternoon before. */
export const EVE_FROM = '15:00';
/** To the receivers, at the start of the day — and on Monday for a week without a day. */
export const MORNING_FROM = '06:30';
export const MORNING_UNTIL = '12:00';
/** To whoever entered it, the working day after it did not arrive. */
export const LATE_FROM = '08:00';

/** The next Monday-to-Friday day after `date`. */
export function nextWorkingDay(date: BusinessDate): BusinessDate {
  let next = addDays(date, 1);
  while (daysBetween(mondayOf(next), next) > 4) next = addDays(next, 1);
  return next;
}

/**
 * The notices due at this moment. Each is sent once: the caller claims
 * (delivery, kind, noticeDate) before sending.
 *
 * The eve of a Monday delivery is Friday afternoon, not Sunday; a weekend
 * delivery is announced on Friday too.
 */
export function expectedNoticesDue(
  deliveries: NoticeCandidate[],
  now: { today: BusinessDate; clock: string },
): DueNotice[] {
  const { today, clock } = now;
  const weekday = daysBetween(mondayOf(today), today) + 1;
  const working = weekday <= 5;
  const morning = clock >= MORNING_FROM && clock < MORNING_UNTIL;
  const until = nextWorkingDay(today);
  const due: DueNotice[] = [];

  for (const d of deliveries) {
    if (d.status !== 'expected') continue;
    if (d.expected_date) {
      if (clock >= EVE_FROM && d.expected_date > today && d.expected_date <= until) {
        due.push({ deliveryId: d.id, kind: 'eve', noticeDate: d.expected_date });
      }
      if (morning && d.expected_date === today) {
        due.push({ deliveryId: d.id, kind: 'morning', noticeDate: today });
      }
    } else if (morning && d.expected_week === today) {
      due.push({ deliveryId: d.id, kind: 'week', noticeDate: today });
    }
    if (working && clock >= LATE_FROM && d.due_date < today) {
      due.push({ deliveryId: d.id, kind: 'late', noticeDate: d.due_date });
    }
  }
  return due;
}

/* -------------------------------- report -------------------------------- */

/** One expected delivery whose day falls in the month reported on. */
export interface ReportExpected {
  id: string;
  supplier_id: string;
  supplier_name: string;
  status: ExpectedStatus;
  expected_date: string | null;
  expected_week: string | null;
  due_date: string;
  moved_count: number;
  /** The day its reception arrived, in Zurich; null unless arrived. */
  arrived_on: BusinessDate | null;
  reception_id: string | null;
  reception_number: string | null;
}

export interface ExpectedPunctuality {
  id: string;
  name: string;
  /** Announced for the month, cancelled ones aside. */
  expected: number;
  onTime: number;
  early: number;
  late: number;
  /** Still expected after its day had passed when the report was taken. */
  notArrived: number;
  /** Not yet due when the report was taken. */
  pending: number;
  cancelled: number;
  /** Entries whose date was pushed at least once. */
  moved: number;
}

export interface ExpectedReport {
  summary: Omit<ExpectedPunctuality, 'id' | 'name'>;
  suppliers: ExpectedPunctuality[];
  /** What came after its day, and what never came: the rows to talk about. */
  lateArrivals: {
    id: string;
    supplier_name: string;
    due_date: string;
    arrived_on: string | null;
    days: number | null;
    reception_id: string | null;
    reception_number: string | null;
  }[];
}

const emptyCounts = () => ({ expected: 0, onTime: 0, early: 0, late: 0, notArrived: 0, pending: 0, cancelled: 0, moved: 0 });

/**
 * Announced against arrived, per supplier. Counts of deliveries, like the
 * rest of the report — why one came late is not something this can know.
 */
export function buildExpectedReport(rows: ReportExpected[], today: BusinessDate): ExpectedReport {
  const summary = emptyCounts();
  const suppliers = new Map<string, ExpectedPunctuality>();
  const lateArrivals: ExpectedReport['lateArrivals'] = [];

  for (const row of rows) {
    let party = suppliers.get(row.supplier_id);
    if (!party) {
      party = { id: row.supplier_id, name: row.supplier_name, ...emptyCounts() };
      suppliers.set(row.supplier_id, party);
    }
    const bump = (key: keyof ReturnType<typeof emptyCounts>) => {
      summary[key] += 1;
      party![key] += 1;
    };

    if (row.status === 'cancelled') {
      bump('cancelled');
      continue;
    }
    bump('expected');
    if (row.moved_count > 0) bump('moved');

    if (row.status === 'arrived' && row.arrived_on) {
      const { verdict, days } = arrivalVerdict(row, row.arrived_on);
      bump(verdict === 'on_time' ? 'onTime' : verdict);
      if (verdict === 'late') {
        lateArrivals.push({
          id: row.id, supplier_name: row.supplier_name, due_date: row.due_date, arrived_on: row.arrived_on, days,
          reception_id: row.reception_id, reception_number: row.reception_number,
        });
      }
    } else if (row.due_date < today) {
      bump('notArrived');
      lateArrivals.push({
        id: row.id, supplier_name: row.supplier_name, due_date: row.due_date, arrived_on: null, days: null,
        reception_id: null, reception_number: null,
      });
    } else {
      bump('pending');
    }
  }

  return {
    summary,
    suppliers: [...suppliers.values()].sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name)),
    lateArrivals: lateArrivals.sort((a, b) => a.due_date.localeCompare(b.due_date)),
  };
}
