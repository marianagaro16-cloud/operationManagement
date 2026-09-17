import { describe, it, expect } from 'vitest';
import { ONLINE_WINDOW_MS, areaFor, isOnline } from './presence';

describe('isOnline', () => {
  const now = Date.parse('2026-09-17T10:00:00Z');

  it('is online just after a check-in', () => {
    expect(isOnline('2026-09-17T09:59:45Z', now)).toBe(true);
  });

  it('survives one missed heartbeat', () => {
    expect(isOnline(new Date(now - 65_000).toISOString(), now)).toBe(true);
  });

  it('is offline once the window has passed', () => {
    expect(isOnline(new Date(now - ONLINE_WINDOW_MS).toISOString(), now)).toBe(false);
    expect(isOnline('2026-09-16T10:00:00Z', now)).toBe(false);
  });

  it('is offline for somebody who never checked in', () => {
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline('not a date', now)).toBe(false);
  });
});

describe('areaFor', () => {
  it('names the section, not the record', () => {
    expect(areaFor('/orders/1f0c-uuid')).toBe('orders');
    expect(areaFor('/goods-reception/abc')).toBe('goods-reception');
    expect(areaFor('/admin/inventory/locations')).toBe('admin');
    expect(areaFor('/reminders/tasks')).toBe('reminders');
  });

  it('ignores a query string', () => {
    expect(areaFor('/dashboard?tab=today')).toBe('dashboard');
  });

  it('maps the old Preparation route to Orders', () => {
    expect(areaFor('/preparation')).toBe('orders');
  });

  it('returns null for an unknown or missing path', () => {
    expect(areaFor('/somewhere-else')).toBeNull();
    expect(areaFor('/')).toBeNull();
    expect(areaFor(null)).toBeNull();
  });
});
