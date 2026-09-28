'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState, Field, Input } from '@/components/ui/primitives';
import { LanguageSelector } from './language-selector';
import { SignOutButton } from './sign-out-button';
import { chooseOwnPassword } from '@/server/password-actions';
import { MIN_PASSWORD_LENGTH } from '@/domain/auth/temp-password';

/**
 * After an Admin reset the password: nothing else in the app until the
 * person chooses their own, so the temporary one never stays in use.
 */
export function ChoosePasswordScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const differ = repeat.length > 0 && repeat !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && repeat === password;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await chooseOwnPassword(password);
      if (!res.ok) {
        return setError(res.error === 'password_too_short' ? t('auth.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) : res.error);
      }
      router.refresh();
    });
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardBody className="pt-6">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
            <KeyRound className="h-5 w-5" aria-hidden />
          </div>
          <h1 className="text-center text-[15px] font-semibold">{t('auth.choosePasswordTitle')}</h1>
          <p className="mt-1.5 text-center text-[13px] leading-relaxed text-muted">{t('auth.choosePasswordBody')}</p>

          <form onSubmit={submit} className="mt-4 space-y-3">
            <Field
              label={t('auth.newPassword')}
              htmlFor="new-password"
              error={tooShort ? t('auth.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) : undefined}
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field
              label={t('auth.repeatPassword')}
              htmlFor="repeat-password"
              error={differ ? t('auth.passwordsDiffer') : undefined}
            >
              <Input
                id="repeat-password"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Field>
            {error && <ErrorState message={error} />}
            <Button type="submit" variant="primary" className="w-full justify-center" loading={pending} disabled={!ready}>
              {t('auth.savePassword')}
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <LanguageSelector compact />
            <SignOutButton />
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
