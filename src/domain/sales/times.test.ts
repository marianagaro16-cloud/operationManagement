import { describe, expect, it } from 'vitest';
import { addMinutes, overlapping, timeRange } from './times';

describe('addMinutes', () => {
  it('adds, across the hour', () => {
    expect(addMinutes('10:00', 30)).toBe('10:30');
    expect(addMinutes('10:45:00', 30)).toBe('11:15');
  });
  it('stays within the day', () => {
    expect(addMinutes('23:30', 60)).toBe('23:59');
  });
});

describe('timeRange', () => {
  it('reads as a span, a moment, or nothing', () => {
    expect(timeRange('10:00:00', '10:30:00')).toBe('10:00–10:30');
    expect(timeRange('10:00:00', null)).toBe('10:00');
    expect(timeRange(null, null)).toBeNull();
  });
});

describe('overlapping', () => {
  const a = { id: 'a', start: '10:00', end: '11:00' };
  const b = { id: 'b', start: '10:30', end: '11:30' };
  const c = { id: 'c', start: '11:00', end: '11:30' };
  const moment = { id: 'm', start: '10:15', end: null };

  it('finds spans that cross, both ways', () => {
    const found = overlapping([a, b]);
    expect(found.get('a')?.map((x) => x.id)).toEqual(['b']);
    expect(found.get('b')?.map((x) => x.id)).toEqual(['a']);
  });

  it('does not count touching ends', () => {
    expect(overlapping([a, c]).size).toBe(0);
  });

  it('ignores a moment without an end', () => {
    expect(overlapping([a, moment]).size).toBe(0);
  });
});
