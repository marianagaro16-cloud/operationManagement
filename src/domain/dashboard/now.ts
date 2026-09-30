/**
 * The dashboard's "Now" list: only what is late or due now, whatever its
 * kind, most urgent first.
 *
 * One line per kind, carrying its count — not one line per record. The
 * records themselves are one tap away (the activity list below, the orders
 * screen, the reminders), and a list of forty lines would be the long page
 * this exists to replace.
 *
 * Pure: the page gathers the counts it already fetched; this decides what is
 * worth a line and in which order.
 */

export type NowKind =
  | 'overdueActivities'
  | 'blockedActivities'
  | 'urgentOrders'
  | 'overdueCounts'
  | 'countsToday'
  | 'overdueReminders'
  | 'overduePersonalTasks'
  | 'planLate'
  | 'planToday'
  | 'evaluationsDue'
  | 'absencesToApprove';

/** late: past its moment. today: due now or today. */
export type NowLevel = 'late' | 'today';

export interface NowItem {
  kind: NowKind;
  level: NowLevel;
  count: number;
  href: string;
  /** A few names to say what it is about, when there are some. */
  names?: string[];
}

export interface NowInput {
  overdueActivities: number;
  /** Only for whoever manages scheduled work; others pass 0. */
  blockedActivities: number;
  /** Orders past or close to their delivery and not ready, worst first. */
  urgentOrders: { name: string; late: boolean }[];
  overdueCounts: number;
  countsToday: number;
  overdueReminders: number;
  overduePersonalTasks: number;
  /** The viewer's planned sales activities: from before today, and still to do today. */
  planLate: number;
  planToday: number;
  /** Evaluations to fill in whose deadline is today. */
  evaluationsDue: number;
  /** Absence requests waiting for the viewer's decision; approvers only. */
  absencesToApprove: number;
}

/**
 * In urgency order: what is late before what is due today, and within each,
 * the floor's work before the personal follow-ups — an order going out late
 * outranks a reminder.
 */
const ORDER: NowKind[] = [
  'urgentOrders',
  'overdueActivities',
  'overdueCounts',
  'overdueReminders',
  'overduePersonalTasks',
  'planLate',
  'evaluationsDue',
  'absencesToApprove',
  'countsToday',
  'planToday',
  'blockedActivities',
];

export function buildNowItems(input: NowInput): NowItem[] {
  const urgentLate = input.urgentOrders.some((o) => o.late);
  const items: NowItem[] = [
    { kind: 'urgentOrders', level: urgentLate ? 'late' : 'today', count: input.urgentOrders.length, href: '/orders?tab=to_prepare', names: input.urgentOrders.slice(0, 3).map((o) => o.name) },
    { kind: 'overdueActivities', level: 'late', count: input.overdueActivities, href: '#overdue' },
    { kind: 'overdueCounts', level: 'late', count: input.overdueCounts, href: '/inventory' },
    { kind: 'overdueReminders', level: 'late', count: input.overdueReminders, href: '/reminders' },
    { kind: 'overduePersonalTasks', level: 'late', count: input.overduePersonalTasks, href: '/reminders/tasks' },
    { kind: 'planLate', level: 'late', count: input.planLate, href: '/sales?tab=planning' },
    { kind: 'evaluationsDue', level: 'today', count: input.evaluationsDue, href: '/evaluations' },
    { kind: 'absencesToApprove', level: 'today', count: input.absencesToApprove, href: '/absences?tab=approve' },
    { kind: 'countsToday', level: 'today', count: input.countsToday, href: '/inventory' },
    { kind: 'planToday', level: 'today', count: input.planToday, href: '/sales?tab=planning' },
    // Blocked is not late — it waits on something else — but it needs eyes.
    { kind: 'blockedActivities', level: 'today', count: input.blockedActivities, href: '#blocked' },
  ];
  return items
    .filter((i) => i.count > 0)
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'late' ? -1 : 1;
      return ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
    });
}
