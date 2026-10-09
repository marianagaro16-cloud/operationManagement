'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileDown, Plus, Send, Trash2, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import {
  changedCells,
  formatHours,
  isWholeSlot,
  parseTime,
  productionStaffing,
  scheduleWarnings,
  slotKey,
  weekDates,
  weekStartOf,
  withTyped,
  type Block,
  type Typed,
} from '@/domain/schedule/schedule';
import {
  createScheduleWeek,
  deleteScheduleWeek,
  ensureSchedulePattern,
  publishScheduleWeek,
  saveScheduleCell,
  saveScheduleHeader,
} from '@/server/schedule-actions';
import type { ScheduleKind, SchedulePerson, ScheduleProduct, ScheduleWeekData, ScheduleWeekHeader } from '@/types/schedule';
import { ScheduleSheet, weekTitle } from './schedule-sheet';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** The tabs of the schedule: a week, the usual week, and the Sunday register. */
export function ScheduleTabs({ current, canEdit }: { current: 'week' | 'pattern' | 'sundays'; canEdit: boolean }) {
  const { t } = useI18n();
  const tabs = [
    { key: 'week', href: '/schedule', label: t('schedule.tabWeek') },
    { key: 'sundays', href: '/schedule?view=sundays', label: t('schedule.tabSundays') },
    // The usual week is a tool for making weeks: only for whoever makes them.
    ...(canEdit ? [{ key: 'pattern', href: '/schedule?week=pattern', label: t('schedule.tabPattern') }] : []),
  ];
  return (
    <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
            current === tab.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function useScheduleErrors() {
  const { t } = useI18n();
  return (code: string) => {
    const known: Record<string, MessageKey> = {
      week_exists: 'schedule.errWeekExists',
      no_pattern: 'schedule.errNoPattern',
      week_empty: 'schedule.errEmpty',
      nothing_changed: 'schedule.errNothingChanged',
      times_both: 'schedule.errTimesBoth',
      times_order: 'schedule.errTimesOrder',
      times_required: 'schedule.errTimesRequired',
      week_published: 'schedule.errPublished',
      in_use: 'schedule.errInUse',
      person_exists: 'schedule.errPersonExists',
      hours_order: 'schedule.errHoursOrder',
      not_authorized: 'schedule.errNotAuthorized',
    };
    return known[code] ? t(known[code]) : code || t('common.error');
  };
}

const whole = isWholeSlot;

const headerOf = (h: ScheduleWeekHeader): ScheduleWeekHeader => ({
  day_products: h.day_products ?? {},
  day_notes: h.day_notes ?? {},
  holidays: h.holidays ?? [],
  cleaning_bathroom: h.cleaning_bathroom ?? null,
  cleaning_kitchen: h.cleaning_kitchen ?? null,
});
const headerText = (h: ScheduleWeekHeader) =>
  JSON.stringify([Object.entries(h.day_products).sort(), Object.entries(h.day_notes).sort(), [...h.holidays].sort(), h.cleaning_bathroom, h.cleaning_kitchen]);

/**
 * One week of the schedule — or the usual week — as the sheet, with what
 * surrounds it: moving between weeks, publishing, the PDF, and what to check.
 */
export function ScheduleView({
  weekStart,
  data,
  weeks,
  people,
  kinds,
  products,
  absentDays,
  today,
  canEdit,
  hasPattern,
}: {
  /** The Sunday shown, or null on the usual week. */
  weekStart: string | null;
  data: ScheduleWeekData | null;
  weeks: { id: string; week_start: string; version: number }[];
  /** Every row there is, the inactive included: a past week still shows who was on it. */
  people: SchedulePerson[];
  kinds: ScheduleKind[];
  products: ScheduleProduct[];
  absentDays: Record<string, number[]>;
  today: string;
  canEdit: boolean;
  hasPattern: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const [cell, setCell] = useState<{ personId: string; day: number } | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pattern = weekStart === null;
  const week = data?.week ?? null;
  const rules = useMemo(() => new Map(kinds.map((k) => [k.id, { id: k.id, counts_hours: k.counts_hours }])), [kinds]);
  const saved = useMemo(() => data?.blocks ?? [], [data]);
  // What was typed into the sheet since: on its way to the server, or waiting for its other half.
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const typedNow = useRef(typed);
  const [bad, setBad] = useState<string[]>([]);
  // One save at a time: each replaces a person's whole day, and two at once would cross.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const blocks = useMemo(() => withTyped(saved, typed, rules), [saved, typed, rules]);
  const header = headerOf(week ?? { day_products: {}, day_notes: {}, holidays: [], cleaning_bathroom: null, cleaning_kitchen: null });
  const dates = weekStart ? weekDates(weekStart) : null;

  // Rows: whoever is active, and whoever has hours in this week anyway.
  const rows = people.filter((p) => p.is_active || blocks.some((b) => b.person_id === p.id));

  const published = data?.published ?? null;
  const dirty = !!week && week.version > 0 && !!published && (changedCells(published.blocks, blocks).size > 0 || headerText(headerOf(published)) !== headerText(header));
  // Yellow: against the last version while there are changes to publish;
  // otherwise what that version changed against the one before it.
  const changed = useMemo(() => {
    if (!week || week.version === 0 || !published) return new Set<string>();
    if (dirty) return changedCells(published.blocks, blocks);
    return data?.previous ? changedCells(data.previous.blocks, blocks) : new Set<string>();
  }, [week, published, dirty, blocks, data]);
  const comparedTo = !week || week.version === 0 ? 0 : dirty ? week.version : week.version - 1;

  const warnings = week ? scheduleWarnings(blocks, rows, rules, new Map(Object.entries(absentDays).map(([id, days]) => [id, new Set(days)]))) : [];
  const short = week ? productionStaffing(blocks, header.day_products, products).filter((s) => s.short) : [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '—';
  const dayLabel = (d: number) => (dates ? `${WEEKDAYS[d]} ${dates[d].slice(8, 10)}.${dates[d].slice(5, 7)}` : WEEKDAYS[d]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error ?? ''));
      after?.();
      router.refresh();
    });
  }

  const setTypedNow = (next: Record<string, Typed>) => {
    typedNow.current = next;
    setTyped(next);
  };
  /** Forget what was typed in a person's day: the dialog has just saved it whole. */
  const forget = (personId: string, d: number) =>
    setTypedNow(Object.fromEntries(Object.entries(typedNow.current).filter(([key]) => !key.startsWith(`${personId}:${d}:`))));

  /**
   * A time typed into the sheet. Saved as soon as the slot has both of its
   * times in order — or neither; until then it waits where it was typed.
   */
  function typeTime(personId: string, d: number, slot: 1 | 2, field: 'start' | 'end', raw: string) {
    if (!week) return;
    const key = slotKey(personId, d, slot);
    const mark = `${key}:${field}`;
    const parsed = parseTime(raw);
    if (parsed === null) return setBad((list) => [...new Set([...list, mark])]);
    const before = saved.find((b) => b.person_id === personId && b.day === d && b.slot === slot);
    const base = typedNow.current[key] ?? { start: before?.start_time ?? '', end: before?.end_time ?? '' };
    const next = { ...base, [field]: parsed };
    setTypedNow({ ...typedNow.current, [key]: next });
    // Both there but the end not after the start: the one just typed is the one to look at.
    if (next.start && next.end && !whole(next)) return setBad((list) => [...new Set([...list, mark])]);
    setBad((list) => list.filter((m) => !m.startsWith(`${key}:`)));
    if (!whole(next) && (next.start || next.end)) return;
    if (next.start === (before?.start_time ?? '') && next.end === (before?.end_time ?? '')) return;

    const dayBlocks = withTyped(saved, typedNow.current, rules)
      .filter((b) => b.person_id === personId && b.day === d)
      .map((b) => ({ slot: b.slot as 1 | 2, start_time: b.start_time, end_time: b.end_time, kind_id: b.kind_id }));
    setError(null);
    saving.current = saving.current.then(async () => {
      const res = await saveScheduleCell(week.id, personId, d, dayBlocks);
      if (!res.ok) {
        // Not saved: the sheet goes back to what the server holds, and says why.
        forget(personId, d);
        return setError(errorText(res.error));
      }
      router.refresh();
    });
  }

  const go = (date: string) => router.push(`/schedule?week=${date}`);
  const thisWeek = weekStartOf(today);
  const shift = (days: number) => {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <PageHeader
        title={t('schedule.title')}
        subtitle={t('schedule.subtitle')}
        action={
          canEdit && !pattern ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('schedule.newWeek')}
            </Button>
          ) : undefined
        }
      />
      <ScheduleTabs current={pattern ? 'pattern' : 'week'} canEdit={canEdit} />

      {/* ---- which week, and what state it is in ---- */}
      {!pattern && weekStart && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="icon" variant="ghost" aria-label={t('schedule.prevWeek')} onClick={() => go(shift(-7))}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Select aria-label={t('schedule.tabWeek')} className="w-auto" value={weekStart} onChange={(e) => go(e.target.value)}>
            {!weeks.some((w) => w.week_start === weekStart) && <option value={weekStart}>{weekTitle(weekDates(weekStart))}</option>}
            {weeks.map((w) => (
              <option key={w.id} value={w.week_start}>
                {weekTitle(weekDates(w.week_start))}
              </option>
            ))}
          </Select>
          <Button size="icon" variant="ghost" aria-label={t('schedule.nextWeek')} onClick={() => go(shift(7))}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          {weekStart !== thisWeek && (
            <Button size="sm" variant="ghost" onClick={() => go(thisWeek)}>
              {t('schedule.thisWeek')}
            </Button>
          )}
          {week && (
            <>
              {week.version === 0 ? <Badge tone="neutral">{t('schedule.draft')}</Badge> : <Badge tone="done">{t('schedule.published', { version: week.version })}</Badge>}
              {dirty && <Badge tone="warn">{t('schedule.unpublished')}</Badge>}
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {week && canEdit && week.version === 0 && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t('schedule.deleteConfirm')) && run(() => deleteScheduleWeek(week.id))}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('schedule.deleteDraft')}
              </Button>
            )}
            {week && (
              <a href={`/print/schedule/${week.id}`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary">
                  <FileDown className="h-3.5 w-3.5" aria-hidden />
                  {t('schedule.pdf')}
                </Button>
              </a>
            )}
            {week && canEdit && (week.version === 0 || dirty) && (
              <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => publishScheduleWeek(week.id))}>
                <Send className="h-3.5 w-3.5" aria-hidden />
                {week.version === 0 ? t('schedule.publish') : t('schedule.publishChanges', { version: week.version + 1 })}
              </Button>
            )}
          </div>
        </div>
      )}

      {pattern && <p className="mb-3 text-[13px] text-muted">{t('schedule.patternHint')}</p>}
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {!week ? (
        pattern ? (
          <EmptyState
            title={t('schedule.errNoPattern')}
            action={
              canEdit ? (
                <Button variant="primary" size="sm" loading={pending} onClick={() => run(ensureSchedulePattern)}>
                  {t('schedule.create')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            title={t('schedule.notMade')}
            action={
              canEdit ? (
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('schedule.newWeek')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          {canEdit && <p className="mb-2 text-[12px] text-muted">{t('schedule.editHint')}</p>}
          <Card className="overflow-x-auto p-3">
            <div className="min-w-[1080px]">
              <ScheduleSheet
                title={dates ? weekTitle(dates) : t('schedule.tabPattern')}
                tag={pattern ? undefined : week.version === 0 ? t('schedule.draft') : week.version > 1 || dirty ? `v${dirty ? week.version + 1 : week.version}` : undefined}
                dates={dates}
                people={rows}
                blocks={blocks}
                kinds={kinds}
                products={products}
                header={header}
                changed={changed}
                absentDays={absentDays}
                showTotal={canEdit}
                showContract={canEdit}
                showStaffing
                timeCell={
                  canEdit
                    ? ({ personId, day: d, slot, field, text }) => {
                        const key = slotKey(personId, d, slot);
                        return (
                          <TimeInput
                            text={typed[key]?.[field] ?? text}
                            bad={bad.includes(`${key}:${field}`)}
                            label={`${nameOf(personId)} · ${dayLabel(d)} · ${slot} · ${field === 'start' ? t('schedule.from') : t('schedule.until')}`}
                            onCommit={(raw) => typeTime(personId, d, slot, field, raw)}
                          />
                        );
                      }
                    : undefined
                }
                onCell={canEdit ? (personId, d) => setCell({ personId, day: d }) : undefined}
                onDay={canEdit ? setDay : undefined}
              />
            </div>
          </Card>
          <div className="mt-2 space-y-0.5 text-[12px] text-muted">
            {changed.size > 0 && <p>{t('schedule.changedHint', { version: comparedTo })}</p>}
            {Object.keys(absentDays).length > 0 && <p>{t('schedule.absenceHint')}</p>}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* ---- what to look at again ---- */}
            {warnings.length + short.length > 0 && (
              <Card className="p-3.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                  <TriangleAlert className="h-4 w-4 text-warn" aria-hidden />
                  {t('schedule.warnings')}
                </p>
                <ul className="space-y-1 text-[12.5px]">
                  {short.map((s) => (
                    <li key={`short-${s.day}`}>{t('schedule.warnShort', { day: dayLabel(s.day), count: s.count.toFixed(1), need: (s.need ?? 0).toFixed(1) })}</li>
                  ))}
                  {warnings.map((w, i) => (
                    <li key={i}>
                      {w.kind === 'under' && t('schedule.warnUnder', { name: nameOf(w.person_id), hours: formatHours(w.hours), bound: formatHours(w.bound) })}
                      {w.kind === 'over' && t('schedule.warnOver', { name: nameOf(w.person_id), hours: formatHours(w.hours), bound: formatHours(w.bound) })}
                      {w.kind === 'no_lead' && t('schedule.warnNoLead', { day: dayLabel(w.day) })}
                      {w.kind === 'day_off' && t('schedule.warnDayOff', { name: nameOf(w.person_id), day: dayLabel(w.day) })}
                      {w.kind === 'absence' && t('schedule.warnAbsence', { name: nameOf(w.person_id), day: dayLabel(w.day) })}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* ---- the weekly cleaning ---- */}
            {!pattern && canEdit && (
              <Card className="p-3.5">
                <p className="mb-2 text-[13px] font-semibold">{t('schedule.cleaning')}</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['cleaning_bathroom', 'cleaning_kitchen'] as const).map((field) => (
                    <Field key={field} label={field === 'cleaning_bathroom' ? t('schedule.bathrooms') : t('schedule.kitchen')} htmlFor={field}>
                      <Select id={field} value={header[field] ?? ''} disabled={pending} onChange={(e) => run(() => saveScheduleHeader(week.id, { [field]: e.target.value || null }))}>
                        <option value="">—</option>
                        {rows.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}

      {week && cell && (
        <CellDialog
          key={`${cell.personId}-${cell.day}`}
          title={`${nameOf(cell.personId)} — ${dayLabel(cell.day)}`}
          blocks={blocks.filter((b) => b.person_id === cell.personId && b.day === cell.day)}
          kinds={kinds}
          onClose={() => setCell(null)}
          onSave={async (next) => {
            const res = await saveScheduleCell(week.id, cell.personId, cell.day, next);
            if (res.ok) forget(cell.personId, cell.day);
            return res;
          }}
        />
      )}
      {week && day !== null && (
        <DayDialog
          key={day}
          title={dayLabel(day)}
          day={day}
          header={header}
          products={products}
          withHoliday={!pattern}
          onClose={() => setDay(null)}
          onSave={(patch) => saveScheduleHeader(week.id, patch)}
        />
      )}
      {creating && (
        <NewWeekDialog
          weeks={weeks}
          hasPattern={hasPattern}
          // The week after the newest one there is; else the one being looked at.
          initial={weekStart && !week ? weekStart : weeks[0] ? nextDay(weekDates(weeks[0].week_start)[6]) : thisWeek}
          formatWeek={(start) => formatDate(start, 'medium')}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/**
 * A time, typed where it stands on the sheet. "0630" is enough; Enter and Tab
 * go on to the next one. What is not a time stays, outlined, until corrected.
 */
function TimeInput({ text, bad, label, onCommit }: { text: string; bad: boolean; label: string; onCommit: (raw: string) => void }) {
  const [value, setValue] = useState(text);
  useEffect(() => setValue(text), [text]);
  return (
    <input
      data-time
      aria-label={label}
      aria-invalid={bad}
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => (bad || value.trim() !== text) && onCommit(value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = [...(e.currentTarget.closest('table')?.querySelectorAll<HTMLInputElement>('input[data-time]') ?? [])];
        (all[all.indexOf(e.currentTarget) + 1] ?? e.currentTarget).focus();
        if (all.at(-1) === e.currentTarget) e.currentTarget.blur();
      }}
      className="focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-[#2563eb]"
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        minWidth: 40,
        height: 21,
        border: 0,
        padding: 0,
        background: 'transparent',
        color: '#000',
        font: 'inherit',
        textAlign: 'center',
        ...(bad ? { boxShadow: 'inset 0 0 0 2px #dc2626' } : {}),
      }}
    />
  );
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Draft = { kind_id: string; start: string; end: string };

/** A person's day: one or two blocks, each of a kind with its hours. */
function CellDialog({
  title,
  blocks,
  kinds,
  onClose,
  onSave,
}: {
  title: string;
  blocks: Block[];
  kinds: ScheduleKind[];
  onClose: () => void;
  onSave: (blocks: { slot: 1 | 2; start_time: string | null; end_time: string | null; kind_id: string | null }[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const initial = (slot: number): Draft => {
    const b = blocks.find((x) => x.slot === slot);
    return { kind_id: b?.kind_id ?? '', start: b?.start_time ?? '', end: b?.end_time ?? '' };
  };
  const [drafts, setDrafts] = useState<[Draft, Draft]>([initial(1), initial(2)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (i: 0 | 1, patch: Partial<Draft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)) as [Draft, Draft]);
  // A kind switched off since still shows on the block that carries it.
  const options = kinds.filter((k) => k.is_active || drafts.some((d) => d.kind_id === k.id));

  function save(list: [Draft, Draft]) {
    setError(null);
    const next = list
      .map((d, i) => ({ slot: (i + 1) as 1 | 2, start_time: d.start || null, end_time: d.end || null, kind_id: d.kind_id || null }))
      // An untouched line is no block.
      .filter((b) => b.kind_id || b.start_time || b.end_time);
    startTransition(async () => {
      const res = await onSave(next);
      if (!res.ok) return setError(errorText(res.error ?? ''));
      onClose();
      router.refresh();
    });
  }
  const empty: Draft = { kind_id: '', start: '', end: '' };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={t('schedule.wholeDayHint')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" disabled={pending} onClick={() => save([empty, empty])}>
            {t('schedule.clear')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => save(drafts)} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {([0, 1] as const).map((i) => (
          <div key={i}>
            <p className="mb-1.5 text-[12px] font-semibold text-muted">{t('schedule.block', { n: i + 1 })}</p>
            <div className="grid grid-cols-[1fr_7rem_7rem] items-end gap-2">
              <Field label={t('schedule.kind')} htmlFor={`block-kind-${i}`}>
                <Select id={`block-kind-${i}`} value={drafts[i].kind_id} onChange={(e) => set(i, { kind_id: e.target.value })}>
                  <option value="">{t('schedule.production')}</option>
                  {options.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('schedule.from')} htmlFor={`block-from-${i}`}>
                <Input id={`block-from-${i}`} type="time" step={900} value={drafts[i].start} onChange={(e) => set(i, { start: e.target.value })} />
              </Field>
              <Field label={t('schedule.until')} htmlFor={`block-until-${i}`}>
                <Input id={`block-until-${i}`} type="time" step={900} value={drafts[i].end} onChange={(e) => set(i, { end: e.target.value })} />
              </Field>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** A day of the week: what is produced, its note, and whether it is a holiday. */
function DayDialog({
  title,
  day,
  header,
  products,
  withHoliday,
  onClose,
  onSave,
}: {
  title: string;
  day: number;
  header: ScheduleWeekHeader;
  products: ScheduleProduct[];
  withHoliday: boolean;
  onClose: () => void;
  onSave: (patch: Partial<ScheduleWeekHeader>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const key = String(day);
  const [picked, setPicked] = useState<string[]>(header.day_products[key] ?? []);
  const [note, setNote] = useState(header.day_notes[key] ?? '');
  const [holiday, setHoliday] = useState(header.holidays.includes(day));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = products.filter((p) => p.is_active || picked.includes(p.id));

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await onSave({
        day_products: { ...header.day_products, [key]: picked },
        day_notes: { ...header.day_notes, [key]: note.trim() },
        ...(withHoliday ? { holidays: holiday ? [...new Set([...header.holidays, day])] : header.holidays.filter((d) => d !== day) } : {}),
      });
      if (!res.ok) return setError(errorText(res.error ?? ''));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('schedule.products')}>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {options.map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                checked={picked.includes(p.id)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((id) => id !== p.id))}
              />
            ))}
          </div>
        </Field>
        <Field label={t('schedule.dayNote')} htmlFor="day-note">
          <Input id="day-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {withHoliday && <Checkbox label={t('schedule.holiday')} checked={holiday} onChange={(e) => setHoliday(e.target.checked)} />}
      </div>
    </Dialog>
  );
}

/** Start a week: empty, from the usual week, or as a copy of one already made. */
function NewWeekDialog({
  weeks,
  hasPattern,
  initial,
  formatWeek,
  onClose,
}: {
  weeks: { id: string; week_start: string; version: number }[];
  hasPattern: boolean;
  initial: string;
  formatWeek: (weekStart: string) => string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useScheduleErrors();
  const [date, setDate] = useState(initial);
  const [source, setSource] = useState<string>(weeks[0]?.id ?? (hasPattern ? 'pattern' : 'empty'));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!date) return;
    setError(null);
    startTransition(async () => {
      const res = await createScheduleWeek({ date, source });
      if (!res.ok) return setError(errorText(res.error));
      onClose();
      router.push(`/schedule?week=${res.data.week_start}`);
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('schedule.newWeek')}
      description={t('schedule.newWeekHint')}
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!date}>{t('schedule.create')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('schedule.newWeekDay')} required htmlFor="new-week-date" hint={date ? t('schedule.weekOf', { date: weekTitle(weekDates(weekStartOf(date))) }) : undefined}>
          <Input id="new-week-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('schedule.startFrom')} htmlFor="new-week-source">
          <Select id="new-week-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="empty">{t('schedule.startEmpty')}</option>
            {hasPattern && <option value="pattern">{t('schedule.startPattern')}</option>}
            {weeks.slice(0, 26).map((w) => (
              <option key={w.id} value={w.id}>
                {t('schedule.startCopy', { date: formatWeek(w.week_start) })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
