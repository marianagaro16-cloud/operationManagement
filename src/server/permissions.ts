import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { CONFIGURABLE_ROLES, type ConfigurableRole, type Permission } from '@/lib/authz';
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
  return Object.fromEntries(
    CONFIGURABLE_ROLES.map((role) => [role, rows.filter((r) => r.role === role).map((r) => r.permission)]),
  ) as Record<ConfigurableRole, Permission[]>;
}
