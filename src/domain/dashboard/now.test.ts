import { describe, expect, it } from 'vitest';
import { buildNowItems, type NowInput } from './now';

const none: NowInput = {
  overdueActivities: 0,
  blockedActivities: 0,
  urgentOrders: [],
  overdueCounts: 0,
  countsToday: 0,
  overdueReminders: 0,
  overduePersonalTasks: 0,
  planLate: 0,
  planToday: 0,
  evaluationsDue: 0,
  hrFollowUps: { count: 0, late: false },
  absencesToApprove: 0,
  coverageGaps: 0,
  meetingInvites: 0,
  meetingRecords: { count: 0, late: false, href: '/meetings' },
  meetingFollowUps: { count: 0, late: false, href: '/meetings' },
  actasToWrite: { count: 0, late: false, href: '/sales?tab=actas' },
  actaFollowUps: { count: 0, late: false, href: '/sales?tab=actas' },
  collectionFollowUps: 0,
  lateDeliveries: [],
  deliveriesSoon: [],
};

describe('buildNowItems', () => {
  it('lists expected deliveries: what did not arrive as late, today and tomorrow as due', () => {
    const items = buildNowItems({ ...none, lateDeliveries: ['Rovey Seed'], deliveriesSoon: ['Intercheese', 'El Sol'], countsToday: 1 });
    expect(items.map((i) => [i.kind, i.level, i.count])).toEqual([
      ['lateDeliveries', 'late', 1],
      ['deliveriesSoon', 'today', 2],
      ['countsToday', 'today', 1],
    ]);
    expect(items[1]!.names).toEqual(['Intercheese', 'El Sol']);
  });

  it('lists the Actas still to write: due at first, late after two days', () => {
    const due = buildNowItems({ ...none, actasToWrite: { count: 2, late: false, href: '/sales/actas/a' } });
    expect(due.map((i) => [i.kind, i.level, i.count, i.href])).toEqual([['actasToWrite', 'today', 2, '/sales/actas/a']]);
    const late = buildNowItems({ ...none, actasToWrite: { count: 1, late: true, href: '/sales/actas/a' }, actaFollowUps: { count: 1, late: false, href: '/sales/actas/b' } });
    expect(late.map((i) => [i.kind, i.level])).toEqual([['actasToWrite', 'late'], ['actaFollowUps', 'today']]);
  });

  it('is empty when nothing is late or due', () => {
    expect(buildNowItems(none)).toEqual([]);
  });

  it('puts what is late before what is due today', () => {
    const kinds = buildNowItems({ ...none, countsToday: 1, overdueReminders: 2, blockedActivities: 1 }).map((i) => i.kind);
    expect(kinds).toEqual(['overdueReminders', 'countsToday', 'blockedActivities']);
  });

  it('ranks a late order above late activities and personal follow-ups', () => {
    const kinds = buildNowItems({
      ...none,
      overdueActivities: 3,
      overdueReminders: 1,
      urgentOrders: [{ name: 'El Mini Super', late: true }],
    }).map((i) => i.kind);
    expect(kinds).toEqual(['urgentOrders', 'overdueActivities', 'overdueReminders']);
  });

  it('treats orders only close to their deadline as today, not late', () => {
    const [item] = buildNowItems({ ...none, urgentOrders: [{ name: 'A', late: false }, { name: 'B', late: false }] });
    expect(item).toMatchObject({ kind: 'urgentOrders', level: 'today', count: 2, names: ['A', 'B'] });
  });

  it('names at most three orders', () => {
    const [item] = buildNowItems({
      ...none,
      urgentOrders: ['A', 'B', 'C', 'D'].map((name) => ({ name, late: true })),
    });
    expect(item.names).toEqual(['A', 'B', 'C']);
    expect(item.count).toBe(4);
  });
});
