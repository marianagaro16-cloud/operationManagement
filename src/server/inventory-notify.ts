import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import {
  physicalCountDoneAlert,
  selectInventoryNotifications,
  type NotifiableInventory,
} from '@/domain/inventory/notifications';
import { sendToPermissionHolders, sendToUsers } from './push';
import { addDays, businessToday } from '@/lib/datetime';
import { shortShelfLife, shortShelfLifeAlert } from '@/domain/inventory/shelf-life';

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
      n.audience === 'reconcilers'
        ? await sendToPermissionHolders('inventory.manage_instances', payload)
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

/**
 * Tell the digital side a physical count is finished — now, not at the next
 * scheduler tick.
 *
 * Called straight after inventory_complete() succeeded, so the count is
 * already closed and authorised by the database; this only delivers the
 * news. It claims the ledger kinds it stands for before sending, exactly as
 * the scheduler does, so the scheduler will not repeat it — and if nobody
 * with the capability has a device registered, it releases them again so
 * the scheduler can still deliver once somebody subscribes.
 *
 * Never throws: a failed push must not make a completed count look failed.
 */
export async function notifyPhysicalCountDone(instanceId: string, completedBy: string | null): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_instances')
      .select('id, name_snapshot, iso_week, digital_enabled, items:inventory_instance_items ( id )')
      .eq('id', instanceId)
      .maybeSingle();
    if (error || !data) return 0;
    const inv = data as unknown as {
      id: string; name_snapshot: string; iso_week: number; digital_enabled: boolean; items: { id: string }[] | null;
    };

    const alert = physicalCountDoneAlert({
      name_snapshot: inv.name_snapshot,
      iso_week: inv.iso_week,
      digital_enabled: inv.digital_enabled,
      product_count: (inv.items ?? []).length,
    });

    // Claim first. If the primary kind is already taken, another path has
    // told them; say nothing twice.
    const primary = alert.claims[alert.claims.length - 1];
    const { error: claimError } = await admin
      .from('inventory_notifications')
      .insert({ instance_id: instanceId, kind: primary, recipients: 0 });
    if (claimError) return 0;
    const others = alert.claims.filter((k) => k !== primary);
    if (others.length) {
      await admin.from('inventory_notifications').upsert(
        others.map((kind) => ({ instance_id: instanceId, kind, recipients: 0 })),
        { onConflict: 'instance_id,kind', ignoreDuplicates: true },
      );
    }

    const recipients = await sendToPermissionHolders('inventory.manage_instances', {
      title: alert.title,
      body: alert.body,
      tag: `inventory-${instanceId}`,
      url: `/inventory/${instanceId}`,
    }, completedBy);

    if (recipients === 0) {
      await admin.from('inventory_notifications').delete().eq('instance_id', instanceId).in('kind', alert.claims);
      return 0;
    }

    await admin.from('inventory_notifications').update({ recipients }).eq('instance_id', instanceId).in('kind', alert.claims);
    return recipients;
  } catch (e) {
    console.error('[inventory] physical-count-done notification failed', e);
    return 0;
  }
}

/**
 * Tell whoever manages inventories about stock close to its expiry date, when
 * a count of a template that asks for it is completed.
 *
 * Only templates with short_shelf_life_months set — today Complementarios,
 * at three months — and only when something is actually short: no alert that
 * says "nothing to report". The same list is shown on the inventory page, so
 * nobody depends on having push switched on to see it.
 *
 * Sent to everyone with inventory.manage_instances, the person who completed
 * the count included: unlike "the count is finished", this is news to them
 * too. Claimed once in the ledger, released if nobody could be reached.
 * Never throws.
 */
export async function notifyShortShelfLife(instanceId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_instances')
      .select(`
        id, name_snapshot, iso_week, inventory_date,
        template:inventory_templates ( short_shelf_life_months ),
        items:inventory_instance_items ( id, item_name, entries:inventory_entries ( quantity, expiry_date ) )
      `)
      .eq('id', instanceId)
      .maybeSingle();
    if (error || !data) return 0;
    const inv = data as unknown as {
      id: string; name_snapshot: string; iso_week: number; inventory_date: string;
      template: { short_shelf_life_months: number | null } | null;
      items: { id: string; item_name: string; entries: { quantity: number | null; expiry_date: string | null }[] }[] | null;
    };

    const months = inv.template?.short_shelf_life_months;
    if (!months) return 0;

    const lines = shortShelfLife(inv.items ?? [], inv.inventory_date, months);
    if (lines.length === 0) return 0;

    const { error: claimError } = await admin
      .from('inventory_notifications')
      .insert({ instance_id: instanceId, kind: 'short_shelf_life', recipients: 0 });
    if (claimError) return 0;

    const { title, body } = shortShelfLifeAlert(inv.name_snapshot, inv.iso_week, months, lines);
    const recipients = await sendToPermissionHolders('inventory.manage_instances', {
      title,
      body,
      // Its own tag: it must not replace the "count finished" card sent a
      // moment earlier, which the digital side still needs.
      tag: `inventory-shelf-life-${instanceId}`,
      url: `/inventory/${instanceId}`,
      level: 'warning',
    });

    const ledger = admin.from('inventory_notifications');
    if (recipients === 0) {
      await ledger.delete().eq('instance_id', instanceId).eq('kind', 'short_shelf_life');
      return 0;
    }
    await ledger.update({ recipients }).eq('instance_id', instanceId).eq('kind', 'short_shelf_life');
    return recipients;
  } catch (e) {
    console.error('[inventory] short-shelf-life notification failed', e);
    return 0;
  }
}
