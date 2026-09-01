'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { setUserRole, setUserStatus } from '@/server/actions';
import type { Profile, UserStatus } from '@/types/database';

const STATUS_TONE = {
  pending: 'warn',
  approved: 'done',
  rejected: 'late',
  deactivated: 'skipped',
} as const;

export function UserManager({ users, currentUserId }: { users: Profile[]; currentUserId: string }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    user: Profile;
    status: UserStatus;
    message: string;
    destructive?: boolean;
  } | null>(null);

  const pendingUsers = users.filter((u) => u.status === 'pending');
  const others = users.filter((u) => u.status !== 'pending');

  /** Account status reuses the existing status vocabulary. */
  const statusLabel = (status: UserStatus) => {
    switch (status) {
      case 'pending': return t('status.pending');
      case 'approved': return t('status.active');
      case 'rejected': return t('admin.reject');
      case 'deactivated': return t('status.inactive');
    }
  };

  function apply(userId: string, status: UserStatus) {
    startTransition(async () => {
      const res = await setUserStatus(userId, status);
      if (!res.ok) setError(res.error);
      setConfirm(null);
      router.refresh();
    });
  }

  function toggleRole(user: Profile) {
    startTransition(async () => {
      const res = await setUserRole(user.id, user.role === 'admin' ? 'user' : 'admin');
      // Refuse to strip the final admin, which would lock everyone out.
      if (!res.ok) setError(res.error === 'last_admin' ? t('common.error') : res.error);
      router.refresh();
    });
  }

  const row = (user: Profile) => (
    <li key={user.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{user.name ?? '—'}</p>
        <p className="truncate text-[12px] text-muted">{user.email}</p>
      </div>

      <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
        {user.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser')}
      </Badge>
      <Badge tone={STATUS_TONE[user.status]}>{statusLabel(user.status)}</Badge>

      <span className="hidden w-24 shrink-0 text-right text-[11.5px] tabular text-subtle sm:inline">
        {formatDate(user.created_at.slice(0, 10), 'short')}
      </span>

      <div className="flex shrink-0 gap-1">
        {user.status === 'pending' && (
          <>
            <Button
              size="sm"
              variant="success"
              disabled={pending}
              onClick={() =>
                setConfirm({ user, status: 'approved', message: t('admin.approveConfirm') })
              }
            >
              {t('admin.approve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                setConfirm({ user, status: 'rejected', message: t('admin.rejectConfirm'), destructive: true })
              }
            >
              {t('admin.reject')}
            </Button>
          </>
        )}

        {user.status === 'approved' && user.id !== currentUserId && (
          <>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggleRole(user)}>
              {user.role === 'admin' ? t('admin.removeAdmin') : t('admin.makeAdmin')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                setConfirm({
                  user,
                  status: 'deactivated',
                  message: t('admin.deactivateUserConfirm'),
                  destructive: true,
                })
              }
            >
              {t('admin.deactivateUser')}
            </Button>
          </>
        )}

        {(user.status === 'deactivated' || user.status === 'rejected') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => apply(user.id, 'approved')}
          >
            {t('admin.reactivate')}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title={t('admin.usersTitle')} subtitle={t('admin.usersSubtitle')} />

      {error && <div className="mb-4"><ErrorState message={error} /></div>}

      {/* Pending accounts are surfaced first and visually distinct — an
          unapproved colleague is blocked from working until seen. */}
      <section className="mb-6">
        <h2 className="mb-2 text-[13px] font-semibold">{t('admin.pendingUsers')}</h2>
        {pendingUsers.length === 0 ? (
          <EmptyState title={t('admin.noPendingUsers')} />
        ) : (
          <Card className="overflow-hidden border-warn/30">
            <ul className="divide-y divide-border">{pendingUsers.map(row)}</ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">{t('admin.usersTitle')}</h2>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">{others.map(row)}</ul>
        </Card>
      </section>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        loading={pending}
        title={confirm?.user.name ?? confirm?.user.email ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        destructive={confirm?.destructive}
        onConfirm={() => confirm && apply(confirm.user.id, confirm.status)}
      />
    </>
  );
}
