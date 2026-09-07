'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card, ErrorState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { setRolePermission } from '@/server/permission-actions';
import { CONFIGURABLE_ROLES, permissionKey, type ConfigurableRole, type Permission } from '@/lib/authz';
import type { MessageKey } from '@/i18n';

interface Row {
  key: Permission;
  module: string;
  is_configurable: boolean;
}

/**
 * The role/permission matrix.
 *
 * Rows are capabilities grouped by module; the two columns are the only roles
 * whose permissions are configurable. ADMIN has no column because it always
 * holds everything, and USER has none because it is the floor — a plain user's
 * access comes from being assigned work, not from this grid.
 *
 * Admin-only capabilities are listed but locked. Showing them greyed is the
 * point: it answers "can I delegate this?" with a visible no, rather than
 * leaving the reader to wonder why user management is missing from the list.
 */
export function RolePermissions({
  catalog,
  matrix,
}: {
  catalog: Row[];
  matrix: Record<ConfigurableRole, Permission[]>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Optimistic local state: a matrix of 15 rows would otherwise flash on every
  // toggle while the server round-trips.
  const [held, setHeld] = useState<Record<ConfigurableRole, Set<Permission>>>({
    manager: new Set(matrix.manager),
    power_user: new Set(matrix.power_user),
  });

  function toggle(role: ConfigurableRole, permission: Permission, enabled: boolean) {
    setHeld((prev) => {
      const next = new Set(prev[role]);
      if (enabled) next.add(permission);
      else next.delete(permission);
      return { ...prev, [role]: next };
    });

    startTransition(async () => {
      const res = await setRolePermission({ role, permission, enabled });
      if (!res.ok) {
        setError(res.error);
        // Put the box back: the database refused, so the UI must not claim it.
        setHeld((prev) => {
          const next = new Set(prev[role]);
          if (enabled) next.delete(permission);
          else next.add(permission);
          return { ...prev, [role]: next };
        });
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const modules = [...new Set(catalog.map((c) => c.module))];
  const roleLabel = (r: ConfigurableRole) =>
    r === 'manager' ? t('roles.manager') : t('roles.powerUser');

  // Permission keys carry dots, which `t()` reads as nesting — so the
  // dictionary holds them flattened to camelCase.
  const label = (p: Permission) => t(`permission.${permissionKey(p)}` as MessageKey);
  const hint = (p: Permission) => t(`permissionHint.${permissionKey(p)}` as MessageKey);

  return (
    <>
      <PageHeader title={t('roles.matrixTitle')} subtitle={t('roles.matrixSubtitle')} />

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      <Card className="overflow-hidden">
        {/* Scrolls inside itself rather than pushing the page sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3.5 py-2.5 font-semibold">{t('roles.capability')}</th>
                {CONFIGURABLE_ROLES.map((r) => (
                  <th key={r} className="w-28 px-3.5 py-2.5 text-center font-semibold">
                    {roleLabel(r)}
                  </th>
                ))}
              </tr>
            </thead>

            {modules.map((mod) => (
              <tbody key={mod}>
                <tr className="border-b border-border bg-bg">
                  <td colSpan={3} className="px-3.5 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">
                    {t(`roles.module.${mod}` as MessageKey)}
                  </td>
                </tr>

                {catalog.filter((c) => c.module === mod).map((row) => (
                  <tr key={row.key} className="border-b border-border last:border-0">
                    <td className="px-3.5 py-2.5">
                      <span className="block font-medium">{label(row.key)}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{hint(row.key)}</span>
                    </td>

                    {row.is_configurable ? (
                      CONFIGURABLE_ROLES.map((r) => (
                        <td key={r} className="px-3.5 py-2.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${label(row.key)} — ${roleLabel(r)}`}
                            className="h-4 w-4 rounded border-border text-accent accent-accent"
                            checked={held[r].has(row.key)}
                            disabled={pending}
                            onChange={(e) => toggle(r, row.key, e.target.checked)}
                          />
                        </td>
                      ))
                    ) : (
                      <td colSpan={2} className="px-3.5 py-2.5 text-center">
                        <Badge tone="neutral">
                          <Lock className="mr-1 inline h-3 w-3" aria-hidden />
                          {t('roles.adminOnly')}
                        </Badge>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">{t('roles.matrixNote')}</p>
    </>
  );
}
