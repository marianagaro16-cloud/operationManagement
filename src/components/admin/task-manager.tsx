'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { DateTime, Info } from 'luxon';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import { ScheduleEditor, defaultConfigFor } from './schedule-editor';
import { saveTask, setTaskActive, type TaskInput } from '@/server/actions';
import { resolveScheduleConfig } from '@/domain/recurrence/engine';
import { FREQUENCIES, type Frequency, type ScheduleConfig } from '@/domain/recurrence/types';
import { TEAMS, type Team } from '@/lib/authz';
import type { Category, Task } from '@/types/database';
import type { OneOffPerson } from '@/components/calendar/one-off-dialog';
import { PeoplePicker } from '@/components/tasks/people-picker';
import { Combobox } from '@/components/ui/combobox';
import { teamLabelKey } from '@/lib/authz';

type TaskRow = Task & { frequency: Frequency; category: Category | null; assignee_ids: string[] };

function useTeamLabel() {
  const { t } = useI18n();
  return (team: Team) => (t(teamLabelKey(team)));
}

const EMPTY: TaskInput = {
  title: '',
  description: null,
  translations: {},
  category_id: null,
  // Placed on days as the operation needs it; 'daily' is for what must appear every day.
  frequency: 'as_needed',
  schedule_config: { kind: 'as_needed' },
  is_skippable: false,
  is_active: true,
  team: 'operations',
  assignee_ids: [],
  product_id: null,
  target_quantity: null,
  equipment_id: null,
};

export function TaskManager({
  tasks,
  categories,
  ownTeams,
  people,
  reminderViewerId,
  products = [],
  equipment = [],
}: {
  /** For maintenance activities: the machine they are about. */
  equipment?: { id: string; name: string }[];
  /** For production orders: what can be made. */
  products?: { id: string; name: string }[];
  tasks: TaskRow[];
  categories: Category[];
  /** Set when the viewer configures only their own team's activities: the team is fixed. */
  /** Set when the viewer configures only the areas they run. */
  ownTeams: Team[] | null;
  /** Who an activity can be given to. */
  people: OneOffPerson[];
  /** Null when the viewer cannot use reminders; the row button then renders nothing. */
  reminderViewerId: string | null;
}) {
  const { t, locale } = useI18n();
  const teamLabel = useTeamLabel();
  const router = useRouter();
  const params = useSearchParams();

  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<TaskRow | null>(null);
  // Each area of work has its own space: a tab, its activities in one list.
  const areas = useMemo(() => {
    const present = new Set(tasks.map((x) => x.team));
    const base: Team[] = ownTeams ?? ['logistics', 'operations', 'production', 'maintenance'];
    return [...base, ...TEAMS.filter((tm) => present.has(tm) && !base.includes(tm))];
  }, [tasks, ownTeams]);
  const [area, setArea] = useState<Team>(() => (ownTeams?.[0] ?? 'operations'));
  const [showInactive, setShowInactive] = useState(false);
  const [pending, startTransition] = useTransition();

  // Deep link from the configuration-health card: /admin/tasks?edit=<id>
  useEffect(() => {
    const id = params.get('edit');
    if (!id) return;
    const target = tasks.find((x) => x.id === id);
    if (target) {
      setArea(target.team);
      setEditing(target);
    }
  }, [params, tasks]);

  const inArea = tasks.filter((x) => x.team === area);
  const byTitle = (a: TaskRow, b: TaskRow) => a.title.localeCompare(b.title, 'es');
  const active = inArea.filter((x) => x.is_active).sort(byTitle);
  const inactive = inArea.filter((x) => !x.is_active).sort(byTitle);

  // "Semanal · jue", "Diaria", "Mensual": how often, on the row itself.
  const when = (task: TaskRow) => {
    const freq = t(`frequency.${task.frequency}` as 'frequency.daily');
    const config = task.schedule_config as ScheduleConfig | null;
    const weekday = (n: number) => Info.weekdays('short', { locale })[n - 1];
    if (config?.kind === 'weekly') return `${freq} · ${weekday(config.weekday)}`;
    if (config?.kind === 'biweekly' && config.anchorDate) return `${freq} · ${weekday(DateTime.fromISO(config.anchorDate).weekday)}`;
    if (config?.kind === 'daily' && config.weekdays?.length) return `${freq} · ${config.weekdays.map(weekday).join(', ')}`;
    return freq;
  };

  const open = creating || editing !== null;

  const renderRow = (task: TaskRow) => {
    const configured = resolveScheduleConfig(task.frequency, task.schedule_config).ok;
    return (
      <li
        key={task.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5"
      >
        {/* Title block: takes the row on phones, shares it from sm up.
            min-w-0 keeps a long title inside the card; it WRAPS
            rather than truncating, because titles run to 98
            characters and an ellipsis with a hover tooltip is no
            answer on the phone this is read on. */}
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <p
            className={cn(
              'break-words text-[13.5px]',
              !task.is_active && 'text-muted line-through',
            )}
          >
            {task.title}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
            <span>{when(task)}</span>
            {task.product_id && <span className="font-medium text-accent">· {t('production.badge', { quantity: Number(task.target_quantity) })}</span>}
            {task.assignee_ids.length > 0 && (
              <span>
                ·{' '}
                {task.assignee_ids
                  .map((id) => people.find((p) => p.id === id)?.name ?? '—')
                  .join(', ')}
              </span>
            )}
            {task.category && <span>· {task.category.name}</span>}
            {task.is_skippable && <span>· {t('task.skip')}</span>}
            {!configured && task.is_active && (
              <span className="inline-flex items-center gap-1 text-warn">
                · <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                {t('admin.needsConfig')}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Badge tone={task.is_active ? 'done' : 'neutral'}>
            {task.is_active ? t('status.active') : t('status.inactive')}
          </Badge>
          <QuickReminderButton
            viewerId={reminderViewerId}
            variant="ghost"
            link={{ type: 'task', id: task.id, label: task.title }}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setEditing(task)}
            aria-label={t('common.edit')}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(task)}>
            {task.is_active ? t('admin.deactivate') : t('admin.activate')}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title={t('admin.tasksTitle')}
        subtitle={t('admin.tasksSubtitle')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('admin.newTask')}
          </Button>
        }
      />

      {/* One tab per area of work. */}
      {areas.length > 1 && (
        <div className="-mt-2 mb-3 flex gap-1 overflow-x-auto border-b border-border">
          {areas.map((tm) => (
            <button
              key={tm}
              type="button"
              onClick={() => { setArea(tm); setShowInactive(false); }}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                area === tm ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {teamLabel(tm)}
              <span className="ml-1.5 text-[11px] tabular text-subtle">{tasks.filter((x) => x.team === tm && x.is_active).length}</span>
            </button>
          ))}
        </div>
      )}

      {active.length === 0 ? (
        <EmptyState title={t('admin.noActivitiesInArea')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">{active.map(renderRow)}</ul>
        </Card>
      )}

      {inactive.length > 0 && (
        <section className="mt-5">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="mb-1.5 text-[12.5px] font-semibold text-muted hover:text-fg"
          >
            {t('admin.inactiveActivities', { count: inactive.length })}
          </button>
          {showInactive && (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">{inactive.map(renderRow)}</ul>
            </Card>
          )}
        </section>
      )}

      {open && (
        <TaskDialog
          key={editing?.id ?? 'new'}
          task={editing}
          categories={categories}
          ownTeams={ownTeams}
          defaultTeam={area}
          people={people}
          products={products}
          equipment={equipment}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            router.replace('/admin/tasks');
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.replace('/admin/tasks');
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        loading={pending}
        title={confirm?.is_active ? t('admin.deactivate') : t('admin.activate')}
        message={confirm?.is_active ? t('admin.deactivateConfirm') : t('admin.activateConfirm')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        destructive={confirm?.is_active}
        onConfirm={() => {
          if (!confirm) return;
          startTransition(async () => {
            await setTaskActive(confirm.id, !confirm.is_active);
            setConfirm(null);
            router.refresh();
          });
        }}
      />
    </>
  );
}

function TaskDialog({
  task,
  categories,
  ownTeams,
  defaultTeam,
  people,
  products,
  equipment,
  onClose,
  onSaved,
}: {
  /** The area whose tab is open: a new activity starts there. */
  defaultTeam: Team;
  /** For maintenance activities: the machine they are about. */
  equipment: { id: string; name: string }[];
  products: { id: string; name: string }[];
  task: TaskRow | null;
  categories: Category[];
  ownTeams: Team[] | null;
  people: OneOffPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const teamLabel = useTeamLabel();
  const [form, setForm] = useState<TaskInput>(
    task
      ? {
          title: task.title,
          description: task.description,
          translations: (task.translations ?? {}) as TaskInput['translations'],
          category_id: task.category_id,
          frequency: task.frequency,
          schedule_config: task.schedule_config,
          is_skippable: task.is_skippable,
          is_active: task.is_active,
          team: task.team,
          assignee_ids: task.assignee_ids,
          product_id: task.product_id ?? null,
          equipment_id: task.equipment_id ?? null,
          target_quantity: task.target_quantity != null ? Number(task.target_quantity) : null,
        }
      : { ...EMPTY, team: defaultTeam },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unconfigured = !resolveScheduleConfig(form.frequency, form.schedule_config).ok;
  // A production order: completed by recording what was made, not by a tick.
  const [isProduction, setIsProduction] = useState(!!task?.product_id);
  const [quantity, setQuantity] = useState(task?.target_quantity != null ? String(Number(task.target_quantity)) : '');
  const productionReady = !isProduction || (!!form.product_id && Number(quantity.replace(',', '.')) > 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveTask(
        isProduction
          ? { ...form, target_quantity: Number(quantity.replace(',', '.')) }
          : { ...form, product_id: null, target_quantity: null },
        task?.id,
      );
      if (!res.ok) return setError(res.error);
      onSaved();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={task ? t('admin.editTask') : t('admin.newTask')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!form.title.trim() || !productionReady}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label={t('admin.taskTitle')} required htmlFor="task-title">
          <Input
            id="task-title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
        </Field>

        <Field label={t('admin.taskDescription')} htmlFor="task-desc">
          <NoteTextarea
            id="task-desc"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value || null })}
          />
        </Field>

        {/* Translations. Spanish above is the source; leaving one of these
            empty simply falls back to it, so partial coverage is fine. */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[13px] font-medium">{t('admin.translationsTitle')}</p>
          <p className="mt-0.5 text-[12px] text-muted">{t('admin.translationsHint')}</p>
          <div className="mt-2.5 space-y-2.5">
            {(['de', 'en'] as const).map((loc) => (
              <Field
                key={loc}
                label={t(`language.${loc}` as 'language.de')}
                htmlFor={`task-title-${loc}`}
              >
                <Input
                  id={`task-title-${loc}`}
                  value={form.translations?.[loc]?.title ?? ''}
                  placeholder={form.title || undefined}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      translations: {
                        ...form.translations,
                        [loc]: { ...form.translations?.[loc], title: e.target.value || null },
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        {/* Who does it: each person ticked completes their own copy. The first
            one chosen also decides the team, when nobody was chosen before. */}
        <Field label={t('admin.taskAssignee')} hint={t('admin.taskAssigneeHint')}>
          <PeoplePicker
            people={people}
            selected={form.assignee_ids ?? []}
            onChange={(ids) => {
              const first = form.assignee_ids?.length || ownTeams ? null : people.find((p) => p.id === ids[0]);
              setForm({ ...form, assignee_ids: ids, team: first?.team ?? form.team });
            }}
          />
        </Field>

        {/* Whose work this is: a User sees only their own team's tasks. */}
        <Field label={t('task.teamLabel')} hint={t('roles.teamHint')} htmlFor="task-team">
          <Select
            id="task-team"
            value={form.team}
            onChange={(e) => setForm({ ...form, team: e.target.value as Team })}
            // An area's manager files activities under the areas they run only.
            disabled={ownTeams !== null && ownTeams.length < 2}
          >
            {(ownTeams ?? TEAMS).map((team) => (
              <option key={team} value={team}>{teamLabel(team)}</option>
            ))}
          </Select>
        </Field>

        {/* A maintenance activity can be about a machine: its days become the machine's history. */}
        {form.team === 'maintenance' && equipment.length > 0 && (
          <Field label={t('equipment.forActivity')} hint={t('equipment.forActivityHint')} htmlFor="task-equipment">
            <Select id="task-equipment" value={form.equipment_id ?? ''} onChange={(e) => setForm({ ...form, equipment_id: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {equipment.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </Select>
          </Field>
        )}

        <div className="space-y-2 rounded-lg border border-border p-3">
          <Checkbox
            label={t('production.isOrder')}
            checked={isProduction}
            onChange={(e) => setIsProduction(e.target.checked)}
          />
          {isProduction && (
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label={t('production.product')} required htmlFor="task-product">
                <Combobox
                  id="task-product"
                  items={products}
                  value={form.product_id ?? null}
                  onChange={(id) => setForm({ ...form, product_id: id })}
                  getKey={(p) => p.id}
                  getLabel={(p) => p.name}
                  getSearchText={(p) => p.name}
                />
              </Field>
              <Field label={t('production.quantity')} required htmlFor="task-qty">
                <Input id="task-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="tabular" />
              </Field>
            </div>
          )}
          {isProduction && <p className="text-[12px] text-muted">{t('production.isOrderHint')}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.taskCategory')} htmlFor="task-cat">
            <Select
              id="task-cat"
              value={form.category_id ?? ''}
              onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
            >
              <option value="">{t('common.none')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('admin.taskFrequency')} htmlFor="task-freq">
            <Select
              id="task-freq"
              value={form.frequency}
              onChange={(e) => {
                const frequency = e.target.value as Frequency;
                // Switching frequency resets the schedule to that frequency's
                // default — or to null when none exists.
                setForm({ ...form, frequency, schedule_config: defaultConfigFor(frequency) });
              }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`frequency.${f}` as 'frequency.daily')}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Only the daily checklist still runs from a rule. Everything else is
            put on a date from the calendar, so asking for a schedule here
            would be collecting a setting that nothing reads. */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="mb-2.5 text-[13px] font-medium">{t('admin.scheduleTitle')}</p>
          {form.frequency === 'daily' ? (
            <>
              <ScheduleEditor
                frequency={form.frequency}
                value={form.schedule_config as ScheduleConfig | null}
                onChange={(schedule_config) => setForm({ ...form, schedule_config })}
              />
              {unconfigured && (
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warn">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {t('admin.needsConfig')}
                </p>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-muted">{t('plan.manualNote')}</p>
          )}
        </div>

        <Checkbox
          label={t('admin.taskSkippable')}
          hint={t('admin.taskSkippableHint')}
          checked={form.is_skippable}
          onChange={(e) => setForm({ ...form, is_skippable: e.target.checked })}
        />

        <Checkbox
          label={t('admin.taskActive')}
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
        />

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
