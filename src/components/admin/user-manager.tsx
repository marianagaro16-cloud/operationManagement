'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { deleteUser, setUserRole, setUserStatus, setUserTeam } from '@/server/actions';
import { ROLES, TEAMS, type Role, type Team } from '@/lib/authz';
import type { Profile, UserStatus } from '@/types/database';

const STATUS_TONE = {
  pending: 'warn',
  approved: 'done',
  rejected: 'late',
  deactivated: 'skipped',
} as const;

// Privilege reads as colour: the more a role can do, the louder the badge.
const ROLE_TONE = {
  admin: 'accent',
  manager: 'done',
  power_user: 'warn',
  production_manager: 'warn',
  user: 'neutral',
} as const;

/*
 * The team narrows a User's tasks and a Production manager's incidents
 * (see teamScope() and incidentScope()).
 * Admin, Manager and Power User see everything, so asking for theirs would
 * be asking for a value that changes nothing.
 */
const TEAM_MATTERS: ReadonlySet<Role> = new Set<Role>(['user', 'production_manager']);

export function UserManager({ users, currentUserId }: { users: Profile[]; currentUserId: string }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    user: Profile;
    /** A status to set, or 'delete' to remove the account. */
    status: UserStatus | 'delete';
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

  function apply(userId: string, status: UserStatus | 'delete') {
    startTransition(async () => {
      const res = status === 'delete' ? await deleteUser(userId) : await setUserStatus(userId, status);
      if (!res.ok) {
        setError(
          res.error === 'last_admin' ? t('roles.lastAdmin')
          : res.error === 'cannot_delete_self' ? t('admin.cannotDeleteSelf')
          : res.error,
        );
      }
      setConfirm(null);
      router.refresh();
    });
  }

  const roleLabel = (role: Role) => {
    switch (role) {
      case 'admin': return t('roles.admin');
      case 'manager': return t('roles.manager');
      case 'power_user': return t('roles.powerUser');
      case 'production_manager': return t('roles.productionManager');
      case 'user': return t('roles.user');
    }
  };

  const teamLabel = (team: Team) =>
    team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations');

  function changeTeam(user: Profile, team: Team) {
    if (team === user.team) return;
    startTransition(async () => {
      const res = await setUserTeam(user.id, team);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  /*
   * A picker for a User, set before approval too so they start on the right
   * team; a fixed badge for a Production manager, whose team the database
   * forces to Producción.
   */
  const teamControl = (user: Profile) => {
    if (!TEAM_MATTERS.has(user.role)) return null;
    if (user.role === 'production_manager') {
      return <Badge tone="neutral">{teamLabel('production')}</Badge>;
    }
    return (
      <Select
        aria-label={t('roles.team')}
        title={t('roles.teamHint')}
        className="h-8 w-auto py-0 text-[12.5px]"
        value={user.team}
        disabled={pending}
        onChange={(e) => changeTeam(user, e.target.value as Team)}
      >
        {TEAMS.map((team) => (
          <option key={team} value={team}>{teamLabel(team)}</option>
        ))}
      </Select>
    );
  };

  function changeRole(user: Profile, role: Role) {
    if (role === user.role) return;
    startTransition(async () => {
      const res = await setUserRole(user.id, role);
      // Refuse to strip the final admin, which would lock everyone out.
      if (!res.ok) setError(res.error === 'last_admin' ? t('roles.lastAdmin') : res.error);
      router.refresh();
    });
  }

  const row = (user: Profile) => (
    <li key={user.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
      {/* A floor under the name: with a team and a role picker beside it, the
          controls wrap to their own line rather than squeezing the name out. */}
      <div className="min-w-[11rem] flex-1">
        <p className="truncate text-[13.5px] font-medium">{user.name ?? '—'}</p>
        <p className="truncate text-[12px] text-muted">{user.email}</p>
      </div>

      <Badge tone={ROLE_TONE[user.role]}>{roleLabel(user.role)}</Badge>
      <Badge tone={STATUS_TONE[user.status]}>{statusLabel(user.status)}</Badge>

      <span className="hidden w-24 shrink-0 text-right text-[11.5px] tabular text-subtle sm:inline">
        {formatDate(user.created_at.slice(0, 10), 'short')}
      </span>

      <div className="flex shrink-0 flex-wrap gap-1">
        {user.status !== 'rejected' && user.status !== 'deactivated' && teamControl(user)}

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
            {/* A picker rather than the old admin/not-admin toggle: with four
                roles there is no longer an "other" one to flip to. */}
            <Select
              aria-label={t('roles.changeRole')}
              className="h-8 w-auto py-0 text-[12.5px]"
              value={user.role}
              disabled={pending}
              onChange={(e) => changeRole(user, e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </Select>
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

        {user.id !== currentUserId && (
          <Button
            size="sm"
            variant="ghost"
            className="text-late"
            disabled={pending}
            onClick={() =>
              setConfirm({ user, status: 'delete', message: t('admin.deleteUserConfirm'), destructive: true })
            }
          >
            {t('admin.deleteUser')}
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
        title={confirm ? displayName(confirm.user) : ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.status === 'delete' ? t('admin.deleteUser') : t('common.confirm')}
        cancelLabel={t('common.cancel')}
        destructive={confirm?.destructive}
        onConfirm={() => confirm && apply(confirm.user.id, confirm.status)}
      />
    </>
  );
}
