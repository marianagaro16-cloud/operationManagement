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
import { saveProspectListEntry } from '@/server/sales-actions';
import type { ProspectListEntry } from '@/types/sales';

type List = 'sources' | 'lost_reasons';
type Editing = { list: List; row: ProspectListEntry | null };

/**
 * The lists behind prospects: how we found them, and why one was lost.
 * Switched off rather than deleted, because old prospects still name them.
 */
export function SalesConfig({ sources, lostReasons }: { sources: ProspectListEntry[]; lostReasons: ProspectListEntry[] }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Editing | null>(null);

  const section = (list: List, title: string, rows: ProspectListEntry[]) => (
    <section className="mb-5">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        <Button size="sm" variant="secondary" onClick={() => setEditing({ list, row: null })}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('sales.newEntry')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3.5 py-2">
              <p className={cn('min-w-0 flex-1 break-words text-[13px]', !r.is_active && 'text-muted line-through')}>
                {localizedName(r, locale)}
              </p>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveProspectListEntry(
        editing.list,
        {
          name,
          translations: { de: { name: de.trim() || null }, en: { name: en.trim() || null } },
          sort_order: Number(sortOrder) || 100,
          is_active: active,
        },
        editing.row?.id,
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
        <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Dialog>
  );
}
