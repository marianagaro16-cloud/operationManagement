'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { ScheduleEditor, defaultConfigFor } from './schedule-editor';
import { saveTask, setTaskActive, type TaskInput } from '@/server/actions';
import { resolveScheduleConfig } from '@/domain/recurrence/engine';
import { FREQUENCIES, type Frequency, type ScheduleConfig } from '@/domain/recurrence/types';
import type { Category, Task } from '@/types/database';

type TaskRow = Task & { category: Category | null };

const EMPTY: TaskInput = {
  title: '',
  description: null,
  category_id: null,
  frequency: 'daily',
  schedule_config: { kind: 'daily' },
  is_skippable: false,
  is_active: true,
};

export function TaskManager({ tasks, categories }: { tasks: TaskRow[]; categories: Category[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();

  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<TaskRow | null>(null);
  const [pending, startTransition] = useTransition();

  // Deep link from the configuration-health card: /admin/tasks?edit=<id>
  useEffect(() => {
    const id = params.get('edit');
    if (!id) return;
    const target = tasks.find((x) => x.id === id);
    if (target) setEditing(target);
  }, [params, tasks]);

  const open = creating || editing !== null;

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

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {tasks.map((task) => {
            const configured = resolveScheduleConfig(task.frequency, task.schedule_config).ok;
            return (
              <li key={task.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-[13.5px] ${!task.is_active ? 'text-muted line-through' : ''}`}>
                      {task.title}
                    </span>
                    {!configured && task.is_active && (
                      <Badge tone="warn">
                        <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                        {t('admin.needsConfig')}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    <span>{t(`frequency.${task.frequency}` as 'frequency.daily')}</span>
                    {task.category && <span>· {task.category.name}</span>}
                    {task.is_skippable && <span>· {t('task.skip')}</span>}
                  </div>
                </div>

                <Badge tone={task.is_active ? 'done' : 'neutral'}>
                  {task.is_active ? t('status.active') : t('status.inactive')}
                </Badge>

                <Button size="icon" variant="ghost" onClick={() => setEditing(task)} aria-label={t('common.edit')}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(task)}>
                  {task.is_active ? t('admin.deactivate') : t('admin.activate')}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      {open && (
        <TaskDialog
          key={editing?.id ?? 'new'}
          task={editing}
          categories={categories}
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
  onClose,
  onSaved,
}: {
  task: TaskRow | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<TaskInput>(
    task
      ? {
          title: task.title,
          description: task.description,
          category_id: task.category_id,
          frequency: task.frequency,
          schedule_config: task.schedule_config,
          is_skippable: task.is_skippable,
          is_active: task.is_active,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unconfigured = !resolveScheduleConfig(form.frequency, form.schedule_config).ok;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveTask(form, task?.id);
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
          <Button variant="primary" onClick={submit} loading={pending} disabled={!form.title.trim()}>
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
          <Textarea
            id="task-desc"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value || null })}
          />
        </Field>

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
                // Switching frequency resets the schedule to that
                // frequency's default — or to null when none exists.
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

        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="mb-2.5 text-[13px] font-medium">{t('admin.scheduleTitle')}</p>
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
