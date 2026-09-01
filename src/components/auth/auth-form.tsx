'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState, Field, Input } from '@/components/ui/primitives';
import { LanguageSelector } from '@/components/shell/language-selector';

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      setLoading(false);
      if (error) return setError(error.message);
      // Access is NOT granted here — a trigger created a pending profile.
      return setRegistered(true);
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(t('auth.invalidCredentials'));
    router.push('/dashboard');
    router.refresh();
  }

  if (registered) {
    return (
      <Card className="w-full max-w-sm">
        <CardBody className="pt-5 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-done" aria-hidden />
          <h1 className="text-[15px] font-semibold">{t('auth.pendingTitle')}</h1>
          <p className="mt-1.5 text-[13px] text-muted">{t('auth.registerSuccess')}</p>
          <Button className="mt-5 w-full" variant="secondary" onClick={() => router.push('/login')}>
            {t('auth.signIn')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardBody className="pt-5">
        <h1 className="text-lg font-semibold">
          {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          {mode === 'signin' ? t('auth.signInSubtitle') : t('auth.signUpSubtitle')}
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3.5">
          {mode === 'signup' && (
            <Field label={t('auth.name')} htmlFor="name" required>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </Field>
          )}

          <Field label={t('auth.email')} htmlFor="email" required>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              required
            />
          </Field>

          <Field label={t('auth.password')} htmlFor="password" required>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </Field>

          {error && <ErrorState message={error} />}

          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={loading}>
            {mode === 'signin' ? t('auth.signInCta') : t('auth.signUpCta')}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <Link
            href={mode === 'signin' ? '/register' : '/login'}
            className="text-[13px] text-accent hover:underline"
          >
            {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
          </Link>
          <LanguageSelector compact />
        </div>
      </CardBody>
    </Card>
  );
}
