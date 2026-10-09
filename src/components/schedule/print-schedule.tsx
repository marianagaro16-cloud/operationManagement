'use client';

import { useEffect } from 'react';
import { weekDates, type Block } from '@/domain/schedule/schedule';
import type { ScheduleKind, SchedulePerson, ScheduleProduct, ScheduleWeekHeader } from '@/types/schedule';
import { ScheduleSheet, weekTitle } from './schedule-sheet';

/**
 * The week on a landscape page, as the sheet has always been sent. Opens the
 * print dialog once drawn; "Save as PDF" there gives the file for Basecamp.
 */
export function PrintSchedule({
  weekStart,
  version,
  draft,
  people,
  kinds,
  products,
  blocks,
  header,
  changed,
}: {
  weekStart: string;
  version: number;
  /** Not published as it stands: said on the page, so a draft is not taken for the plan. */
  draft: boolean;
  people: SchedulePerson[];
  kinds: ScheduleKind[];
  products: ScheduleProduct[];
  blocks: Block[];
  header: ScheduleWeekHeader;
  changed: string[];
}) {
  const dates = weekDates(weekStart);
  const title = weekTitle(dates);
  useEffect(() => {
    // The file name the browser proposes: Arbeitsplanmasamor_11.10.26-17.10.26_v2
    document.title = `Arbeitsplanmasamor_${title.split(' ').join('')}${version > 1 ? `_v${version}` : ''}`;
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, [title, version]);

  const rows = people.filter((p) => p.is_active || blocks.some((b) => b.person_id === p.id));
  const css = [
    '@page { size: A4 landscape; margin: 8mm; }',
    'html, body { background: #fff !important; }',
    '.schedule-sheet, .schedule-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    // The sheet is drawn 1150px wide; an A4 landscape page holds about 1060.
    '@media print { .schedule-page { padding: 0 !important; } .schedule-fit { zoom: 0.9; } }',
  ].join('\n');

  return (
    <div className="schedule-page" style={{ background: '#fff', minHeight: '100vh', padding: 16 }}>
      <style>{css}</style>
      <div className="schedule-fit" style={{ width: 1150 }}>
        <ScheduleSheet
          title={title}
          tag={draft ? `Borrador${version > 1 ? ` v${version}` : ''}` : version > 1 ? `v${version}` : undefined}
          dates={dates}
          people={rows}
          blocks={blocks}
          kinds={kinds}
          products={products}
          header={{
            day_products: header.day_products ?? {},
            day_notes: header.day_notes ?? {},
            holidays: header.holidays ?? [],
            cleaning_bathroom: header.cleaning_bathroom ?? null,
            cleaning_kitchen: header.cleaning_kitchen ?? null,
          }}
          changed={new Set(changed)}
        />
      </div>
    </div>
  );
}
