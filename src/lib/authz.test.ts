import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY,
  CONFIGURABLE_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_RANK,
  atLeast,
  can,
  isConfigurable,
  incidentScope,
  isRole,
  ordersReadOnly,
  permissionKey,
  teamScope,
  wouldOrphanAdmins,
  type Permission,
} from './authz';

describe('role hierarchy', () => {
  it('ranks admin above manager above power user above user', () => {
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.power_user);
    expect(ROLE_RANK.power_user).toBeGreaterThan(ROLE_RANK.user);
  });

  it('compares with atLeast', () => {
    expect(atLeast('manager', 'power_user')).toBe(true);
    expect(atLeast('power_user', 'manager')).toBe(false);
    expect(atLeast('user', 'user')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
  });

  // The ordering of ROLES is for display; rank must not be derived from it.
  it('does not derive rank from the declaration order', () => {
    const byDeclaration = [...ROLES].map((r) => ROLE_RANK[r]);
    // The production manager sits beside the power user: same rank, listed after it.
    expect(byDeclaration).toEqual([4, 3, 2, 2, 1]);
  });

  it('recognises only real roles', () => {
    expect(isRole('manager')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
  });
});

describe('can', () => {
  const none = new Set<Permission>();
  const some = new Set<Permission>(['orders.manage']);

  it('grants an admin everything, matrix or not', () => {
    expect(can('admin', none, 'orders.manage')).toBe(true);
    expect(can('admin', none, 'permissions.configure')).toBe(true);
  });

  it('grants a non-admin only what the matrix holds', () => {
    expect(can('manager', some, 'orders.manage')).toBe(true);
    expect(can('manager', some, 'inventory.manage_templates')).toBe(false);
    expect(can('user', none, 'orders.manage')).toBe(false);
  });
});

describe('admin-only capabilities', () => {
  it('never treats an admin-only capability as configurable', () => {
    for (const p of ADMIN_ONLY) expect(isConfigurable(p)).toBe(false);
  });

  it('keeps user management, role assignment and permission config admin-only', () => {
    expect(isConfigurable('users.manage')).toBe(false);
    expect(isConfigurable('roles.assign')).toBe(false);
    expect(isConfigurable('permissions.configure')).toBe(false);
  });

  it('leaves the operational capabilities configurable', () => {
    expect(isConfigurable('orders.manage')).toBe(true);
    expect(isConfigurable('inventory.manage_templates')).toBe(true);
  });

  it('offers manager, power_user and production_manager as configurable roles', () => {
    expect([...CONFIGURABLE_ROLES]).toEqual(['manager', 'power_user', 'production_manager']);
  });
});

describe('team scope', () => {
  it("confines a plain user's tasks to their team, and nobody else's", () => {
    expect(teamScope('user', 'operations')).toBe('operations');
    expect(teamScope('production_manager', 'production')).toBeNull();
  });

  it('confines the incidents a production manager manages to their team', () => {
    expect(incidentScope('production_manager', 'production')).toBe('production');
    for (const role of ['admin', 'manager', 'power_user', 'user'] as const) {
      expect(incidentScope(role, 'production')).toBeNull();
    }
  });

  it('leaves admin, manager and power user unscoped whatever their team', () => {
    expect(teamScope('admin', 'production')).toBeNull();
    expect(teamScope('manager', 'operations')).toBeNull();
    expect(teamScope('power_user', 'production')).toBeNull();
  });

  it('makes orders read-only for the production manager alone', () => {
    expect(ordersReadOnly('production_manager')).toBe(true);
    for (const role of ['admin', 'manager', 'power_user', 'user'] as const) {
      expect(ordersReadOnly(role)).toBe(false);
    }
  });

  it('opens the management area to the production manager', () => {
    expect(atLeast('production_manager', 'power_user')).toBe(true);
    expect(atLeast('production_manager', 'manager')).toBe(false);
  });
});

describe('permissionKey', () => {
  // t() splits on '.', so a key with dots would be read as nesting.
  it('flattens dots and underscores to camelCase', () => {
    expect(permissionKey('inventory.manage_templates')).toBe('inventoryManageTemplates');
    expect(permissionKey('reports.view')).toBe('reportsView');
    expect(permissionKey('orders.correct_completed')).toBe('ordersCorrectCompleted');
  });

  it('produces a key with no dots for every permission', () => {
    for (const p of PERMISSIONS) expect(permissionKey(p)).not.toContain('.');
  });

  it('produces a distinct key per permission', () => {
    expect(new Set(PERMISSIONS.map(permissionKey)).size).toBe(PERMISSIONS.length);
  });
});

describe('wouldOrphanAdmins', () => {
  // The old guard asked "is the new role 'user'", which four roles broke:
  // demoting the last admin to manager walked straight past it.
  it('blocks demoting the last admin to ANY other role', () => {
    for (const nextRole of ['manager', 'power_user', 'user'] as const) {
      expect(wouldOrphanAdmins({ currentRole: 'admin', nextRole, approvedAdminCount: 1 })).toBe(true);
    }
  });

  it('allows demoting an admin while another remains', () => {
    expect(
      wouldOrphanAdmins({ currentRole: 'admin', nextRole: 'manager', approvedAdminCount: 2 }),
    ).toBe(false);
  });

  it('never blocks a promotion to admin', () => {
    expect(
      wouldOrphanAdmins({ currentRole: 'user', nextRole: 'admin', approvedAdminCount: 1 }),
    ).toBe(false);
  });

  it('ignores changes that do not touch an admin', () => {
    expect(
      wouldOrphanAdmins({ currentRole: 'manager', nextRole: 'user', approvedAdminCount: 1 }),
    ).toBe(false);
  });

  it('treats a re-assignment of admin to admin as no change', () => {
    expect(
      wouldOrphanAdmins({ currentRole: 'admin', nextRole: 'admin', approvedAdminCount: 1 }),
    ).toBe(false);
  });
});
