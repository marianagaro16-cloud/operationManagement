import { describe, expect, it } from 'vitest';
import { autoDone, checklistDue, checklistState, entryDone, itemsFor, type ChecklistFacts } from './checklists';

const facts = (patch: Partial<ChecklistFacts> = {}): ChecklistFacts => ({ keysHeld: 0, accountLinked: false, accountActive: false, trainingsDone: false, ...patch });

describe('checklists', () => {
  it('ticks the automatic items from what the app knows', () => {
    expect(autoDone('keys', 'start', facts({ keysHeld: 1 }))).toBe(true);
    expect(autoDone('keys', 'start', facts())).toBe(false);
    expect(autoDone('keys', 'leave', facts())).toBe(true);
    expect(autoDone('keys', 'leave', facts({ keysHeld: 2 }))).toBe(false);
    expect(autoDone('account', 'start', facts({ accountLinked: true, accountActive: true }))).toBe(true);
    expect(autoDone('account', 'leave', facts({ accountLinked: true, accountActive: true }))).toBe(false);
    expect(autoDone('account', 'leave', facts({ accountLinked: true, accountActive: false }))).toBe(true);
    expect(autoDone('trainings', 'start', facts({ trainingsDone: true }))).toBe(true);
  });

  it('a hand tick counts even when the fact does not hold', () => {
    expect(entryDone({ auto: 'keys', done_at: '2026-10-22T10:00:00Z' }, 'start', facts())).toBe('hand');
    expect(entryDone({ auto: 'keys', done_at: null }, 'start', facts({ keysHeld: 1 }))).toBe('app');
    expect(entryDone({ auto: null, done_at: null }, 'start', facts())).toBeNull();
  });

  it('counts what is open, late after the due day', () => {
    const entries = [{ auto: null, done_at: null }, { auto: 'keys' as const, done_at: null }, { auto: null, done_at: 'x' }];
    expect(checklistState({ phase: 'start', due_on: '2026-10-22' }, entries, facts(), '2026-10-22')).toEqual({ total: 3, open: 2, overdue: false });
    expect(checklistState({ phase: 'start', due_on: '2026-10-21' }, entries, facts({ keysHeld: 1 }), '2026-10-22')).toEqual({ total: 3, open: 1, overdue: true });
  });

  it('is due 14 days after the start, 7 after leaving', () => {
    expect(checklistDue('start', { start_date: '2026-11-01', left_on: null }, '2026-10-22')).toBe('2026-11-15');
    expect(checklistDue('leave', { start_date: null, left_on: null }, '2026-10-22')).toBe('2026-10-29');
  });

  it('takes the items for the team, or for all teams', () => {
    const items = [
      { id: 'a', phase: 'start' as const, teams: [], is_active: true },
      { id: 'b', phase: 'start' as const, teams: ['production'], is_active: true },
      { id: 'c', phase: 'start' as const, teams: ['sales'], is_active: true },
      { id: 'd', phase: 'leave' as const, teams: [], is_active: true },
      { id: 'e', phase: 'start' as const, teams: [], is_active: false },
    ];
    expect(itemsFor(items, 'start', 'production').map((i) => i.id)).toEqual(['a', 'b']);
  });
});
