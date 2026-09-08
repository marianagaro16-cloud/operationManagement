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

export type AuditSource = 'inventory' | 'order' | 'task' | 'incident';

export interface OperationalAuditRow {
  id: string;
  source: AuditSource;
  action: string;
  created_at: string;
  actor: Pick<Profile, 'id' | 'name' | 'email'> | null;
  detail: Record<string, unknown> | null;
}

/**
 * The operational trail.
 *
 * ONE query against the `operational_audit` view, which unions the three
 * module logs into a common shape in SQL.
 *
 * It used to read 100 rows from each of two tables and merge them in memory,
 * then slice 100 from the sorted result — so the busier module pushed the
 * quieter one off a page that claimed to be the whole trail, and an offset
 * could not be expressed at all. Now the ordering and the limit apply across
 * every source at once, which is what makes both filtering and paging correct.
 *
 * Actors are resolved in a second query rather than embedded: a UNION view
 * carries no foreign keys, so PostgREST cannot infer the relationship to
 * profiles. It is one small indexed lookup over the distinct ids on the page.
 */
export async function getOperationalAudit(
  limit = 100,
  options: { source?: AuditSource; offset?: number } = {},
): Promise<OperationalAuditRow[]> {
  const supabase = createClient();
  const offset = options.offset ?? 0;

  let query = supabase
    .from('operational_audit')
    .select('id, source, action, actor_id, created_at, previous_value, new_value')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Filtering in SQL, not after truncation.
  if (options.source) query = query.eq('source', options.source);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as {
    id: string;
    source: AuditSource;
    action: string;
    actor_id: string | null;
    created_at: string;
    previous_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
  }[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))];
  const actors = new Map<string, OperationalAuditRow['actor']>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email')
      .in('id', actorIds);
    for (const p of (profiles ?? []) as Pick<Profile, 'id' | 'name' | 'email'>[]) {
      actors.set(p.id, p);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    action: r.action,
    created_at: r.created_at,
    actor: r.actor_id ? actors.get(r.actor_id) ?? null : null,
    // The same normalisation the in-memory merge did: the order log carries a
    // single blob, the other two a before/after pair.
    detail: r.new_value ?? r.previous_value,
  }));
}
