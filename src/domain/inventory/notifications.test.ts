import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  physicalCountDoneAlert,
  selectInventoryNotifications,
  type NotifiableInventory,
} from './notifications';
import { BUSINESS_TZ } from '@/lib/datetime';

const zurich = (iso: string) => DateTime.fromISO(iso, { zone: BUSINESS_TZ }).toJSDate();

const TODAY = '2026-09-11';

function inventory(overrides: Partial<NotifiableInventory> = {}): NotifiableInventory {
  return {
    id: 'inv-1',
    name_snapshot: 'Masamor / Del Barrio',
    inventory_date: TODAY,
    iso_week: 37,
    status: 'in_progress',
    digital_enabled: true,
    completed_at: null,
    assignee_ids: ['user-a', 'user-b'],
    digital_pending_count: 0,
    review_count: 0,
    ...overrides,
  };
}

const kinds = (list: { kind: string }[]) => list.map((n) => n.kind).sort();

describe('selectInventoryNotifications', () => {
  it('tells the assigned users an inventory is due today', () => {
    const out = selectInventoryNotifications(
      [inventory()],
      new Set(),
      TODAY,
      zurich('2026-09-11T08:00'),
    );
    const due = out.find((n) => n.kind === 'due_today');
    expect(due?.audience).toBe('assignees');
    expect(due?.userIds).toEqual(['user-a', 'user-b']);
  });

  it('notifies nobody when the inventory has no assignees', () => {
    // Pushing an unassigned count to everyone is how a notification system
    // becomes noise the team mutes.
    const out = selectInventoryNotifications(
      [inventory({ assignee_ids: [] })],
      new Set(),
      TODAY,
      zurich('2026-09-11T08:00'),
    );
    expect(out).toEqual([]);
  });

  it('does not repeat an alert that has already been sent', () => {
    const out = selectInventoryNotifications(
      [inventory()],
      new Set(['inv-1:due_today']),
      TODAY,
      zurich('2026-09-11T08:00'),
    );
    expect(kinds(out)).not.toContain('due_today');
  });

  it('nudges about the deadline inside the warning window', () => {
    // 17:00 is 60 minutes before the 18:00 cut-off.
    const out = selectInventoryNotifications(
      [inventory()],
      new Set(['inv-1:due_today']),
      TODAY,
      zurich('2026-09-11T17:00'),
    );
    expect(kinds(out)).toContain('deadline_soon');
  });

  it('does not nudge long before the deadline', () => {
    const out = selectInventoryNotifications(
      [inventory()],
      new Set(['inv-1:due_today']),
      TODAY,
      zurich('2026-09-11T09:00'),
    );
    expect(kinds(out)).not.toContain('deadline_soon');
  });

  it('does not nudge once the deadline has already passed', () => {
    // There is nothing the recipient could still do about it.
    const out = selectInventoryNotifications(
      [inventory()],
      new Set(['inv-1:due_today']),
      TODAY,
      zurich('2026-09-11T18:30'),
    );
    expect(kinds(out)).not.toContain('deadline_soon');
  });

  it('tells the reconcilers when a count is completed', () => {
    const out = selectInventoryNotifications(
      [inventory({ completed_at: '2026-09-11T15:00:00Z' })],
      new Set(),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    const completed = out.find((n) => n.kind === 'completed');
    expect(completed?.audience).toBe('reconcilers');
  });

  it('tells the reconcilers that Inventory Digital is outstanding', () => {
    const out = selectInventoryNotifications(
      [inventory({ completed_at: 'x', digital_pending_count: 12 })],
      new Set(),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    expect(kinds(out)).toContain('digital_pending');
  });

  it('stays quiet about Inventory Digital on a template that does not use it', () => {
    const out = selectInventoryNotifications(
      [inventory({ completed_at: 'x', digital_enabled: false, digital_pending_count: 12 })],
      new Set(),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    expect(kinds(out)).not.toContain('digital_pending');
  });

  it('tells the reconcilers when differences need review', () => {
    const out = selectInventoryNotifications(
      [inventory({ completed_at: 'x', review_count: 3 })],
      new Set(),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    const review = out.find((n) => n.kind === 'review_required');
    expect(review?.audience).toBe('reconcilers');
    expect(review?.body).toContain('3');
  });

  it('says nothing about an inventory that is not due and not completed', () => {
    const out = selectInventoryNotifications(
      [inventory({ inventory_date: '2026-09-18' })],
      new Set(),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    expect(out).toEqual([]);
  });
});

describe('physical count done', () => {
  it('tells the digital side it can start, and stands for both ledger kinds', () => {
    const alert = physicalCountDoneAlert({ name_snapshot: 'Complementarios', iso_week: 38, digital_enabled: true, product_count: 94 });
    expect(alert.title).toBe('Complementarios');
    expect(alert.body).toContain('Inventario Digital');
    expect(alert.body).toContain('94');
    expect(alert.body).toContain('KW 38');
    expect(alert.claims.sort()).toEqual(['completed', 'digital_pending']);
  });

  it('on a template without Inventory Digital, just says it is completed', () => {
    const alert = physicalCountDoneAlert({ name_snapshot: 'Empaques', iso_week: 38, digital_enabled: false, product_count: 114 });
    expect(alert.body).not.toContain('Digital');
    expect(alert.claims).toEqual(['completed']);
  });

  it('keeps the scheduler from repeating what the immediate alert already said', () => {
    const alert = physicalCountDoneAlert({ name_snapshot: 'X', iso_week: 37, digital_enabled: true, product_count: 12 });
    const out = selectInventoryNotifications(
      [inventory({ completed_at: 'x', digital_pending_count: 12 })],
      new Set(alert.claims.map((k) => `inv-1:${k}`)),
      TODAY,
      zurich('2026-09-11T16:00'),
    );
    expect(kinds(out)).not.toContain('completed');
    expect(kinds(out)).not.toContain('digital_pending');
  });
});
