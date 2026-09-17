import { describe, it, expect } from 'vitest';
import { formatAgo } from './relative-time';

describe('formatAgo', () => {
  const now = Date.parse('2026-09-17T10:00:00Z');

  it('never says "now" for something that already happened', () => {
    expect(formatAgo('2026-09-17T09:59:50Z', now, 'en')).toBe('1 minute ago');
  });

  it('uses minutes, then hours, then days', () => {
    expect(formatAgo('2026-09-17T09:45:00Z', now, 'en')).toBe('15 minutes ago');
    expect(formatAgo('2026-09-17T07:00:00Z', now, 'en')).toBe('3 hours ago');
    expect(formatAgo('2026-09-16T10:00:00Z', now, 'en')).toBe('yesterday');
    expect(formatAgo('2026-09-12T10:00:00Z', now, 'en')).toBe('5 days ago');
  });

  it('speaks the viewer language', () => {
    expect(formatAgo('2026-09-17T07:00:00Z', now, 'es')).toBe('hace 3 horas');
  });
});
