/**
 * Hand-maintained mirror of the inventory tables, matching the convention in
 * ./database.ts. Regenerate the authoritative version with
 *   npx supabase gen types typescript --linked > src/types/database.types.ts
 * once the migration is applied.
 */
import type {
  InventoryFrequency,
  InventoryKind,
  InventorySchedule,
  InventoryStatus,
} from '@/domain/inventory/types';
import type { Profile } from './database';

export type Translations = Record<
  string,
  { name?: string | null; description?: string | null }
> | null;

export interface InventoryLocation {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  translations: Translations;
  kind: InventoryKind;
  frequency: InventoryFrequency;
  schedule_config: InventorySchedule | null;
  digital_enabled: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryTemplateItem {
  id: string;
  template_id: string;
  name: string;
  item_group: string | null;
  translations: Translations;
  product_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryInstance {
  id: string;
  template_id: string;
  inventory_date: string;
  iso_week: number;
  iso_year: number;
  period_key: string;
  /** Frozen at generation, so history survives a template rename. */
  name_snapshot: string;
  kind: InventoryKind;
  digital_enabled: boolean;
  status: InventoryStatus;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryEntry {
  id: string;
  instance_item_id: string;
  instance_id: string;
  /** Null means "not counted", which is not the same as counted zero. */
  quantity: number | null;
  expiry_date: string | null;
  lot_number: string | null;
  location_id: string | null;
  location_name: string | null;
  note: string | null;
  position: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryInstanceItem {
  id: string;
  instance_id: string;
  template_item_id: string;
  item_name: string;
  item_group: string | null;
  item_sort_order: number;
  product_id: string | null;
  /** Trigger-derived sum of the entries. Never written by the client. */
  physical_stock: number;
  /** Inventory Digital. Null renders as "Pending", never as zero. */
  digital_quantity: number | null;
  /** Generated column: physical_stock - digital_quantity, or null. */
  difference: number | null;
  status: InventoryStatus;
  is_resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryResolution {
  id: string;
  instance_item_id: string;
  instance_id: string;
  note: string;
  physical_stock_at: number;
  digital_at: number | null;
  difference_at: number | null;
  resolved_by: string | null;
  resolved_at: string;
  superseded_at: string | null;
}

export interface InventoryDigitalHistoryRow {
  id: string;
  instance_item_id: string;
  instance_id: string;
  previous_digital: number | null;
  new_digital: number | null;
  physical_stock_at: number;
  previous_difference: number | null;
  new_difference: number | null;
  changed_by: string | null;
  changed_at: string;
}

export interface InventoryComment {
  id: string;
  instance_id: string;
  instance_item_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
}

export type InventoryGrantScope = 'instance' | 'all';

export interface InventoryEditGrant {
  id: string;
  user_id: string;
  scope: InventoryGrantScope;
  instance_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  granted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
}

export interface InventoryAuditRow {
  id: string;
  instance_id: string | null;
  instance_item_id: string | null;
  template_id: string | null;
  entry_id: string | null;
  actor_id: string | null;
  action: string;
  previous_value: unknown;
  new_value: unknown;
  created_at: string;
}

/* ---------------------------- joined shapes ---------------------------- */

type Person = Pick<Profile, 'id' | 'name' | 'email'>;

/** An inventory as the overview list renders it. */
export interface InventoryListRow extends InventoryInstance {
  template: Pick<InventoryTemplate, 'id' | 'slug' | 'name' | 'translations'> | null;
  assignees: Person[];
  completed_by_profile: Person | null;
  /** Admin still owes a digital value on at least one item. */
  digital_pending_count: number;
  item_count: number;
  review_count: number;
}

/** One counted line, with everything the detail screen shows. */
export interface InventoryItemDetail extends InventoryInstanceItem {
  entries: InventoryEntry[];
  comments: (InventoryComment & { author: Person | null })[];
  resolutions: (InventoryResolution & { author: Person | null })[];
  digital_history: (InventoryDigitalHistoryRow & { author: Person | null })[];
}

/** The full detail view of one inventory. */
export interface InventoryDetail extends InventoryInstance {
  template: InventoryTemplate | null;
  assignees: Person[];
  completed_by_profile: Person | null;
  items: InventoryItemDetail[];
  general_comments: (InventoryComment & { author: Person | null })[];
  /** Server-computed. The UI must never decide this for itself. */
  can_edit: boolean;
  /** Why editing is closed, so the screen can say so rather than just grey out. */
  lock_reason: 'none' | 'not_assigned' | 'past_deadline' | 'completed' | 'not_approved';
  active_grant: InventoryEditGrant | null;
}

export type {
  InventoryFrequency,
  InventoryKind,
  InventorySchedule,
  InventoryStatus,
};
