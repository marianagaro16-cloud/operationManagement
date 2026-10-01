'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Bell, BellRing, BookOpen, Boxes, CalendarDays, CalendarOff, CalendarRange, ChevronDown, ClipboardCheck, ClipboardList, Handshake, Inbox, LayoutDashboard, Megaphone, MoreHorizontal, Package, PartyPopper, Receipt, ScanSearch, Settings, Shield, StickyNote, Truck, UserRound, Users, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn, displayName, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LanguageSelector } from './language-selector';
import { SignOutButton } from './sign-out-button';
import { PresenceBeacon } from './presence-beacon';
import { FormNoteSubmit } from '@/components/ui/enter-to-save';
import { InboxLink } from './inbox-link';
import { QuickNoteButton } from '@/components/notes/quick-note-button';
import { atLeast, can, canReadMarketing, isExternal, isMarketing, isSales, ordersReadOnly, type Permission, type Role, type Team } from '@/lib/authz';
import type { Profile } from '@/types/database';
import { opensManagement } from '@/components/admin/sections';

/**
 * Responsive shell: a bottom tab bar on phones (thumb-reachable, since the
 * operators use this on the warehouse floor) and a sidebar from `md` up.
 */
type NavGroup = 'day' | 'logistics' | 'operation' | 'production' | 'customers' | 'marketing' | 'team' | 'manage';
type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; primary: boolean; badge?: number; group: NavGroup };
const FOLDED_KEY = 'nav.folded';
/** Closed to the external (Marketing) account. */
const EXTERNAL_HIDDEN = ['/orders', '/lot-tracker', '/incidents', '/goods-reception', '/inventory', '/calendar', '/absences', '/hr', '/evaluations', '/collections', '/sales'];
const NAV_GROUPS: NavGroup[] = ['day', 'logistics', 'operation', 'production', 'customers', 'marketing', 'team', 'manage'];
const GROUP_LABEL: Record<Exclude<NavGroup, 'manage'>, MessageKey> = {
  day: 'nav.groupDay',
  logistics: 'nav.groupLogistics',
  production: 'nav.groupProduction',
  marketing: 'nav.groupMarketing',
  operation: 'nav.groupOperation',
  customers: 'nav.groupCustomers',
  team: 'nav.groupTeam',
};

export function AppShell({
  profile,
  caps,
  reminderAttention = 0,
  inboxUnread = 0,
  evaluations = { total: 0, pending: 0 },
  collections = false,
  marketingNew = 0,
  children,
}: {
  /** New requests waiting for Marketing; a count on its entry. */
  marketingNew?: number;
  /** On the collections team: the Cobranza entry. */
  collections?: boolean;
  profile: Profile;
  caps: Permission[];
  /** Reminders due or overdue for this viewer; drawn as a count on the nav entry. */
  reminderAttention?: number;
  /** Unread notifications; drawn as a count on the inbox icon in the header. */
  inboxUnread?: number;
  /** Evaluations of others this viewer was asked to fill in; the entry shows only if there ever were any. */
  evaluations?: { total: number; pending: number };
  children: ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sales planning's week needs the whole screen: seven days side by side.
  const frame = pathname === '/sales' && searchParams.get('tab') === 'planning' ? 'max-w-[1600px]' : 'max-w-5xl';
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
  /*
   * The menu in four areas — what the app is about: my day, the operation
   * (from order to delivery), customers, and the team — then management.
   * Every entry still appears only for whom it applies; a group with nothing
   * in it is not shown.
   */
  const plansWork = can(role, held, 'tasks.manage_occurrences');
  const AREA: Record<'logistics' | 'operations' | 'production', NavGroup> = { logistics: 'logistics', operations: 'operation', production: 'production' };
  const activitiesFor = (team: 'logistics' | 'operations' | 'production'): NavItem[] =>
    plansWork && (role !== 'production_manager' || profile.team === team)
      ? [{ href: `/calendar?team=${team}`, label: t('nav.activities'), icon: CalendarDays, primary: false, group: AREA[team] }]
      : [];

  const external = isExternal(role, profile.team as Team);
  const marketing = isMarketing(profile.team as Team);

  const allNav: NavItem[] = [
    // ---- my day ----
    { href: '/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, primary: true, group: 'day' },
    // Everything with a day, from every part of the app, in one week — with
    // reminders and meetings as its tabs. A due reminder counts here.
    { href: '/agenda', label: t('agenda.title'), icon: CalendarRange, primary: false, badge: reminderAttention, group: 'day' },

    // ---- logistics: orders, shipping, delivery ----
    // Orders — to prepare, ready, shipped — is the main floor workflow, so it
    // sits high in the bar, for everyone.
    { href: '/orders', label: t('orders.title'), icon: Package, primary: true, group: 'logistics' },
    // Traceability answers a question about ORDERS — where a lot was used —
    // so it follows the order book's capability. A read-only order viewer
    // (the production manager) traces lots too.
    ...(can(role, held, 'orders.manage') || ordersReadOnly(role)
      ? [{ href: '/lot-tracker', label: t('lot.title'), icon: ScanSearch, primary: false, group: 'logistics' as const }]
      : []),
    // Every incident is about a delivery. Whoever manages incidents without
    // managing orders (the production manager) still needs the log itself.
    ...(can(role, held, 'orders.manage') || can(role, held, 'incidents.manage')
      ? [{ href: '/incidents', label: t('incident.navLabel'), icon: AlertTriangle, primary: false, group: 'logistics' as const }]
      : []),
    ...activitiesFor('logistics'),
    // ---- the operation: the warehouse ----
    // Goods Reception is its own section: a supplier delivery has no customer
    // order behind it. Every approved user views; the screen decides who adds.
    { href: '/goods-reception', label: t('gr.navLabel'), icon: Truck, primary: true, group: 'operation' },
    // Counting happens on the floor, by people who are not admins.
    { href: '/inventory', label: t('inventory.title'), icon: Boxes, primary: true, group: 'operation' },
    // Each area's activities: the work plan, showing that team's. It browses
    // future dates, so it belongs to whoever plans work; the Production manager
    // plans only Production's.
    ...activitiesFor('operations'),
    ...activitiesFor('production'),

    // ---- customers ----
    // Sales: customers, prospects, planning, report, summary. The Ventas team, Admin and Owners.
    ...(isSales(role, profile.team as Team)
      ? [{ href: '/sales', label: t('sales.navLabel'), icon: Handshake, primary: false, group: 'customers' as const }]
      : []),
    // Events: fairs, markets, events with customers and our own. Sales — and
    // Marketing, who covers them (read, notes and photos).
    ...(isSales(role, profile.team as Team) || marketing
      ? [{ href: '/events', label: t('event.navLabel'), icon: PartyPopper, primary: marketing, group: 'customers' as const }]
      : []),
    // Products and customers to read, for Marketing.
    ...(marketing
      ? [{ href: '/catalog', label: t('catalog.navLabel'), icon: BookOpen, primary: true, group: 'customers' as const }]
      : []),
    // Collections: unpaid invoices followed up, and handed to an agency. The collections team only.
    ...(collections
      ? [{ href: '/collections', label: t('collection.navLabel'), icon: Receipt, primary: false, group: 'customers' as const }]
      : []),

    // ---- marketing ----
    // The content plan: Marketing, Admin and Owners write; Sales and Managers read.
    ...(canReadMarketing(role, profile.team as Team)
      ? [{ href: '/marketing', label: t('mkt.planTitle'), icon: Megaphone, primary: marketing, group: 'marketing' as const }]
      : []),
    // Requests to Marketing: anyone asks; Marketing sees the new ones counted.
    { href: '/marketing/requests', label: t('mktReq.title'), icon: Inbox, primary: false, badge: marketingNew, group: 'marketing' as const },

    // ---- the team ----
    // One entry; absences, evaluations and worker files are its tabs.
    { href: '/absences', label: t('nav.people'), icon: Users, primary: false, badge: evaluations.pending, group: 'team' },

    // ---- management ----
    // Opens at power_user, or to whoever holds a permission one of its
    // screens needs (e.g. given for a coverage); its own nav filters the tabs.
    ...(opensManagement(role, held, atLeast(role, 'power_user'))
      ? [{ href: '/admin', label: t('nav.manage'), icon: Shield, primary: false, group: 'manage' as const }]
      : []),
  ];
  // The external account sees none of the operation: the database refuses it
  // anyway; the menu does not offer it.
  const nav = external ? allNav.filter(({ href }) => !EXTERNAL_HIDDEN.some((p) => href.startsWith(p))) : allNav;

  // ...nor do its addresses, typed or linked from elsewhere.
  useEffect(() => {
    if (external && EXTERNAL_HIDDEN.some((p) => pathname.startsWith(p))) router.replace('/dashboard');
  }, [external, pathname, router]);

  // Section-aware: a detail page must keep its section's tab lit, exactly as
  // an admin subpage keeps the management tab lit. `/orders` joined the list
  // when orders gained a detail route of their own.
  const SECTIONS = ['/admin', '/inventory', '/orders', '/lot-tracker', '/incidents', '/goods-reception', '/events', '/collections', '/marketing'];

  /*
   * Entries that hold several screens as tabs. The tabs keep their own
   * addresses, so every link into them still works; the entry stays lit on
   * any of them.
   */
  const TABS: Record<string, { href: string; label: string; icon: typeof LayoutDashboard; badge?: number }[]> = {
    '/agenda': [
      { href: '/agenda', label: t('agenda.title'), icon: CalendarRange },
      { href: '/reminders', label: t('reminder.navLabel'), icon: BellRing, badge: reminderAttention },
      { href: '/meetings', label: t('meeting.navLabel'), icon: Users },
      { href: '/notes', label: t('note.navLabel'), icon: StickyNote },
    ],
    '/absences': [
      { href: '/absences', label: t('absence.navLabel'), icon: CalendarOff },
      // Evaluations this person was asked to fill in about others — only for someone who was ever asked.
      ...(evaluations.total > 0 ? [{ href: '/evaluations', label: t('hrEval.mine'), icon: ClipboardCheck, badge: evaluations.pending }] : []),
      // Worker files are about people, not configuration.
      ...(can(role, held, 'hr.manage') ? [{ href: '/hr', label: t('hr.navLabel'), icon: UserRound }] : []),
    ],
  };
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const active = (href: string) =>
    href === '/marketing' ? pathname.startsWith('/marketing') && !pathname.startsWith('/marketing/requests') :
    href === '/marketing/requests' ? pathname.startsWith('/marketing/requests') :
    href.startsWith('/calendar?') ? pathname === '/calendar' && href.endsWith(`team=${searchParams.get('team')}`) :
    TABS[href] ? TABS[href].some((tab) => under(tab.href)) : SECTIONS.includes(href) ? pathname.startsWith(href) : pathname === href;
  // The tab row shows on a tab's own screen (and reminders' task list), not on a detail page.
  const tabs = Object.values(TABS).find((row) => row.length > 1 && row.some((tab) => pathname === tab.href || (tab.href === '/reminders' && pathname === '/reminders/tasks')));
  const currentTab = Object.values(TABS).flat().find((tab) => under(tab.href));

  /** Groups folded in the sidebar, remembered per browser. */
  const [folded, setFolded] = useState<NavGroup[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
      if (Array.isArray(saved)) setFolded(saved);
    } catch {}
  }, []);
  const toggleGroup = (group: NavGroup) => {
    const next = folded.includes(group) ? folded.filter((g) => g !== group) : [...folded, group];
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {}
  };

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
    currentTab?.label ??
    nav.find(({ href }) => active(href))?.label ??
    (pathname === '/settings' ? t('nav.settings') : pathname === '/inbox' ? t('inbox.title') : t('common.appName'));

  return (
    <div className="min-h-dvh bg-bg">
      <PresenceBeacon />
      <FormNoteSubmit />

      {/* ---------------- header ---------------- */}
      <header
        className={cn(
          'sticky top-0 border-b border-border bg-bg/85 backdrop-blur',
          // Lifted above the dismiss overlay while the menu is open, so the
          // menu itself and the avatar stay clickable.
          menuOpen ? 'z-40' : 'z-20',
        )}
      >
        <div className={`mx-auto flex h-14 ${frame} items-center gap-3 px-4`}>
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

          {/* The inbox, beside settings on every screen: a count nobody can
              see without opening a menu is a count nobody reads. */}
          {/* Write a note down without leaving the screen. */}
          <QuickNoteButton />

          <InboxLink initialUnread={inboxUnread} active={pathname === '/inbox'} />

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

      <div className={`mx-auto flex ${frame} gap-6 px-4`}>
        {/* ---------------- sidebar (md+) ---------------- */}
        <nav className="hidden w-44 shrink-0 py-6 md:block">
          <div className="sticky top-20 space-y-3">
            {NAV_GROUPS.map((group) => {
              const items = nav.filter((i) => i.group === group);
              if (items.length === 0) return null;
              // The group of the open screen never folds away.
              const open = group === 'manage' || !folded.includes(group) || items.some(({ href }) => active(href));
              return (
                <div key={group} className={cn(group === 'manage' && 'border-t border-border pt-3')}>
                  {group !== 'manage' && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      aria-expanded={open}
                      className="group mb-0.5 flex w-full items-center gap-1 rounded px-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-subtle hover:text-fg"
                    >
                      {t(GROUP_LABEL[group])}
                      {/* Something inside a folded group needs attention. */}
                      {!open && items.some((i) => i.badge) && <span className="h-1.5 w-1.5 rounded-full bg-late" aria-hidden />}
                      <ChevronDown className={cn('ml-auto h-3 w-3 opacity-0 transition group-hover:opacity-100', !open && '-rotate-90 opacity-100')} aria-hidden />
                    </button>
                  )}
                  {open && <ul className="space-y-0.5">
                    {items.map(({ href, label, icon: Icon, badge }) => (
                      <li key={href}>
                        <Link
                          href={href}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                            active(href) ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          {label}
                          <NavBadge count={badge} />
                        </Link>
                      </li>
                    ))}
                  </ul>}
                </div>
              );
            })}
          </div>
        </nav>

        {/* ---------------- content ---------------- */}
        <main className="min-w-0 flex-1 py-5 pb-24 md:pb-10">
          {tabs && (
            <div className="-mt-1 mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1">
              {tabs.map(({ href, label, icon: Icon, badge }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                    currentTab?.href === href ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{label}</span>
                  {Boolean(badge) && (
                    <span className="rounded-full bg-late/15 px-1.5 text-[11px] font-semibold tabular text-late">{badge! > 99 ? '99+' : badge}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
          {children}
        </main>
      </div>

      {/* ---------------- bottom tabs (mobile) ----------------

          The sheet and the bar share ONE bottom-anchored column, so the sheet
          sits on top of the bar without anybody hardcoding the bar's height —
          a number that would drift the moment the padding or the font moved. */}
      <div className="fixed inset-x-0 bottom-0 z-20 md:hidden">
        {moreOpen && !fitsWithoutMore && (
          <div className="animate-slide-up border-t border-border bg-surface shadow-pop">
            <ul className="mx-auto max-h-[70vh] max-w-5xl overflow-y-auto p-2">
              {secondaryNav.map(({ href, label, icon: Icon, badge, group }, index) => (
                <li key={href}>
                  {/* A group's title above its first entry in the sheet. */}
                  {group !== 'manage' && secondaryNav.findIndex((i) => i.group === group) === index && (
                    <p className="px-3 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">{t(GROUP_LABEL[group])}</p>
                  )}
                  {group === 'manage' && <div className="my-1.5 border-t border-border" />}
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
                    <NavBadge count={badge} />
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
            {barNav.map(({ href, label, icon: Icon, badge }) => (
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
                  <span className="relative">
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    {Boolean(badge) && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-late" aria-hidden />}
                  </span>
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
                  <span className="relative">
                    {moreOpen ? (
                      <X className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    ) : (
                      <MoreHorizontal className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    )}
                    {/* Something behind More needs attention. */}
                    {!moreOpen && secondaryNav.some((i) => i.badge) && (
                      <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-late" aria-hidden />
                    )}
                  </span>
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

/** A due count beside a nav label. Nothing at zero, so it only ever means something. */
function NavBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto rounded-full bg-late/15 px-1.5 text-[11px] font-semibold tabular text-late">
      {count > 99 ? '99+' : count}
    </span>
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
