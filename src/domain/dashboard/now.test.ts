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
  absencesToApprove: 0,
};

describe('buildNowItems', () => {
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
