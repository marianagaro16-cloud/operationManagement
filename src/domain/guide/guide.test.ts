import { describe, expect, it } from 'vitest';
import { cleanBlocks, daysWithPoints, isoWeekday, openCount, pointsOn } from './guide';

const point = (id: string, weekdays: number[], sort_order: number, deadline: string | null = null, kind: 'task' | 'rule' = 'task') =>
  ({ id, weekdays, sort_order, deadline, kind });

describe('guide days', () => {
  it('knows the weekday of a business date', () => {
    expect(isoWeekday('2026-10-06')).toBe(2); // a Tuesday
    expect(isoWeekday('2026-10-11')).toBe(7);
  });

  it('lists a weekday\'s points as arranged, the earlier deadline first on a tie', () => {
    const points = [point('c', [1, 2], 30), point('b', [2], 10, '12:00:00'), point('a', [2], 10, '07:00:00'), point('x', [3], 5)];
    expect(pointsOn(points, 2).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows Monday to Friday, and the weekend only when it has points', () => {
    expect(daysWithPoints([point('a', [1], 1)])).toEqual([1, 2, 3, 4, 5]);
    expect(daysWithPoints([point('a', [6], 1)])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('counts the tasks nobody touched; rules are never open', () => {
    const points = [point('a', [1], 1), point('b', [1], 2), point('r', [1], 3, null, 'rule')];
    expect(openCount(points, ['a'])).toBe(1);
    expect(openCount(points, [])).toBe(2);
  });
});

describe('cleanBlocks', () => {
  it('drops what is empty and squares a table', () => {
    expect(
      cleanBlocks([
        { type: 'heading', text: '  Paso 1 ' },
        { type: 'text', text: '   ' },
        { type: 'image', path: '', caption: 'x' },
        { type: 'image', path: 'a/b.png', caption: ' ' },
        { type: 'table', rows: [['Cliente', 'Día'], ['Taquerías'], ['', '']] },
      ]),
    ).toEqual([
      { type: 'heading', text: 'Paso 1' },
      { type: 'image', path: 'a/b.png' },
      { type: 'table', rows: [['Cliente', 'Día'], ['Taquerías', '']] },
    ]);
  });
});
