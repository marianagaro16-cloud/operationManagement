'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge, Card, Checkbox, EmptyState, ErrorState } from '@/components/ui/primitives';
import { setReceptionAssignee } from '@/server/goods-reception-actions';
import { useReceptionError } from '@/components/goods-reception/reception-bits';
import type { Profile } from '@/types/database';

/**
 * Who may register an incoming delivery.
 *
 * §10 and §48. This list is the grant — there is no permission-matrix row for
 * "may perform a reception", because `role_permissions` carries a CHECK
 * constraint allowing only 'manager' and 'power_user', and the person
 * receiving goods on the floor is a plain user. Assignment is how this
 * codebase has always given a plain user authority (inventory does the same),
 * and it is the only mechanism that can.
 *
 * Being an Admin, Manager or Power User is NOT an assignment. Those roles
 * hold `goods_reception.manage_all`, which lets them correct any reception —
 * a different authority, and one this screen does not confer or remove.
 */
export function ReceptionAssignees({
  users,
  assigned,
}: {
  users: Profile[];
  assigned: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optimistic, so a list of a dozen people does not flash on every tick.
  const [held, setHeld] = useState(() => new Set(assigned));

  function toggle(userId: string, on: boolean) {
    setHeld((prev) => {
      const next = new Set(prev);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });

    startTransition(async () => {
      const res = await setReceptionAssignee(userId, on);
      if (!res.ok) {
        setError(translateError(res.error));
        // Put the box back: the database refused, so the UI must not claim it.
        setHeld((prev) => {
          const next = new Set(prev);
          if (on) next.delete(userId);
          else next.add(userId);
          return next;
        });
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const approved = users.filter((u) => u.status === 'approved');

  return (
    <>
      <PageHeader title={t('gr.assigneesTitle')} subtitle={t('gr.assigneesSubtitle')} />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {held.size === 0 && (
        <div className="mb-3">
          <EmptyState
            title={t('gr.assigneesEmpty')}
            body={t('gr.assigneesEmptyBody')}
            icon={<UserCheck className="h-5 w-5" aria-hidden />}
          />
        </div>
      )}

      <ul className="space-y-1.5">
        {approved.map((user) => (
          <li key={user.id}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <Checkbox
                label={displayName(user)}
                hint={user.email}
                checked={held.has(user.id)}
                disabled={pending}
                onChange={(e) => toggle(user.id, e.target.checked)}
              />
              {held.has(user.id) && (
                <Badge tone="done" className="shrink-0">
                  {t('gr.assigned')}
                </Badge>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
