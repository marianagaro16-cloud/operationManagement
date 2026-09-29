'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { localizedName } from '@/lib/localized-content';
import { removeKindTask, saveEventEntry, saveKindTask } from '@/server/event-actions';
import type { EventKindTask, EventListEntry } from '@/types/events';

type List = 'kinds' | 'cost_types';

/**
 * The lists behind events: their kinds, each with its standard tasks, and
 * the kinds of cost. Switched off rather than deleted: old events name them.
 */
export function EventsConfig({
  kinds,
  kindTasks,
  costTypes,
}: {
  kinds: EventListEntry[];
  kindTasks: EventKindTask[];
  costTypes: EventListEntry[];
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<{ list: List; row: EventListEntry | null } | null>(null);
  const [task, setTask] = useState<{ kindId: string; row: EventKindTask | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const deadline = (x: EventKindTask) =>
    x.anchor === 'end'
      ? t('event.deadlineAfterEnd', { days: x.days })
      : x.days === 0
        ? t('event.deadlineOnStart')
        : x.days < 0
          ? t('event.deadlineBeforeStart', { days: -x.days })
          : t('event.deadlineAfterStart', { days: x.days });

  const header = (list: List, title: string, hint?: string) => (
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
  );

  const name = (r: EventListEntry) => (
    <p className={cn('min-w-0 flex-1 break-words text-[13px]', !r.is_active && 'text-muted line-through')}>{localizedName(r, locale)}</p>
  );

  return (
    <>
      <PageHeader title={t('event.navLabel')} subtitle={t('event.configSubtitle')} />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <section className="mb-5">
        {header('kinds', t('event.kinds'), t('event.kindsHint'))}
        <div className="space-y-2">
          {kinds.map((k) => {
            const tasks = kindTasks.filter((x) => x.kind_id === k.id);
            return (
              <Card key={k.id} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border px-3.5 py-2">
                  {name(k)}
                  {!k.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                  <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ list: 'kinds', row: k })}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <ul className="divide-y divide-border">
                  {tasks.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 py-1.5 pl-6 pr-3.5">
                      <p className="min-w-0 flex-1 break-words text-[13px]">{localizedName({ name: x.title, translations: x.translations }, locale)}</p>
                      <span className="shrink-0 text-[12px] text-muted">{deadline(x)}</span>
                      <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setTask({ kindId: k.id, row: x })}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('common.delete')}
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const res = await removeKindTask(x.id);
                            if (!res.ok) return setError(res.error === 'not_authorized' ? t('hr.errNotAuthorized') : res.error);
                            router.refresh();
                          });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                  <li className="py-1 pl-4 pr-3.5">
                    <Button size="sm" variant="ghost" onClick={() => setTask({ kindId: k.id, row: null })}>
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      {t('event.addStandardTask')}
                    </Button>
                  </li>
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mb-5">
        {header('cost_types', t('event.costTypes'))}
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {costTypes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3.5 py-2">
                {name(c)}
                {!c.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ list: 'cost_types', row: c })}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {editing && <EntryDialog list={editing.list} row={editing.row} onClose={() => setEditing(null)} />}
      {task && <KindTaskDialog kindId={task.kindId} row={task.row} onClose={() => setTask(null)} />}
    </>
  );
}

function EntryDialog({ list, row, onClose }: { list: List; row: EventListEntry | null; onClose: () => void }) {
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
      const res = await saveEventEntry(
        list,
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
        <Field label={t('hr.name')} required htmlFor="event-entry-name">
          <Input id="event-entry-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('hr.sortOrder')} htmlFor="event-entry-order">
          <Input id="event-entry-order" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Dialog>
  );
}

type When = 'before' | 'after' | 'end';

function KindTaskDialog({ kindId, row, onClose }: { kindId: string; row: EventKindTask | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(row?.title ?? '');
  const [de, setDe] = useState(row?.translations.de?.name ?? '');
  const [en, setEn] = useState(row?.translations.en?.name ?? '');
  // Said the way people think of it: so many days before the start, after it, or after the end.
  const [when, setWhen] = useState<When>(row ? (row.anchor === 'end' ? 'end' : row.days < 0 ? 'before' : 'after') : 'before');
  const [days, setDays] = useState(String(row ? Math.abs(row.days) : 7));
  const [sortOrder, setSortOrder] = useState(String(row?.sort_order ?? 100));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const n = Math.min(Math.max(Math.round(Number(days) || 0), 0), 365);

  function submit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveKindTask(
        {
          kind_id: kindId,
          title,
          translations: { de: { name: de.trim() || null }, en: { name: en.trim() || null } },
          anchor: when === 'end' ? 'end' : 'start',
          days: when === 'before' ? -n : n,
          sort_order: Number(sortOrder) || 100,
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
      title={row ? t('common.edit') : t('event.addStandardTask')}
      description={t('event.standardTaskHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('event.taskTitle')} required htmlFor="kind-task-title">
          <Input id="kind-task-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={en} onChange={(e) => setEn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('event.deadline')} htmlFor="kind-task-days">
          <div className="flex items-center gap-2">
            <Input
              id="kind-task-days"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="max-w-20"
            />
            <Select aria-label={t('event.deadline')} value={when} onChange={(e) => setWhen(e.target.value as When)} className="w-auto">
              <option value="before">{t('event.daysBeforeStart')}</option>
              <option value="after">{t('event.daysAfterStart')}</option>
              <option value="end">{t('event.daysAfterEnd')}</option>
            </Select>
          </div>
        </Field>
        <Field label={t('hr.sortOrder')} htmlFor="kind-task-order">
          <Input id="kind-task-order" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
