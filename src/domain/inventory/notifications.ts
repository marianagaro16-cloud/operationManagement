import { DateTime } from 'luxon';
import { BUSINESS_TZ, type BusinessDate } from '@/lib/datetime';
import { editDeadline } from './calc';

/**
 * Which inventory alerts are due right now.
 *
 * Pure and synchronous so the selection logic is unit-testable without a
 * database or a push service — the same shape as the orders notifier next
 * door, and reusing its infrastructure rather than adding a second one.
 */

export type InventoryNotificationKind =
  | 'due_today'
  | 'deadline_soon'
  | 'completed'
  | 'digital_pending'
  | 'review_required';

/** Who an alert is for. Assignees can act on the count; admins reconcile it. */
export type Audience = 'assignees' | 'admins';

export interface NotifiableInventory {
  id: string;
  name_snapshot: string;
  inventory_date: BusinessDate;
  iso_week: number;
  status: 'in_progress' | 'completed' | 'to_review' | 'resolved';
  digital_enabled: boolean;
  completed_at: string | null;
  assignee_ids: string[];
  /** Items still waiting for an admin to enter Inventory Digital. */
  digital_pending_count: number;
  /** Items whose difference is not zero and not yet resolved. */
  review_count: number;
}

export interface PlannedNotification {
  inventoryId: string;
  kind: InventoryNotificationKind;
  audience: Audience;
  userIds: string[];
  title: string;
  body: string;
}

/** How long before 18:00 the "finish your count" nudge goes out. */
export const DEADLINE_WARNING_MINUTES = 90;

/**
 * Push text is Spanish, matching the order notifier.
 *
 * A push payload is composed on the server, where there is no reader and so
 * no locale to render for — the app's working language is the one choice that
 * is right for everyone who receives it.
 */
const TEXT: Record<InventoryNotificationKind, (inv: NotifiableInventory, n?: number) => string> = {
  due_today: (inv) => `Inventario de hoy — KW ${inv.iso_week}`,
  deadline_soon: (inv, n) => `Quedan ${n} min para las 18:00 — KW ${inv.iso_week}`,
  completed: (inv) => `Inventario completado — KW ${inv.iso_week}`,
  digital_pending: (inv, n) => `${n} productos sin Inventario Digital — KW ${inv.iso_week}`,
  review_required: (inv, n) => `${n} diferencias por revisar — KW ${inv.iso_week}`,
};

export function selectInventoryNotifications(
  inventories: readonly NotifiableInventory[],
  alreadySent: ReadonlySet<string>,
  today: BusinessDate,
  now: Date = new Date(),
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const nowZurich = DateTime.fromJSDate(now, { zone: BUSINESS_TZ });

  for (const inv of inventories) {
    const seen = (kind: InventoryNotificationKind) => alreadySent.has(`${inv.id}:${kind}`);
    const push = (
      kind: InventoryNotificationKind,
      audience: Audience,
      userIds: string[],
      count?: number,
    ) =>
      out.push({
        inventoryId: inv.id,
        kind,
        audience,
        userIds,
        title: inv.name_snapshot,
        body: TEXT[kind](inv, count),
      });

    // ---- for the people counting ----
    // An unassigned inventory notifies nobody: there is no one it is
    // addressed to, and pushing it to everyone would be noise the team mutes.
    if (inv.inventory_date === today && inv.completed_at === null && inv.assignee_ids.length > 0) {
      if (!seen('due_today')) push('due_today', 'assignees', inv.assignee_ids);

      // The deadline nudge only makes sense while there is still time to act
      // on it, so it is skipped once 18:00 has already passed.
      const minutesLeft = editDeadline(inv.inventory_date).diff(nowZurich, 'minutes').minutes;
      if (!seen('deadline_soon') && minutesLeft > 0 && minutesLeft <= DEADLINE_WARNING_MINUTES) {
        push('deadline_soon', 'assignees', inv.assignee_ids, Math.round(minutesLeft));
      }
    }

    // ---- for the admins who reconcile ----
    if (inv.completed_at !== null) {
      if (!seen('completed')) push('completed', 'admins', []);

      // Only meaningful on a template that uses Inventory Digital at all.
      if (inv.digital_enabled && inv.digital_pending_count > 0 && !seen('digital_pending')) {
        push('digital_pending', 'admins', [], inv.digital_pending_count);
      }

      if (inv.review_count > 0 && !seen('review_required')) {
        push('review_required', 'admins', [], inv.review_count);
      }
    }
  }

  return out;
}
