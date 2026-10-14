import { describe, expect, it } from 'vitest';
import { merchSettled, merchStatus } from './merch';

describe('merchStatus', () => {
  const base = { packing: 'open' as const, expired_at: null, order: null };

  it('waits without an order', () => {
    expect(merchStatus(base)).toBe('waiting');
  });

  it('is on the order until packed', () => {
    expect(merchStatus({ ...base, order: { shipped_at: null } })).toBe('on_order');
    expect(merchStatus({ ...base, packing: 'packed', order: { shipped_at: null } })).toBe('packed');
  });

  it('is sent once the order with it packed ships', () => {
    expect(merchStatus({ ...base, packing: 'packed', order: { shipped_at: '2026-10-14T08:00:00Z' } })).toBe('sent');
  });

  it('marked not sent stays not sent, shipped or not', () => {
    expect(merchStatus({ ...base, packing: 'not_sent', order: { shipped_at: '2026-10-14T08:00:00Z' } })).toBe('not_sent');
  });

  it('expired wins', () => {
    expect(merchStatus({ ...base, expired_at: '2026-10-14T08:00:00Z' })).toBe('expired');
  });

  it('knows what is finished', () => {
    expect(merchSettled('sent')).toBe(true);
    expect(merchSettled('expired')).toBe(true);
    expect(merchSettled('waiting')).toBe(false);
    expect(merchSettled('packed')).toBe(false);
  });
});
