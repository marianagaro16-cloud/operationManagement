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
import { saveAgency, setCollectionTeam } from '@/server/collection-actions';
import type { CollectionAgency } from '@/types/collections';

/** Who works collections, and the collection agencies. */
export function CollectionsConfig({ team, agencies, people }: { team: string[]; agencies: CollectionAgency[]; people: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(team);
  const [editing, setEditing] = useState<{ row: CollectionAgency | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = chosen.length !== team.length || chosen.some((id) => !team.includes(id));

  return (
    <>
      <PageHeader title={t('collection.navLabel')} subtitle={t('collection.configSubtitle')} />
      <section className="mb-5">
        <div className="mb-1.5 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('collection.team')}</h2>
          <p className="text-[12px] text-muted">{t('collection.teamHint')}</p>
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
                  className={cn('rounded-full border px-2.5 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg')}
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
              disabled={!changed || chosen.length === 0}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await setCollectionTeam(chosen);
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

      <section className="mb-5">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('collection.agencies')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing({ row: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('sales.newEntry')}
          </Button>
        </div>
        <Card className="overflow-hidden">
          {agencies.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-muted">{t('collection.noAgencies')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {agencies.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3.5 py-2">
                  <p className={cn('min-w-0 flex-1 text-[13px]', !a.is_active && 'text-muted line-through')}>{a.name}</p>
                  {!a.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                  <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ row: a })}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      {editing && <AgencyDialog row={editing.row} onClose={() => setEditing(null)} />}
    </>
  );
}

function AgencyDialog({ row, onClose }: { row: CollectionAgency | null; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(row?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(row?.sort_order ?? 100));
  const [active, setActive] = useState(row?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('common.edit') : t('sales.newEntry')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await saveAgency({ name, sort_order: Number(sortOrder) || 100, is_active: active }, row?.id);
                if (!res.ok) return setError(res.error);
                onClose();
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.name')} required htmlFor="agency-name">
          <Input id="agency-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('hr.sortOrder')} htmlFor="agency-order">
          <Input id="agency-order" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Dialog>
  );
}
