'use client';

import { Clock, ShieldX, UserX } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Card, CardBody } from '@/components/ui/primitives';
import { SignOutButton } from './sign-out-button';
import { LanguageSelector } from './language-selector';
import type { UserStatus } from '@/types/database';

const ICONS = {
  pending: Clock,
  rejected: ShieldX,
  deactivated: UserX,
} as const;

/**
 * Shown instead of the dashboard whenever the account is not approved.
 * The real gate is RLS — an unapproved user's queries return nothing — this
 * simply explains why.
 */
export function AccountStatusScreen({ status }: { status: Exclude<UserStatus, 'approved'> }) {
  const { t } = useI18n();
  const Icon = ICONS[status];

  const title = t(`auth.${status}Title` as 'auth.pendingTitle');
  const body = t(`auth.${status}Body` as 'auth.pendingBody');

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardBody className="pt-6 text-center">
          <div
            className={
              'mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full ' +
              (status === 'pending' ? 'bg-warn/10 text-warn' : 'bg-late/10 text-late')
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <h1 className="text-[15px] font-semibold">{title}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <LanguageSelector compact />
            <SignOutButton />
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
