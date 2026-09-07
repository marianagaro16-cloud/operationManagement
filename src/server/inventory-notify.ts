import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import {
  selectInventoryNotifications,
  type NotifiableInventory,
} from '@/domain/inventory/notifications';
import { sendToAdmins, sendToUsers } from './push';
import { addDays, businessToday } from '@/lib/datetime';

/**
 * Inventory push alerts.
 *
 * Rides the EXISTING notifier: same cron endpoint, same web-push delivery,
 * same claim-before-send dedupe pattern as orders. No second notification
 * system, and deliberately no email.
 */
export async function runInventoryNotifications(now: Date = new Date()): Promise<{
  considered: number;
  sent: number;
}> {
  const admin = createAdminClient();
  const today = businessToday(now);

  // Only inventories that could plausibly need an alert: yesterday through
  // tomorrow, plus anything recently completed that still owes reconciliation.
  const { data, error } = await admin
    .from('inventory_instances')
    .select(`
      id, name_snapshot, inventory_date, iso_week, status, digital_enabled, completed_at,
      assignments:inventory_assignments ( user_id ),
      items:inventory_instance_items ( status, digital_quantity )
    `)
    .gte('inventory_date', addDays(today, -14))
    .lte('inventory_date', addDays(today, 1));

  if (error) throw new Error(error.message);

  const inventories: NotifiableInventory[] = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      name_snapshot: string;
      inventory_date: string;
      iso_week: number;
      status: NotifiableInventory['status'];
      digital_enabled: boolean;
      completed_at: string | null;
      assignments: { user_id: string }[] | null;
      items: { status: string; digital_quantity: number | null }[] | null;
    };
    const items = r.items ?? [];
    return {
      id: r.id,
      name_snapshot: r.name_snapshot,
      inventory_date: r.inventory_date,
      iso_week: r.iso_week,
      status: r.status,
      digital_enabled: r.digital_enabled,
      completed_at: r.completed_at,
      assignee_ids: (r.assignments ?? []).map((a) => a.user_id),
      digital_pending_count: r.digital_enabled
        ? items.filter((i) => i.digital_quantity === null).length
        : 0,
      review_count: items.filter((i) => i.status === 'to_review').length,
    };
  });

  if (inventories.length === 0) return { considered: 0, sent: 0 };

  const { data: sentRows } = await admin
    .from('inventory_notifications')
    .select('instance_id, kind')
    .in('instance_id', inventories.map((i) => i.id));

  const alreadySent = new Set(
    (sentRows ?? []).map(
      (r) => `${(r as { instance_id: string }).instance_id}:${(r as { kind: string }).kind}`,
    ),
  );

  const planned = selectInventoryNotifications(inventories, alreadySent, today, now);

  let sent = 0;
  for (const n of planned) {
    // Claim BEFORE sending. The unique constraint means a concurrent run
    // loses the race and skips, rather than both delivering the same alert.
    const { error: claimError } = await admin
      .from('inventory_notifications')
      .insert({ instance_id: n.inventoryId, kind: n.kind, recipients: 0 });
    if (claimError) continue;

    const payload = {
      title: n.title,
      body: n.body,
      // One tag per inventory, so a later alert replaces the earlier card
      // instead of stacking three notifications for the same count.
      tag: `inventory-${n.inventoryId}`,
      url: `/inventory/${n.inventoryId}`,
    };

    const recipients =
      n.audience === 'admins'
        ? await sendToAdmins(payload)
        : await sendToUsers(n.userIds, payload);

    if (recipients === 0) {
      // Nobody has notifications enabled yet. Release the claim so the alert
      // can still fire once somebody subscribes, rather than being silently
      // consumed by a run that reached no one.
      await admin
        .from('inventory_notifications')
        .delete()
        .eq('instance_id', n.inventoryId)
        .eq('kind', n.kind);
      continue;
    }

    await admin
      .from('inventory_notifications')
      .update({ recipients })
      .eq('instance_id', n.inventoryId)
      .eq('kind', n.kind);

    sent += recipients;
  }

  return { considered: inventories.length, sent };
}
