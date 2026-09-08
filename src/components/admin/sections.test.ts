import { describe, it, expect } from 'vitest';
import {
  ADMIN_SECTIONS,
  sectionEntry,
  sectionFor,
  visibleScreens,
  visibleSections,
} from './sections';
import { PERMISSIONS, type Permission } from '@/lib/authz';

/**
 * The shape of the management area.
 *
 * Worth testing because a wrong answer here is invisible: a screen whose
 * section cannot be resolved simply renders with no tabs and no back link,
 * which reads as a page that lost its navigation rather than as a bug.
 */

const ALL = new Set<Permission>(PERMISSIONS);
const NONE = new Set<Permission>();

describe('every screen is reachable and declared once', () => {
  it('no route appears in two sections', () => {
    const hrefs = ADMIN_SECTIONS.flatMap((s) => s.screens.map((x) => x.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('every screen names a capability the system actually has', () => {
    for (const section of ADMIN_SECTIONS) {
      for (const screen of section.screens) {
        if (screen.permission === null) continue;
        expect(PERMISSIONS).toContain(screen.permission);
      }
    }
  });

  it('every screen resolves back to its own section', () => {
    for (const section of ADMIN_SECTIONS) {
      for (const screen of section.screens) {
        expect(sectionFor(screen.href)?.slug).toBe(section.slug);
      }
    }
  });
});

describe('resolving a path to its section', () => {
  it('places the master-data screens', () => {
    expect(sectionFor('/admin/customers')?.slug).toBe('master-data');
    expect(sectionFor('/admin/products')?.slug).toBe('master-data');
    expect(sectionFor('/admin/incident-types')?.slug).toBe('master-data');
  });

  it('places the review screens', () => {
    expect(sectionFor('/admin/reports')?.slug).toBe('review');
    expect(sectionFor('/admin/incident-reports')?.slug).toBe('review');
  });

  it('resolves a CHILD route to its parent screen section', () => {
    // A saved report has its own page; it must keep the Review tabs.
    expect(sectionFor('/admin/incident-reports/abc-123')?.slug).toBe('review');
    // An inventory template detail lives under /admin/inventory/[templateId].
    expect(sectionFor('/admin/inventory/some-template-id')?.slug).toBe('work');
  });

  it('prefers the LONGEST match, not the first prefix', () => {
    // '/admin/inventory' is a prefix of '/admin/inventory/locations'. Both are
    // real screens, and the more specific one has to win or the tab strip
    // would light the wrong entry.
    const section = sectionFor('/admin/inventory/locations');
    expect(section?.slug).toBe('work');
    const screens = visibleScreens(section!, 'admin', ALL);
    expect(screens.some((s) => s.href === '/admin/inventory/locations')).toBe(true);
  });

  it('returns null for the hub itself, so it renders no tabs', () => {
    expect(sectionFor('/admin')).toBeNull();
  });

  it('returns null for a path outside the admin area', () => {
    expect(sectionFor('/orders')).toBeNull();
    expect(sectionFor('/admin-something-else')).toBeNull();
  });
});

describe('what a viewer is shown', () => {
  it('an admin sees every section', () => {
    // can() short-circuits on admin, so an empty capability set is enough.
    expect(visibleSections('admin', NONE)).toHaveLength(ADMIN_SECTIONS.length);
  });

  it('a plain user sees nothing at all', () => {
    // They never reach this layout, but the data must not claim otherwise.
    expect(visibleSections('user', NONE)).toEqual([]);
  });

  it('a section with no screens for this viewer is not offered', () => {
    // A power user holds no configuration capability, so Master data — which
    // is entirely configuration — must not appear as an empty card.
    const powerUser = new Set<Permission>(['reports.view']);
    const slugs = visibleSections('power_user', powerUser).map((s) => s.section.slug);
    expect(slugs).toEqual(['review']);
  });

  it('a card leads to the first screen the viewer may actually open', () => {
    // Not to the section's first screen in the abstract — to theirs.
    const onlyStatistics = new Set<Permission>(['reports.view']);
    const [review] = visibleSections('manager', onlyStatistics);
    expect(sectionEntry(review.screens)).toBe('/admin/reports');
  });

  it('falls back to the hub rather than a broken link', () => {
    expect(sectionEntry([])).toBe('/admin');
  });
});
