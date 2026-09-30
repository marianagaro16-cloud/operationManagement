'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { localizedName } from '@/lib/localized-content';
import { saveAbsenceType, setAbsenceApprovers } from '@/server/absence-actions';
import { saveWorkingHours, setNeedsCover } from '@/server/coverage-actions';
import type { WorkingHours } from '@/domain/absences/coverage';
import { useAbsenceLabels } from '@/components/absences/absence-parts';
import type { AbsenceType } from '@/types/absences';

/** The lists behind absences: who approves them, and their types. */
export function AbsencesConfig({
  types,
  approvers,
  people,
  hours,
  needsCover,
}: {
  types: AbsenceType[];
  approvers: string[];
  people: { id: string; name: string }[];
  hours: WorkingHours;
  needsCover: string[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const labels = useAbsenceLabels();
  const [chosen, setChosen] = useState<string[]>(approvers);
  const [editing, setEditing] = useState<{ row: AbsenceType | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = chosen.length !== approvers.length || chosen.some((id) => !approvers.includes(id));

  function saveApprovers() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setAbsenceApprovers(chosen);
      if (!res.ok) return setError(labels.error(res.error));
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader title={t('absence.navLabel')} subtitle={t('absence.configSubtitle')} />

      <section className="mb-5">
        <div className="mb-1.5 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('absence.approvers')}</h2>
          <p className="text-[12px] text-muted">{t('absence.approversHint')}</p>
        </div>
        <Card className="p-3">
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => {
              const on = chosen.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSaved(false);
                    setChosen(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id]);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12.5px]',
                    on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={saveApprovers} loading={pending} disabled={!changed || chosen.length === 0}>
              {t('common.save')}
            </Button>
            {saved && !changed && <span className="text-[12px] text-done">{t('absence.approversSaved')}</span>}
          </div>
        </Card>
      </section>

      <NeedsCoverSection people={people} initial={needsCover} />
      <HoursSection initial={hours} />

      <section className="mb-5">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('absence.types')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing({ row: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('sales.newEntry')}
          </Button>
        </div>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {types.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-2">
                <p className={cn('min-w-0 flex-1 break-words text-[13px]', !r.is_active && 'text-muted line-through')}>
                  {localizedName(r, locale)}
                </p>
                {!r.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ row: r })}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {editing && <TypeDialog row={editing.row} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Who must be covered when away: only their absences get "no coverage" warnings. */
function NeedsCoverSection({ people, initial }: { people: { id: string; name: string }[]; initial: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = chosen.length !== initial.length || chosen.some((id) => !initial.includes(id));

  return (
    <section className="mb-5">
      <div className="mb-1.5 px-0.5">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('coverage.needsCoverTitle')}</h2>
        <p className="text-[12px] text-muted">{t('coverage.needsCoverHint')}</p>
      </div>
      <Card className="p-3">
        {error && <div className="mb-2"><ErrorState message={error} /></div>}
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => {
            const on = chosen.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSaved(false);
                  setChosen(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id]);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12.5px]',
                  on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                )}
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!changed}
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await setNeedsCover(chosen);
                if (!res.ok) return setError(res.error);
                setSaved(true);
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
          {saved && !changed && <span className="text-[12px] text-done">{t('absence.approversSaved')}</span>}
        </div>
      </Card>
    </section>
  );
}

/** The working week coverage has to fill. */
function HoursSection({ initial }: { initial: WorkingHours }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [days, setDays] = useState<number[]>(initial.days);
  const [start, setStart] = useState(initial.start);
  const [noon, setNoon] = useState(initial.noon);
  const [end, setEnd] = useState(initial.end);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const valid = days.length > 0 && start < noon && noon < end;
  // Monday..Sunday in the reader's language: 2024-01-01 was a Monday.
  const dayName = (d: number) => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });

  return (
    <section className="mb-5">
      <div className="mb-1.5 px-0.5">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('coverage.hoursTitle')}</h2>
        <p className="text-[12px] text-muted">{t('coverage.hoursHint')}</p>
      </div>
      <Card className="space-y-3 p-3">
        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSaved(false);
                  setDays(on ? days.filter((x) => x !== d) : [...days, d]);
                }}
                className={cn(
                  'w-12 rounded-lg border py-1 text-[12.5px] capitalize',
                  on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                )}
              >
                {dayName(d)}
              </button>
            );
          })}
        </div>
        <div className="grid max-w-md grid-cols-3 gap-2">
          <Field label={t('coverage.from')} htmlFor="hours-start">
            <Input id="hours-start" type="time" value={start} onChange={(e) => { setSaved(false); setStart(e.target.value); }} />
          </Field>
          <Field label={t('coverage.noon')} htmlFor="hours-noon">
            <Input id="hours-noon" type="time" value={noon} onChange={(e) => { setSaved(false); setNoon(e.target.value); }} />
          </Field>
          <Field label={t('coverage.until')} htmlFor="hours-end">
            <Input id="hours-end" type="time" value={end} onChange={(e) => { setSaved(false); setEnd(e.target.value); }} />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!valid}
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await saveWorkingHours({ days, start, noon, end });
                if (!res.ok) return setError(res.error === 'invalid_hours' ? t('coverage.errHours') : res.error);
                setSaved(true);
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
          {saved && <span className="text-[12px] text-done">{t('absence.approversSaved')}</span>}
        </div>
      </Card>
    </section>
  );
}

function TypeDialog({ row, onClose }: { row: AbsenceType | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(row?.name ?? '');
  const [de, setDe] = useState(row?.translations.de?.name ?? '');
  const [en, setEn] = useState(row?.translations.en?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(row?.sort_order ?? 100));
  const [active, setActive] = useState(row?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveAbsenceType(
        {
          name,
          translations: { de: { name: de.trim() || null }, en: { name: en.trim() || null } },
          sort_order: Number(sortOrder) || 100,
          is_active: active,
        },
        row?.id,
      );
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('hr.errNotAuthorized') : res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('common.edit') : t('sales.newEntry')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.name')} required htmlFor="absence-type-name">
          <Input id="absence-type-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('hr.sortOrder')} htmlFor="absence-type-order">
          <Input id="absence-type-order" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Dialog>
  );
}
