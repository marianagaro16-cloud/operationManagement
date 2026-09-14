/**
 * What a reminder or personal task can point at.
 *
 * Stored as one real foreign key column per kind (at most one set), never as a
 * copy of the entity. Everything the UI shows about the linked record — its
 * name, number, date — is read from that record at display time.
 */

export const LINK_TYPES = [
  'customer',
  'order',
  'incident',
  'goods_reception',
  'task',
  'inventory',
  'product',
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_COLUMN: Record<LinkType, string> = {
  customer: 'customer_id',
  order: 'order_id',
  incident: 'incident_id',
  goods_reception: 'goods_reception_id',
  task: 'task_id',
  inventory: 'inventory_instance_id',
  product: 'product_id',
};

export function isLinkType(value: unknown): value is LinkType {
  return typeof value === 'string' && (LINK_TYPES as readonly string[]).includes(value);
}

/** The shape the list and detail queries embed for each kind. */
export interface LinkedRecords {
  customer_id: string | null;
  order_id: string | null;
  incident_id: string | null;
  goods_reception_id: string | null;
  task_id: string | null;
  inventory_instance_id: string | null;
  product_id: string | null;
  customer?: { id: string; name: string } | null;
  order?: { id: string; reference: number } | null;
  incident?: { id: string; incident_number: string | null } | null;
  goods_reception?: { id: string; reception_number: string | null } | null;
  task?: { id: string; title: string } | null;
  inventory?: { id: string; name_snapshot: string; inventory_date: string } | null;
  product?: { id: string; code: string | null; name: string | null; family: string; presentation: string | null } | null;
}

export interface ResolvedLink {
  type: LinkType;
  id: string;
  /** Null when the record exists but the viewer cannot read it, or it is gone. */
  label: string | null;
  href: string;
}

/**
 * Where a linked record opens.
 *
 * Customers, products and task definitions have no page of their own: they
 * are edited in dialogs on their manager screens. A customer opens its orders,
 * which is what the existing order detail already links to; a task and a
 * product open their managers, which accept ?edit= for tasks.
 */
export function linkHref(type: LinkType, id: string): string {
  switch (type) {
    case 'customer':        return `/orders?customer=${id}`;
    case 'order':           return `/orders/${id}`;
    case 'incident':        return `/incidents/${id}`;
    case 'goods_reception': return `/goods-reception/${id}`;
    case 'task':            return `/admin/tasks?edit=${id}`;
    case 'inventory':       return `/inventory/${id}`;
    case 'product':         return `/admin/products`;
  }
}

export function resolveLink(row: LinkedRecords): ResolvedLink | null {
  for (const type of LINK_TYPES) {
    const id = row[LINK_COLUMN[type] as keyof LinkedRecords] as string | null;
    if (!id) continue;
    return { type, id, label: linkLabel(type, row), href: linkHref(type, id) };
  }
  return null;
}

function linkLabel(type: LinkType, row: LinkedRecords): string | null {
  switch (type) {
    case 'customer':        return row.customer?.name ?? null;
    case 'order':           return row.order ? `#${row.order.reference}` : null;
    case 'incident':        return row.incident?.incident_number ?? null;
    case 'goods_reception': return row.goods_reception?.reception_number ?? null;
    case 'task':            return row.task?.title ?? null;
    case 'inventory':
      return row.inventory ? `${row.inventory.name_snapshot} · ${row.inventory.inventory_date}` : null;
    case 'product': {
      const p = row.product;
      if (!p) return null;
      const name = p.name || (p.presentation ? `${p.family} — ${p.presentation}` : p.family);
      return p.code ? `${p.code} · ${name}` : name;
    }
  }
}

/** The PostgREST embed for every kind, shared by reminders and personal tasks. */
export const LINK_EMBEDS = `
  customer_id, order_id, incident_id, goods_reception_id, task_id, inventory_instance_id, product_id,
  customer:customers ( id, name ),
  order:orders ( id, reference ),
  incident:incidents ( id, incident_number ),
  goods_reception:goods_receptions ( id, reception_number ),
  task:tasks ( id, title ),
  inventory:inventory_instances ( id, name_snapshot, inventory_date ),
  product:products ( id, code, name, family, presentation )
`;
