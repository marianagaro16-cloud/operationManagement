import { describe, expect, it } from 'vitest';
import { allowedReportTabs, REPORT_TABS } from './report-tabs';
import { can, type Permission, type Role, type Team } from '@/lib/authz';

const viewer = (role: Role, held: Permission[], team: Team = 'operations') => ({
  role,
  profile: { team },
  can: (p: Permission) => can(role, new Set(held), p),
});

const REPORTING: Permission[] = ['reports.view', 'incidents.view_all'];

describe('which report tabs a viewer gets', () => {
  it('gives an admin every tab, incidents and receiving included', () => {
    expect(allowedReportTabs(viewer('admin', []))).toEqual(REPORT_TABS);
  });

  it('gives a power user every tab', () => {
    expect(allowedReportTabs(viewer('power_user', REPORTING))).toEqual(REPORT_TABS);
  });

  it('keeps preparation from the production manager, and nothing else', () => {
    expect(allowedReportTabs(viewer('production_manager', REPORTING, 'production')))
      .toEqual(['orders', 'tasks', 'inventory', 'incidents', 'reception']);
  });

  it('opens only incidents for someone who holds the incident log alone', () => {
    expect(allowedReportTabs(viewer('manager', ['incidents.view_all']))).toEqual(['incidents']);
  });

  it('gives a plain user nothing', () => {
    expect(allowedReportTabs(viewer('user', []))).toEqual([]);
  });
});
