import { ordersReadOnly, teamScope, type Permission, type Role, type Team } from '@/lib/authz';

/**
 * The report tabs, as plain values.
 *
 * Kept out of report-shell.tsx on purpose: that file is 'use client', and a
 * server page importing a value from it receives a client reference rather
 * than the array — `.filter()` on it throws at runtime (see src/i18n/config.ts).
 *
 * Every report lives on the one Informes screen. Incidents and Reception used
 * to be screens of their own next to it, which is how "the order report" came
 * to hold the activity and inventory reports while two other reports sat
 * elsewhere under a different word.
 */
export type ReportTab = 'orders' | 'preparation' | 'tasks' | 'inventory' | 'incidents' | 'reception';

export const REPORT_TABS: ReportTab[] = ['orders', 'preparation', 'tasks', 'inventory', 'incidents', 'reception'];

/** The capability each tab asks for. Incidents follow the incident log, not reports. */
const TAB_PERMISSION: Record<ReportTab, Permission> = {
  orders: 'reports.view',
  preparation: 'reports.view',
  tasks: 'reports.view',
  inventory: 'reports.view',
  incidents: 'incidents.view_all',
  reception: 'reports.view',
};

/**
 * The tabs this viewer gets, in order. Empty means the screen is not theirs.
 *
 * Preparation is Operaciones' work, not for a read-only order viewer; and
 * Activities adds up every team's tasks, not for someone confined to one.
 */
export function allowedReportTabs(viewer: {
  role: Role;
  profile: { team: Team };
  can: (permission: Permission) => boolean;
}): ReportTab[] {
  return REPORT_TABS.filter(
    (tab) =>
      viewer.can(TAB_PERMISSION[tab])
      && !(tab === 'preparation' && ordersReadOnly(viewer.role))
      && !(tab === 'tasks' && teamScope(viewer.role, viewer.profile.team) !== null),
  );
}
