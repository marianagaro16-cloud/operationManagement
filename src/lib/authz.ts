/**
 * Authorization vocabulary — the single place the app describes who may do what.
 *
 * Before this existed, ~20 files independently re-derived `profile.role === 'admin'`.
 * Adding a third role to that arrangement would have meant finding every one of
 * them and hoping none was missed.
 *
 * Pure and synchronous on purpose, exactly like `src/domain/*`: it takes a role
 * and a resolved capability set and answers questions about them. Fetching the
 * capability set is the server's job (`getViewer()` in `src/server/data.ts`).
 *
 * This mirrors the database and does not replace it. `has_permission()` in
 * Postgres is the boundary; everything here is so the UI can avoid offering an
 * action that would be rejected. If the two ever disagree, the database wins.
 */

export const ROLES = ['admin', 'manager', 'power_user', 'user'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The hierarchy as a number.
 *
 * Deliberately not the array index: `ROLES` is ordered most-privileged-first for
 * display, and a rank that fell out of that ordering would invert the moment
 * someone reordered the list for the UI.
 */
export const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  manager: 3,
  power_user: 2,
  user: 1,
};

/**
 * Every capability, matching `permission_catalog` in
 * `supabase/migrations/20260908090100_role_permissions.sql`. Keys are stable
 * identifiers, never display text — the labels live in the i18n dictionaries.
 */
export const PERMISSIONS = [
  // operational CONFIGURATION — the manager / power-user line
  'inventory.manage_templates',
  'tasks.manage_definitions',
  'orders.manage_config',
  'products.change_code',

  // operational MANAGEMENT
  'orders.manage',
  'orders.correct_completed',
  'customers.manage',
  'products.manage',
  'inventory.manage_instances',
  'inventory.resolve_differences',
  'inventory.grant_temporary_edit',
  'tasks.manage_occurrences',
  'reports.view',
  'reports.export',

  // incidents — create/investigate/resolve is shared with the Power User;
  // closing and configuring the vocabulary are the Manager's.
  'incidents.manage',
  'incidents.close',
  'incidents.view_all',
  'incidents.manage_config',

  // ADMIN-ONLY — listed so the matrix can render them locked, never grantable
  'users.manage',
  'users.approve',
  'roles.assign',
  'permissions.configure',
  'system.configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The capabilities no role but ADMIN may ever hold.
 *
 * The database enforces this structurally — `role_permissions` has a CHECK on
 * the role and a trigger on the permission — so this constant is for the UI's
 * benefit, to draw the locked rows. It is not what makes the rule true.
 */
export const ADMIN_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  'users.manage',
  'users.approve',
  'roles.assign',
  'permissions.configure',
  'system.configure',
]);

export function isConfigurable(permission: Permission): boolean {
  return !ADMIN_ONLY.has(permission);
}

/** Roles whose capabilities are configurable. Admin holds all; user holds none. */
export const CONFIGURABLE_ROLES = ['manager', 'power_user'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

/**
 * A permission key in a form the i18n dictionary can hold.
 *
 * `t()` addresses nested keys by splitting on '.', so 'inventory.manage_templates'
 * would be looked up as three levels of nesting and never found. Flattened to
 * camelCase — `inventoryManageTemplates` — it is one leaf under `permission`.
 */
export function permissionKey(permission: Permission): string {
  return permission.replace(/[._](\w)/g, (_, c: string) => c.toUpperCase());
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Hierarchy comparison. `atLeast('manager', 'power_user')` is true. */
export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Does this viewer hold this capability?
 *
 * Admin short-circuits, matching `has_permission()` in SQL: an admin's access
 * never depends on matrix rows, so it cannot be reduced by editing the matrix.
 */
export function can(role: Role, caps: ReadonlySet<Permission>, permission: Permission): boolean {
  return role === 'admin' || caps.has(permission);
}

/**
 * May this role be removed from this user?
 *
 * The app has always refused to strip the last admin so nobody can lock
 * themselves out. Under two roles that read as "demoting to 'user'"; under four
 * it has to be "changing to anything that is not admin", or demoting the final
 * admin to `manager` would walk straight past the guard.
 */
export function wouldOrphanAdmins(params: {
  currentRole: Role;
  nextRole: Role;
  approvedAdminCount: number;
}): boolean {
  const { currentRole, nextRole, approvedAdminCount } = params;
  if (currentRole !== 'admin' || nextRole === 'admin') return false;
  return approvedAdminCount <= 1;
}
