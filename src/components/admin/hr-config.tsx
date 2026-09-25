'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { saveCriterion, saveNoteType } from '@/server/hr-actions';
import { TEAMS, type Team } from '@/lib/authz';
import { localizedName, localizedNameDescription } from '@/lib/localized-content';
import type { HrCriterion, HrNoteType, HrTranslations } from '@/types/hr';

type Editing =
  | { kind: 'type'; row: HrNoteType | null }
  | { kind: 'criterion'; row: HrCriterion | null; team: Team };

/**
 * The lists behind worker files: the kinds of note the log takes, and what an
 * evaluation rates for each team. Switched off rather than deleted, because
 * old notes and evaluations still name them.
 */
export function HrConfig({ noteTypes, criteria }: { noteTypes: HrNoteType[]; criteria: HrCriterion[] }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<Editing | null>(null);
  const teamLabel = (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));

  const row = (key: string, name: string, active: boolean, extra: string | null, onEdit: () => void) => (
    <li key={key} className="flex items-center gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <p className={cn('break-words text-[13px]', !active && 'text-muted line-through')}>{name}</p>
        {extra && <p className="text-[12px] text-muted">{extra}</p>}
      </div>
      {!active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
      <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </li>
  );

  return (
    <>
      <PageHeader title={t('hr.navLabel')} subtitle={t('hr.configSubtitle')} />

      <section className="mb-5">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('hr.noteTypes')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing({ kind: 'type', row: null })}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('hr.newNoteType')}
          </Button>
        </div>
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {noteTypes.map((ty) =>
              row(ty.id, localizedName(ty, locale), ty.is_active, null, () => setEditing({ kind: 'type', row: ty })),
            )}
          </ul>
        </Card>
      </section>

      {TEAMS.map((team) => {
        const list = criteria.filter((c) => c.team === team);
        return (
          <section key={team} className="mb-5">
            <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
              <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {t('hr.criteria')} · {teamLabel(team)}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing({ kind: 'criterion', row: null, team })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('hr.newCriterion')}
              </Button>
            </div>
            {list.length === 0 ? (
              <EmptyState title={t('hr.noCriteria')} />
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {list.map((c) =>
                    row(
                      c.id,
                      localizedName(c, locale),
                      c.is_active,
                      localizedNameDescription(c, locale),
                      () => setEditing({ kind: 'criterion', row: c, team }),
                    ),
                  )}
                </ul>
              </Card>
            )}
          </section>
        );
      })}

      {editing && <ListDialog editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ListDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const isType = editing.kind === 'type';
  const [name, setName] = useState(editing.row?.name ?? '');
  const [description, setDescription] = useState(
    editing.kind === 'criterion' ? editing.row?.description ?? '' : '',
  );
  const [team, setTeam] = useState<Team>(editing.kind === 'criterion' ? editing.row?.team ?? editing.team : 'operations');
  const [sortOrder, setSortOrder] = useState(String(editing.row?.sort_order ?? 100));
  const initial: HrTranslations = editing.row?.translations ?? {};
  const [tr, setTr] = useState({
    deName: initial.de?.name ?? '',
    enName: initial.en?.name ?? '',
    deDescription: initial.de?.description ?? '',
    enDescription: initial.en?.description ?? '',
  });
  const [active, setActive] = useState(editing.row?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const teamLabel = (value: Team) => (value === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));

  function submit() {
    setError(null);
    startTransition(async () => {
      const translations = {
        de: { name: tr.deName.trim() || null, ...(isType ? {} : { description: tr.deDescription.trim() || null }) },
        en: { name: tr.enName.trim() || null, ...(isType ? {} : { description: tr.enDescription.trim() || null }) },
      };
      const common = { name, translations, sort_order: Number(sortOrder) || 100, is_active: active };
      const res = isType
        ? await saveNoteType(common, editing.row?.id)
        : await saveCriterion({ ...common, team, description: description || null }, editing.row?.id);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('hr.errNotAuthorized') : res.error);
      onClose();
      router.refresh();
    });
  }

  const title = editing.row
    ? t('common.edit')
    : isType ? t('hr.newNoteType') : t('hr.newCriterion');

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('hr.name')} required htmlFor="hr-list-name">
          <Input id="hr-list-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={tr.deName} onChange={(e) => setTr({ ...tr, deName: e.target.value })} />
          </Field>
          <Field label="English">
            <Input value={tr.enName} onChange={(e) => setTr({ ...tr, enName: e.target.value })} />
          </Field>
        </div>
        {!isType && (
          <>
            <Field label={t('hr.description')} htmlFor="hr-list-desc">
              <Input id="hr-list-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${t('hr.description')} · Deutsch`}>
                <Input value={tr.deDescription} onChange={(e) => setTr({ ...tr, deDescription: e.target.value })} />
              </Field>
              <Field label={`${t('hr.description')} · English`}>
                <Input value={tr.enDescription} onChange={(e) => setTr({ ...tr, enDescription: e.target.value })} />
              </Field>
            </div>
            <Field label={t('roles.team')} htmlFor="hr-list-team">
              <Select id="hr-list-team" value={team} onChange={(e) => setTeam(e.target.value as Team)}>
                {TEAMS.map((value) => (
                  <option key={value} value={value}>{teamLabel(value)}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label={t('hr.sortOrder')} htmlFor="hr-list-order">
          <Input
            id="hr-list-order"
            type="number"
            inputMode="numeric"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </Field>
        <Checkbox label={t('status.active')} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Dialog>
  );
}
