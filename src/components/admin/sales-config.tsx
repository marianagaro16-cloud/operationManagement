'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { localizedName } from '@/lib/localized-content';
import { saveActivityKind, saveProspectListEntry } from '@/server/sales-actions';
import { KindIcon } from '@/components/sales/activity-kind';
import { KIND_ICONS, type ActivityKind, type KindIcon as KindIconName, type ProspectListEntry } from '@/types/sales';

type List = 'sources' | 'lost_reasons' | 'kinds' | 'acta_topics';
type Row = ProspectListEntry & Partial<Pick<ActivityKind, 'icon' | 'behavior' | 'default_minutes'>>;
type Editing = { list: List; row: Row | null };

/**
 * The lists behind prospects: how we found them, and why one was lost.
 * Switched off rather than deleted, because old prospects still name them.
 */
export function SalesConfig({
  sources,
  lostReasons,
  kinds,
  actaTopics,
}: {
  sources: ProspectListEntry[];
  lostReasons: ProspectListEntry[];
  /** The kinds of activity: the planning's and the notes'. */
  kinds: ActivityKind[];
  /** What a point of an Acta is about. */
  actaTopics: ProspectListEntry[];
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Editing | null>(null);

  const section = (list: List, title: string, rows: Row[], hint?: string) => (
    <section className="mb-5">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {hint && <p className="text-[12px] text-muted">{hint}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setEditing({ list, row: null })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.newEntry')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3.5 py-2">
              {r.icon && <KindIcon icon={r.icon} className="h-4 w-4 shrink-0 text-accent" />}
              <p className={cn('min-w-0 flex-1 break-words text-[13px]', !r.is_active && 'text-muted line-through')}>
                {localizedName(r, locale)}
              </p>
              {r.behavior === 'visit' && <Badge tone="accent">{t('sales.kindOnRoute')}</Badge>}
              {r.behavior === 'appointment' && <Badge tone="accent">{t('sales.kindHasPlace')}</Badge>}
              {!r.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
              <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ list, row: r })}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );

  return (
    <>
      <PageHeader title={t('sales.navLabel')} subtitle={t('sales.configSubtitle')} />
      {section('sources', t('sales.source'), sources)}
      {section('lost_reasons', t('sales.lostReasons'), lostReasons)}
      {section('kinds', t('sales.kinds'), kinds, t('sales.kindsHint'))}
      {section('acta_topics', t('acta.topics'), actaTopics, t('acta.topicsHint'))}
      {editing && <EntryDialog editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EntryDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const translations = editing.row?.translations ?? {};
  const [name, setName] = useState(editing.row?.name ?? '');
  const [de, setDe] = useState(translations.de?.name ?? '');
  const [en, setEn] = useState(translations.en?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(editing.row?.sort_order ?? 100));
  const [active, setActive] = useState(editing.row?.is_active ?? true);
  const [icon, setIcon] = useState<KindIconName>(editing.row?.icon ?? 'circle');
  const [minutes, setMinutes] = useState(String(editing.row?.default_minutes ?? 30));
  const isKind = editing.list === 'kinds';
  // Visit and Appointment behave; they stay on.
  const fixed = !!editing.row?.behavior && editing.row.behavior !== 'plain';
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const entry = {
        name,
        translations: { de: { name: de.trim() || null }, en: { name: en.trim() || null } },
        sort_order: Number(sortOrder) || 100,
        is_active: fixed ? true : active,
      };
      const res = editing.list === 'kinds'
        ? await saveActivityKind({ ...entry, icon, default_minutes: Math.min(Math.max(Number(minutes) || 30, 5), 600) }, editing.row?.id)
        : await saveProspectListEntry(editing.list, entry, editing.row?.id);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('hr.errNotAuthorized') : res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing.row ? t('common.edit') : t('sales.newEntry')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.name')} required htmlFor="sales-entry-name">
          <Input id="sales-entry-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('hr.sortOrder')} htmlFor="sales-entry-order">
          <Input id="sales-entry-order" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        {isKind && (
          <Field label={t('sales.kindIcon')} htmlFor="sales-entry-icon">
            <div className="flex items-center gap-2">
              <KindIcon icon={icon} className="h-5 w-5 text-accent" />
              <Select id="sales-entry-icon" value={icon} onChange={(e) => setIcon(e.target.value as KindIconName)} className="w-auto">
                {KIND_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            </div>
          </Field>
        )}
        {isKind && (
          <Field label={t('sales.kindMinutes')} hint={t('sales.kindMinutesHint')} htmlFor="sales-entry-minutes">
            <Input
              id="sales-entry-minutes"
              type="number"
              inputMode="numeric"
              min={5}
              max={600}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="max-w-28"
            />
          </Field>
        )}
        {fixed ? (
          <p className="text-[12px] text-muted">{t('sales.kindFixed')}</p>
        ) : (
          <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
        )}
      </div>
    </Dialog>
  );
}
