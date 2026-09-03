import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { selectNotifications, type NotifiableOrder } from './notifications';
import { BUSINESS_TZ } from '@/lib/datetime';

const at = (iso: string) => DateTime.fromISO(iso, { zone: BUSINESS_TZ }).toJSDate();

let seq = 0;
function order(over: Partial<NotifiableOrder> = {}): NotifiableOrder {
  seq++;
  return {
    id: `order-${seq}`,
    reference: 1000 + seq,
    status: 'confirmed',
    delivery_date: '2026-09-10',
    delivery_time: '14:00',
    customer: { name: 'La Brea' },
    lines: [{ ordered_quantity: 10, shortfall_reason: null, allocations: [] }],
    ...over,
  };
}

const none = new Set<string>();

describe('what gets notified', () => {
  it('notifies unfinished work inside the warning window', () => {
    const out = selectNotifications([order()], none, at('2026-09-10T09:00'));
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('warning');
  });

  it('escalates to critical and overdue', () => {
    expect(selectNotifications([order()], none, at('2026-09-10T13:00'))[0].level).toBe('critical');
    expect(selectNotifications([order()], none, at('2026-09-10T15:00'))[0].level).toBe('overdue');
  });

  it('stays silent while the deadline is far off', () => {
    expect(selectNotifications([order()], none, at('2026-09-08T09:00'))).toEqual([]);
  });

  it('does not notify at "soon" — 24h out is not worth interrupting anyone', () => {
    expect(selectNotifications([order()], none, at('2026-09-09T20:00'))).toEqual([]);
  });
});

describe('what is deliberately never notified', () => {
  it('ignores a fully prepared order, however close the deadline', () => {
    const done = order({
      lines: [{ ordered_quantity: 10, shortfall_reason: null, allocations: [{ quantity: 10 }] }],
    });
    expect(selectNotifications([done], none, at('2026-09-10T13:59'))).toEqual([]);
  });

  it('ignores a cancelled order', () => {
    expect(selectNotifications([order({ status: 'cancelled' })], none, at('2026-09-10T13:00'))).toEqual([]);
  });

  it('still notifies a partially prepared order', () => {
    const partial = order({
      lines: [
        { ordered_quantity: 10, shortfall_reason: null, allocations: [{ quantity: 6 }] },
        { ordered_quantity: 5, shortfall_reason: null, allocations: [{ quantity: 5 }] },
      ],
    });
    const out = selectNotifications([partial], none, at('2026-09-10T13:00'));
    expect(out).toHaveLength(1);
    expect(out[0].openLines).toBe(1);
  });
});

describe('deduplication', () => {
  it('does not resend a level already sent', () => {
    const o = order();
    const sent = new Set([`${o.id}:critical`]);
    expect(selectNotifications([o], sent, at('2026-09-10T13:00'))).toEqual([]);
  });

  it('DOES send when the order escalates to a worse level', () => {
    const o = order();
    // Warning was already sent; it is now critical, which is new information.
    const sent = new Set([`${o.id}:warning`]);
    const out = selectNotifications([o], sent, at('2026-09-10T13:00'));
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('critical');
  });

  it('is silent once every level has fired', () => {
    const o = order();
    const sent = new Set([`${o.id}:warning`, `${o.id}:critical`, `${o.id}:overdue`]);
    expect(selectNotifications([o], sent, at('2026-09-10T15:00'))).toEqual([]);
  });
});

describe('ordering and content', () => {
  it('returns the most urgent first', () => {
    const warn = order({ delivery_time: '17:00' });
    const crit = order({ delivery_time: '13:00' });
    const late = order({ delivery_time: '10:00' });
    const out = selectNotifications([warn, crit, late], none, at('2026-09-10T12:00'));
    expect(out.map((n) => n.level)).toEqual(['overdue', 'critical', 'warning']);
  });

  it('names the customer and states what is left', () => {
    const out = selectNotifications([order()], none, at('2026-09-10T13:00'));
    expect(out[0].title).toContain('La Brea');
    expect(out[0].body).toContain('#1');
    expect(out[0].body).toContain('14:00');
    expect(out[0].body).toContain('producto');
  });

  it('reports minutes when under an hour remains', () => {
    const out = selectNotifications([order()], none, at('2026-09-10T13:30'));
    expect(out[0].body).toContain('30 min');
  });

  it('reports how late an overdue order is', () => {
    const out = selectNotifications([order()], none, at('2026-09-10T16:30'));
    expect(out[0].body).toContain('retraso');
  });
});

describe('orders with no committed hour', () => {
  it('notifies on the delivery day itself', () => {
    const o = order({ delivery_time: null });
    const out = selectNotifications([o], none, at('2026-09-10T08:00'));
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('warning');
    expect(out[0].deliveryTime).toBeNull();
  });

  it('notifies as overdue the day after, on the Zurich boundary', () => {
    // 00:30 Zurich on the 11th is still the 10th in New York, where the
    // suite runs. It must already count as overdue.
    const o = order({ delivery_time: null });
    expect(selectNotifications([o], none, at('2026-09-11T00:30'))[0].level).toBe('overdue');
  });

  it('stays silent before the delivery day', () => {
    expect(selectNotifications([order({ delivery_time: null })], none, at('2026-09-09T12:00'))).toEqual([]);
  });
});
