'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Bell, Boxes, CalendarDays, ClipboardList, LayoutDashboard, MoreHorizontal, Package, ScanSearch, Settings, Shield, Truck, X } from 'lucide-react';
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
  /** The phone's More sheet. Separate from the account menu in the header. */
  const [moreOpen, setMoreOpen] = useState(false);
  const role = profile.role as Role;
  const held = new Set(caps);

  /**
   * `primary` decides what earns a slot in the phone's bottom bar.
   *
   * The desktop sidebar shows everything — it has the room. A bottom bar does
   * not: five is the platform convention on iOS and Android, and the
   * arithmetic agrees, because eight tabs on a 375px screen leave about seven
   * characters each. So the four things somebody does ON THE FLOOR stay in
   * the bar and everything else moves behind More.
   *
   * The split is by WHERE the work happens, not by how important the screen
   * is. Manage matters enormously and is still behind More, because nobody
   * administers the system from a phone in the warehouse.
   */
  const nav = [
    { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, primary: true },
    // Preparation is the main floor workflow, so it sits high in the bar.
    { href: '/preparation', label: t('prep.title'), icon: ClipboardList, primary: true },
    // Order Control is the ORDER BOOK — customers, dates, quantities, the
    // definitions themselves. A person on the floor works lot control and
    // inventory; the order book is not theirs to browse, so it follows the
    // capability rather than being shown to everyone.
    ...(can(role, held, 'orders.manage')
      ? [
          { href: '/orders', label: t('orders.title'), icon: Package, primary: true },
          // Traceability sits beside the order book, not inside Inventory:
          // it answers a question about ORDERS — where a lot was used — and
          // its one call to action is to open the order and fix it there.
          { href: '/lot-tracker', label: t('lot.title'), icon: ScanSearch, primary: false },
          // Incidents belong with the order book: every one of them is about a
          // delivery, and the report they feed is read next to the order
          // reports. Behind the same capability for the same reason — a person
          // on the floor works lot control, and the complaint log is not their
          // screen. They still reach an incident on an order they prepared,
          // from that order's own page, which is where they would look.
          { href: '/incidents', label: t('incident.navLabel'), icon: AlertTriangle, primary: false },
        ]
      : []),
    // Goods Reception is a MAIN section, never a corner of Orders: a supplier
    // delivery has no customer order behind it and often no order at all.
    // Unconditional, because §11 makes every approved user a viewer — the
    // screen itself decides whether a New button is offered, which is a
    // question about assignment rather than about role.
    { href: '/goods-reception', label: t('gr.navLabel'), icon: Truck, primary: true },
    // Counting happens on the floor, so inventory sits in the main bar rather
    // than behind the admin section — the people who do it are not admins.
    { href: '/inventory', label: t('inventory.title'), icon: Boxes, primary: true },
    // The calendar browses future dates, so it belongs to whoever plans work,
    // for the same reason the dashboard hides upcoming work from a plain user.
    ...(can(role, held, 'tasks.manage_occurrences')
      ? [{ href: '/calendar', label: t('nav.calendar'), icon: CalendarDays, primary: false }]
      : []),
    // The management area opens at power_user; its own nav filters the tabs.
    ...(atLeast(role, 'power_user')
      ? [{ href: '/admin', label: t('nav.manage'), icon: Shield, primary: false }]
      : []),
  ];

  // Section-aware: a detail page must keep its section's tab lit, exactly as
  // an admin subpage keeps the management tab lit. `/orders` joined the list
  // when orders gained a detail route of their own.
  const SECTIONS = ['/admin', '/inventory', '/orders', '/lot-tracker', '/incidents', '/goods-reception'];
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

  /*
   * Five slots on a phone: four primary tabs and More.
   *
   * When a viewer holds so few screens that everything already fits, More is
   * not rendered at all — a plain user has three tabs and no sheet to open,
   * and a sheet holding one item would be a worse way to reach it.
   */
  const primaryNav = nav.filter((i) => i.primary);
  const secondaryNav = nav.filter((i) => !i.primary);
  const fitsWithoutMore = nav.length <= 5;
  const barNav = fitsWithoutMore ? nav : primaryNav;
  // Keeps More lit while the open screen lives behind it, so the bar still
  // says where you are.
  const inMore = !fitsWithoutMore && secondaryNav.some(({ href }) => active(href));

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

      {/* ---------------- bottom tabs (mobile) ----------------

          The sheet and the bar share ONE bottom-anchored column, so the sheet
          sits on top of the bar without anybody hardcoding the bar's height —
          a number that would drift the moment the padding or the font moved. */}
      <div className="fixed inset-x-0 bottom-0 z-20 md:hidden">
        {moreOpen && !fitsWithoutMore && (
          <div className="animate-slide-up border-t border-border bg-surface shadow-pop">
            <ul className="mx-auto max-w-5xl p-2">
              {secondaryNav.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex touch-target items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors',
                      active(href) ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {/* Full width here, and no truncation: the sheet is where
                        the long names finally get to be read. */}
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <nav className="border-t border-border bg-surface/95 backdrop-blur">
          <ul
            className="mx-auto flex max-w-5xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {barNav.map(({ href, label, icon: Icon }) => (
              // min-w-0 is load-bearing. A flex item defaults to min-width:auto,
              // so a tab could not shrink below its longest WORD — and the bar
              // measured 438px in English, 457 in Spanish and 580 in German
              // inside a 375px screen. Since the nav is fixed with no overflow,
              // the excess was not scrollable: it was cut off, which left
              // Verwaltung and Kalender untappable on a German phone.
              <li key={href} className="min-w-0 flex-1">
                <Link
                  href={href}
                  // The label is also the accessible name, so it is truncated
                  // visually and kept whole for a screen reader via title.
                  title={label}
                  className={cn(
                    'flex flex-col items-center gap-0.5 px-0.5 py-2.5 text-[11px] font-medium transition-colors',
                    active(href) ? 'text-accent' : 'text-muted',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  <span className="w-full truncate text-center">{label}</span>
                </Link>
              </li>
            ))}

            {!fitsWithoutMore && (
              <li className="min-w-0 flex-1">
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  className={cn(
                    'flex w-full flex-col items-center gap-0.5 px-0.5 py-2.5 text-[11px] font-medium transition-colors',
                    moreOpen || inMore ? 'text-accent' : 'text-muted',
                  )}
                >
                  {moreOpen ? (
                    <X className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  ) : (
                    <MoreHorizontal className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  )}
                  <span className="w-full truncate text-center">{t('nav.more')}</span>
                </button>
              </li>
            )}
          </ul>
        </nav>
      </div>

      {/* Tap the page to dismiss the sheet. Below the column, above the
          content — the four primary tabs stay reachable while it is open,
          because the sheet is a drawer rather than a modal. */}
      {moreOpen && !fitsWithoutMore && (
        <button
          className="fixed inset-0 z-10 cursor-default bg-black/20 md:hidden"
          aria-hidden
          tabIndex={-1}
          onClick={() => setMoreOpen(false)}
        />
      )}
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
