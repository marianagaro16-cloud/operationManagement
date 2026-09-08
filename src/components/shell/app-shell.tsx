'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Bell, Boxes, CalendarDays, ClipboardList, LayoutDashboard, Package, ScanSearch, Settings, Shield } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn, displayName, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LanguageSelector } from './language-selector';
import { SignOutButton } from './sign-out-button';
import { atLeast, can, type Permission, type Role } from '@/lib/authz';
import type { Profile } from '@/types/database';

/**
 * Responsive shell: a bottom tab bar on phones (thumb-reachable, since the
 * operators use this on the warehouse floor) and a sidebar from `md` up.
 */
export function AppShell({
  profile,
  caps,
  children,
}: {
  profile: Profile;
  caps: Permission[];
  children: ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = profile.role as Role;
  const held = new Set(caps);

  const nav = [
    { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    // Lot control is the main floor workflow, so it sits high in the bar.
    { href: '/preparation', label: t('prep.title'), icon: ClipboardList },
    // Order Control is the ORDER BOOK — customers, dates, quantities, the
    // definitions themselves. A person on the floor works lot control and
    // inventory; the order book is not theirs to browse, so it follows the
    // capability rather than being shown to everyone.
    ...(can(role, held, 'orders.manage')
      ? [
          { href: '/orders', label: t('orders.title'), icon: Package },
          // Traceability sits beside the order book, not inside Inventory:
          // it answers a question about ORDERS — where a lot was used — and
          // its one call to action is to open the order and fix it there.
          { href: '/lot-tracker', label: t('lot.title'), icon: ScanSearch },
          // Incidents belong with the order book: every one of them is about a
          // delivery, and the report they feed is read next to the order
          // reports. Behind the same capability for the same reason — a person
          // on the floor works lot control, and the complaint log is not their
          // screen. They still reach an incident on an order they prepared,
          // from that order's own page, which is where they would look.
          { href: '/incidents', label: t('incident.navLabel'), icon: AlertTriangle },
        ]
      : []),
    // Counting happens on the floor, so inventory sits in the main bar rather
    // than behind the admin section — the people who do it are not admins.
    { href: '/inventory', label: t('inventory.title'), icon: Boxes },
    // The calendar browses future dates, so it belongs to whoever plans work,
    // for the same reason the dashboard hides upcoming work from a plain user.
    ...(can(role, held, 'tasks.manage_occurrences')
      ? [{ href: '/calendar', label: t('nav.calendar'), icon: CalendarDays }]
      : []),
    // The management area opens at power_user; its own nav filters the tabs.
    ...(atLeast(role, 'power_user')
      ? [{ href: '/admin', label: t('nav.manage'), icon: Shield }]
      : []),
  ];

  // Section-aware: a detail page must keep its section's tab lit, exactly as
  // an admin subpage keeps the management tab lit. `/orders` joined the list
  // when orders gained a detail route of their own.
  const SECTIONS = ['/admin', '/inventory', '/orders', '/lot-tracker', '/incidents'];
  const active = (href: string) =>
    SECTIONS.includes(href) ? pathname.startsWith(href) : pathname === href;

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

  const onDashboard = pathname === '/dashboard';

  // Which section the header names. Falls back to the app's own name rather
  // than going blank on a route the nav does not own (a detail page, say —
  // those carry their own title and back link in the content).
  const sectionLabel =
    nav.find(({ href }) => active(href))?.label ??
    (pathname === '/settings' ? t('nav.settings') : t('common.appName'));

  return (
    <div className="min-h-dvh bg-bg">
      {/* ---------------- header ---------------- */}
      <header
        className={cn(
          'sticky top-0 border-b border-border bg-bg/85 backdrop-blur',
          // Lifted above the dismiss overlay while the menu is open, so the
          // menu itself and the avatar stay clickable.
          menuOpen ? 'z-40' : 'z-20',
        )}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          {/* The greeting is a greeting: it belongs on the screen you land on.
              Everywhere else this 56px bar is the only persistent thing on a
              phone, and it was spending all of it saying good afternoon while
              the name of the screen you were on scrolled away below. */}
          <div className="min-w-0 flex-1">
            {onDashboard ? (
              <>
                <p className="truncate text-[15px] font-semibold leading-tight">
                  {greeting}
                  {profile.name ? `, ${profile.name.split(' ')[0]}` : ''}
                </p>
                <p className="truncate text-[12px] text-muted">{formatDate(today, 'weekday')}</p>
              </>
            ) : (
              <p className="truncate text-[15px] font-semibold leading-tight">{sectionLabel}</p>
            )}
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
          <div className="animate-fade-in relative border-t border-border bg-surface shadow-pop">
            <div className="mx-auto max-w-5xl px-4 py-3">
              <div className="mb-2">
                <p className="text-[13px] font-medium">{displayName(profile)}</p>
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
        )}
      </header>

      {/* Tap anywhere outside to close — expected on a phone, where there is
          no cursor to move away.

          Deliberately a sibling of the header rather than a child of it: the
          header carries `backdrop-blur`, and an element with a backdrop-filter
          becomes the containing block for its fixed-position descendants. From
          inside, `fixed inset-0` covered only the 56px header strip, so taps on
          the page never reached it and the menu would not close. */}
      {menuOpen && (
        <button
          className="fixed inset-0 z-30 cursor-default"
          aria-hidden
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
        />
      )}

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
