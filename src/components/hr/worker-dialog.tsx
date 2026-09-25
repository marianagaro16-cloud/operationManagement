'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { saveWorker, type WorkerInput } from '@/server/hr-actions';
import type { Team } from '@/lib/authz';
import type { HrWorker } from '@/types/hr';

/** An app account a file can be linked to. */
export interface HrAccount {
  id: string;
  name: string;
  team: Team;
}

export function useHrError() {
  const { t } = useI18n();
  return (error: string) =>
    error === 'account_already_linked' ? t('hr.errAccountLinked')
      : error === 'not_authorized' ? t('hr.errNotAuthorized')
        : error;
}

/**
 * Who someone is. A worker need not use the app; when they do, linking the
 * account is what lets their file show what they did in it.
 */
export function WorkerDialog({
  worker,
  accounts,
  teams,
  onClose,
}: {
  worker: HrWorker | null;
  /** Accounts not already linked to another file. */
  accounts: HrAccount[];
  /** The teams the viewer may file people under. */
  teams: Team[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useHrError();
  const [form, setForm] = useState<WorkerInput>(
    worker
      ? {
          name: worker.name,
          team: worker.team,
          profile_id: worker.profile_id,
          position: worker.position,
          start_date: worker.start_date,
          phone: worker.phone,
          email: worker.email,
          address: worker.address,
          emergency_contact: worker.emergency_contact,
          is_active: worker.is_active,
          left_on: worker.left_on,
        }
      : { name: '', team: teams[0], profile_id: null, is_active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const teamLabel = (team: Team) => (team === 'production' ? t('roles.teamProduction') : t('roles.teamOperations'));
  const set = (patch: Partial<WorkerInput>) => setForm((f) => ({ ...f, ...patch }));
  const text = (key: keyof WorkerInput) => (form[key] as string | null | undefined) ?? '';

  function chooseAccount(id: string) {
    const account = accounts.find((a) => a.id === id);
    set({
      profile_id: account?.id ?? null,
      // A new file takes the account's name and team; the person may still correct them.
      ...(account && !form.name ? { name: account.name } : {}),
      ...(account && teams.includes(account.team) && !worker ? { team: account.team } : {}),
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveWorker(form, worker?.id);
      if (!res.ok) return setError(errorText(res.error));
      onClose();
      if (!worker) router.push(`/hr/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={worker ? t('hr.editWorker') : t('hr.newWorker')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!form.name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}

        <Field label={t('hr.account')} hint={t('hr.accountHint')} htmlFor="hr-account">
          <Select id="hr-account" value={form.profile_id ?? ''} onChange={(e) => chooseAccount(e.target.value)}>
            <option value="">{t('hr.accountNone')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('hr.name')} required htmlFor="hr-name">
          <Input id="hr-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('roles.team')} htmlFor="hr-team">
            <Select id="hr-team" value={form.team} onChange={(e) => set({ team: e.target.value as Team })}>
              {teams.map((team) => (
                <option key={team} value={team}>{teamLabel(team)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('hr.position')} htmlFor="hr-position">
            <Input id="hr-position" value={text('position')} onChange={(e) => set({ position: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.startDate')} htmlFor="hr-start">
            <Input
              id="hr-start"
              type="date"
              value={text('start_date')}
              onChange={(e) => set({ start_date: e.target.value || null })}
            />
          </Field>
          <Field label={t('hr.phone')} htmlFor="hr-phone">
            <Input id="hr-phone" type="tel" value={text('phone')} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </div>

        <Field label={t('hr.email')} htmlFor="hr-email">
          <Input id="hr-email" type="email" value={text('email')} onChange={(e) => set({ email: e.target.value })} />
        </Field>

        <Field label={t('hr.address')} htmlFor="hr-address">
          <NoteTextarea id="hr-address" rows={2} value={text('address')} onChange={(e) => set({ address: e.target.value })} />
        </Field>

        <Field label={t('hr.emergencyContact')} htmlFor="hr-emergency">
          <Input
            id="hr-emergency"
            value={text('emergency_contact')}
            onChange={(e) => set({ emergency_contact: e.target.value })}
          />
        </Field>

        {worker && (
          <div className="grid grid-cols-2 items-end gap-3">
            <Checkbox
              label={t('hr.active')}
              checked={form.is_active ?? true}
              onChange={(e) => set({ is_active: e.target.checked })}
            />
            {!form.is_active && (
              <Field label={t('hr.leftOn')} htmlFor="hr-left">
                <Input
                  id="hr-left"
                  type="date"
                  value={text('left_on')}
                  onChange={(e) => set({ left_on: e.target.value || null })}
                />
              </Field>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
