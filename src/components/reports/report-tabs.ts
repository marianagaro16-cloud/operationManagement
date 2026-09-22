/**
 * The report tabs, as plain values.
 *
 * Kept out of report-shell.tsx on purpose: that file is 'use client', and a
 * server page importing a value from it receives a client reference rather
 * than the array — `.filter()` on it throws at runtime (see src/i18n/config.ts).
 */
export type ReportTab = 'orders' | 'preparation' | 'tasks' | 'inventory';

export const REPORT_TABS: ReportTab[] = ['orders', 'preparation', 'tasks', 'inventory'];
