'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Bell, CalendarDays, ClipboardList, LayoutDashboard, Package, Settings, Shield } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LanguageSelector } from './language-selector';
import { SignOutButton } from './sign-out-button';
import type { Profile } from '@/types/database';

/**
 * Responsive shell: a bottom tab bar on phones (thumb-reachable, since the
 * operators use this on the warehouse floor) and a sidebar from `md` up.
 */
export function AppShell({ profile, children }: { profile: Profile; children: ReactNode }) {
  const { t, formatDate } = useI18n();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = profile.role === 'admin';

  const nav = [
    { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    // Lot control is the main floor workflow, so it sits high in the bar.
    { href: '/preparation', label: t('prep.title'), icon: ClipboardList },
    { href: '/orders', label: t('orders.title'), icon: Package },
    { href: '/calendar', label: t('nav.calendar'), icon: CalendarDays },
    ...(isAdmin ? [{ href: '/admin', label: t('nav.admin'), icon: Shield }] : []),
  ];

  const active = (href: string) =>
    href === '/admin' ? pathname.startsWith('/admin') : pathname === href;

  const greeting = (() => {
    const hour = Number(
      new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: 'Europe/Zurich' })
        .format(new Date()),
    );
    if (hour < 12) return t('dashboard.greetingMorning');
    if (hour < 18) return t('dashboard.greetingAfternoon');
    return t('dashboard.greetingEvening');
  })();

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());

  return (
    <div className="min-h-dvh bg-bg">
      {/* ---------------- header ---------------- */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">
              {greeting}
              {profile.name ? `, ${profile.name.split(' ')[0]}` : ''}
            </p>
            <p className="truncate text-[12px] text-muted">{formatDate(today, 'weekday')}</p>
          </div>

          <div className="hidden sm:block">
            <LanguageSelector />
          </div>

          {/* Always-visible route to notifications. A link in a menu that has
              to be opened first is a link nobody finds on a phone. */}
          <Link
            href="/settings"
            aria-label={t('push.menuLabel')}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              pathname === '/settings'
                ? 'bg-surface-2 text-fg'
                : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Settings className="h-[18px] w-[18px]" aria-hidden />
          </Link>

          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={t('common.actions')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg"
          >
            {initials(profile.name, profile.email)}
          </button>
        </div>

        {menuOpen && (
          <>
            {/* Tapping anywhere outside closes the menu — expected behaviour
                on a phone, where there is no cursor to move away. */}
            <button
              className="fixed inset-0 z-10 cursor-default"
              aria-hidden
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
            />
            <div className="animate-fade-in relative z-20 border-t border-border bg-surface shadow-pop">
              <div className="mx-auto max-w-5xl px-4 py-3">
                <div className="mb-2">
                  <p className="text-[13px] font-medium">{profile.name ?? profile.email}</p>
                  <p className="text-[12px] text-muted">{profile.email}</p>
                </div>

                {/* Full-width rows with real hit targets: this menu is used
                    one-handed on the warehouse floor. */}
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex touch-target items-center gap-2.5 rounded-lg px-2 py-2.5 text-[13.5px] font-medium transition-colors hover:bg-surface-2"
                >
                  <Bell className="h-4 w-4 text-muted" aria-hidden />
                  {t('push.menuLabel')}
                </Link>

                <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2">
                  <LanguageSelector compact />
                  <SignOutButton />
                </div>
              </div>
            </div>
          </>
        )}
      </header>

      <div className="mx-auto flex max-w-5xl gap-6 px-4">
        {/* ---------------- sidebar (md+) ---------------- */}
        <nav className="hidden w-44 shrink-0 py-6 md:block">
          <ul className="sticky top-20 space-y-0.5">
            {nav.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                    active(href) ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* ---------------- content ---------------- */}
        <main className="min-w-0 flex-1 py-5 pb-24 md:pb-10">{children}</main>
      </div>

      {/* ---------------- bottom tabs (mobile) ---------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        <ul
          className="mx-auto flex max-w-5xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {nav.map(({ href, label, icon: Icon }) => (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                  active(href) ? 'text-accent' : 'text-muted',
                )}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Shared page heading used by every screen inside the shell. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
