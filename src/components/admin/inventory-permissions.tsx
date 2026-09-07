'use client';

import { useState, useTransition } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { grantInventoryEdit, revokeInventoryEdit } from '@/server/inventory-actions';
import { useInventoryError } from '@/components/inventory/inventory-bits';
import type { InventoryEditGrant } from '@/types/inventory';
import type { Profile } from '@/types/database';

type GrantRow = InventoryEditGrant & {
  user: { id: string; name: string | null; email: string } | null;
  instance: { id: string; name_snapshot: string; inventory_date: string } | null;
};

/**
 * Temporary edit permissions.
 *
 * A grant is how an admin lets somebody finish a count after 18:00, or work
 * on an inventory they were not assigned to. It expires by ceasing to match
 * the RLS predicate rather than by a cleanup job, so it cannot fail to expire
 * because a scheduled run was missed, and it may not span more than one day.
 */
export function InventoryPermissionManager({
  grants,
  users,
  instances,
}: {
  grants: GrantRow[];
  users: Profile[];
  instances: { id: string; name_snapshot: string; inventory_date: string }[];
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t('inventory.permissions')}</h2>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('inventory.grantPermission')}
        </Button>
      </div>

      {error && <ErrorState message={error} />}

      {grants.length === 0 ? (
        <EmptyState
          title={t('inventory.permissions')}
          icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        />
      ) : (
        <ul className="space-y-1.5">
          {grants.map((g) => {
            const expired = new Date(g.ends_at).getTime() < now;
            const active = !g.revoked_at && !expired && new Date(g.starts_at).getTime() <= now;

            return (
              <li key={g.id}>
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium">
                        {g.user ? displayName(g.user) : '—'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {g.scope === 'all'
                          ? t('inventory.scopeAll')
                          : `${g.instance?.name_snapshot ?? ''} · ${g.instance?.inventory_date ?? ''}`}
                      </p>
                      <p className="mt-0.5 text-[12px] text-subtle">
                        {new Date(g.starts_at).toLocaleString()} –{' '}
                        {new Date(g.ends_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      {g.reason && <p className="mt-1 text-[12px] text-muted">{g.reason}</p>}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {g.revoked_at ? (
                        <Badge tone="neutral">{t('inventory.grantRevoked')}</Badge>
                      ) : expired ? (
                        <Badge tone="neutral">{t('inventory.grantExpired')}</Badge>
                      ) : active ? (
                        <Badge tone="done">{t('status.active')}</Badge>
                      ) : (
                        <Badge tone="accent">{t('inventory.upcoming')}</Badge>
                      )}

                      {!g.revoked_at && !expired && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const res = await revokeInventoryEdit(g.id);
                              if (!res.ok) setError(translateError(res.error));
                            })
                          }
                        >
                          {t('inventory.revoke')}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <GrantDialog users={users} instances={instances} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

function GrantDialog({
  users,
  instances,
  onClose,
}: {
  users: Profile[];
  instances: { id: string; name_snapshot: string; inventory_date: string }[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState<'instance' | 'all'>('instance');
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? '');
  // Defaults to "the rest of today": the overwhelmingly common case is
  // finishing a count that ran past 18:00.
  const [start, setStart] = useState(() => localDateTimeValue(new Date()));
  const [end, setEnd] = useState(() => localDateTimeValue(endOfToday()));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sameDay = start.slice(0, 10) === end.slice(0, 10);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('inventory.grantPermission')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!userId || !sameDay || (scope === 'instance' && !instanceId)}
            onClick={() =>
              startTransition(async () => {
                const res = await grantInventoryEdit({
                  user_id: userId,
                  scope,
                  instance_id: scope === 'instance' ? instanceId : null,
                  starts_at: new Date(start).toISOString(),
                  ends_at: new Date(end).toISOString(),
                  reason: reason.trim() || null,
                });
                if (res.ok) onClose();
                else setError(translateError(res.error));
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('inventory.filterUser')} required>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">—</option>
            {users
              .filter((u) => u.status === 'approved')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
          </Select>
        </Field>

        <Field label={t('inventory.grantScope')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'instance' | 'all')}>
            <option value="instance">{t('inventory.scopeInstance')}</option>
            <option value="all">{t('inventory.scopeAll')}</option>
          </Select>
        </Field>

        {scope === 'instance' && (
          <Field label={t('inventory.title')} required>
            <Select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name_snapshot} · {i.inventory_date}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('inventory.startTime')}>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field
            label={t('inventory.endTime')}
            error={!sameDay ? t('inventory.grantSingleDay') : undefined}
          >
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label={t('inventory.grantReason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}

/** `datetime-local` wants a local-clock string, not an ISO instant. */
function localDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 30, 0, 0);
  return d;
}
