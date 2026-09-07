import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ConfigurableRole, Permission } from '@/lib/authz';
import type { Profile } from '@/types/database';

/**
 * Reads for the permission matrix and the audit screens.
 *
 * The matrix itself is small — a couple of dozen catalogue rows and at most
 * twice that many grants — so it is fetched whole. The audit logs are not, and
 * are always paged.
 */

export interface CatalogEntry {
  key: Permission;
  module: string;
  is_configurable: boolean;
  sort_order: number;
}

export async function getPermissionCatalog(): Promise<CatalogEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('permission_catalog')
    .select('key, module, is_configurable, sort_order')
    .order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogEntry[];
}

/** Which capabilities each configurable role currently holds. */
export async function getRoleMatrix(): Promise<Record<ConfigurableRole, Permission[]>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('role_permissions').select('role, permission');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { role: ConfigurableRole; permission: Permission }[];
  return {
    manager: rows.filter((r) => r.role === 'manager').map((r) => r.permission),
    power_user: rows.filter((r) => r.role === 'power_user').map((r) => r.permission),
  };
}

export interface SecurityAuditRow {
  id: string;
  action: string;
  created_at: string;
  actor: Pick<Profile, 'id' | 'name' | 'email'> | null;
  target: Pick<Profile, 'id' | 'name' | 'email'> | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

/**
 * Role changes, status changes, permission edits and product-code changes.
 * Admin-only at the database level, so a manager reaching this returns nothing
 * rather than being told it exists.
 */
export async function getSecurityAudit(limit = 100): Promise<SecurityAuditRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('security_audit_log')
    .select(`
      id, action, created_at, previous_value, new_value,
      actor:profiles!security_audit_log_actor_id_fkey ( id, name, email ),
      target:profiles!security_audit_log_target_user_id_fkey ( id, name, email )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SecurityAuditRow[];
}

export interface OperationalAuditRow {
  id: string;
  source: 'inventory' | 'order';
  action: string;
  created_at: string;
  actor: Pick<Profile, 'id' | 'name' | 'email'> | null;
  detail: Record<string, unknown> | null;
}

/**
 * The operational trail, merged from the two module logs.
 *
 * Both tables have been written by triggers since their modules shipped, but
 * neither was ever read — there was no screen for them. This is that screen's
 * data source.
 *
 * Merged in memory rather than by a SQL union: they are different shapes, the
 * combined volume per page is small, and a view would have to be kept in step
 * with two schemas that evolve independently.
 */
export async function getOperationalAudit(limit = 100): Promise<OperationalAuditRow[]> {
  const supabase = createClient();

  const [inventory, orders] = await Promise.all([
    supabase
      .from('inventory_audit_log')
      .select(`
        id, action, created_at, previous_value, new_value,
        actor:profiles!inventory_audit_log_actor_id_fkey ( id, name, email )
      `)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('order_audit_log')
      .select(`
        id, action, created_at, detail,
        actor:profiles!order_audit_log_actor_id_fkey ( id, name, email )
      `)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  type InvRow = {
    id: string; action: string; created_at: string;
    previous_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    actor: OperationalAuditRow['actor'];
  };
  type OrdRow = {
    id: string; action: string; created_at: string;
    detail: Record<string, unknown> | null;
    actor: OperationalAuditRow['actor'];
  };

  const rows: OperationalAuditRow[] = [
    ...((inventory.data ?? []) as unknown as InvRow[]).map((r) => ({
      id: r.id,
      source: 'inventory' as const,
      action: r.action,
      created_at: r.created_at,
      actor: r.actor,
      detail: r.new_value ?? r.previous_value,
    })),
    ...((orders.data ?? []) as unknown as OrdRow[]).map((r) => ({
      id: r.id,
      source: 'order' as const,
      action: r.action,
      created_at: r.created_at,
      actor: r.actor,
      detail: r.detail,
    })),
  ];

  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
