'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { createOneOffTask } from '@/server/planning-actions';
import { TEAMS, type Team } from '@/lib/authz';

/** Who a one-off can be given to. The whole team, or one of these. */
export interface OneOffPerson {
  id: string;
  name: string;
  team: Team;
}

/**
 * An activity that happens once, on one day.
 *
 * Separate from PlanDialog, which places EXISTING definitions on dates: here
 * the activity is written and placed in the same act, because there is no
 * catalogue entry to pick — it happens once and is then finished.
 *
 * Given to one person or left to a team, like the work already on the board:
 * an occurrence with an assignee belongs to that person, and one without is
 * shared by whoever works that team's day.
 */
export function OneOffDialog({
  open,
  onClose,
  date,
  people,
  defaultTeam,
}: {
  open: boolean;
  onClose: () => void;
  /** The day it is placed on — the one selected in the calendar. */
  date: string;
  people: OneOffPerson[];
  /** The creator's own team, which is the likely answer. */
  defaultTeam: Team;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [team, setTeam] = useState<Team>(defaultTeam);
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const teamLabel = (value: Team) =>
    value === 'production' ? t('roles.teamProduction') : t('roles.teamOperations');

  // Given to a person, the activity belongs to that person's team: it is
  // their work, and a team they are not on would only hide it from them.
  function choosePerson(id: string) {
    setAssignee(id);
    const person = people.find((p) => p.id === id);
    if (person) setTeam(person.team);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createOneOffTask({
        title,
        description: notes.trim() || null,
        date,
        team,
        assignee_id: assignee || null,
      });
      if (!res.ok) {
        setError(res.error === 'title_required' ? t('plan.errTitleRequired') : res.error);
        return;
      }
      setTitle(''); setNotes(''); setAssignee('');
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('plan.oneOff')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-[12.5px] text-muted">
          {t('plan.oneOffHint', { date: formatDate(date, 'weekday') })}
        </p>

        <Field label={t('plan.oneOffTitle')} required htmlFor="oneoff-title">
          <Input id="oneoff-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>

        <Field label={t('plan.oneOffNotes')} htmlFor="oneoff-notes">
          <Textarea id="oneoff-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

        <Field label={t('plan.oneOffWho')} hint={t('plan.oneOffWhoHint')} htmlFor="oneoff-who">
          <Select id="oneoff-who" value={assignee} onChange={(e) => choosePerson(e.target.value)}>
            <option value="">{t('plan.oneOffEveryone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('roles.team')} htmlFor="oneoff-team">
          <Select
            id="oneoff-team"
            value={team}
            onChange={(e) => setTeam(e.target.value as Team)}
            // Follows the person it was given to; changing it would only take
            // the activity out of their sight.
            disabled={assignee !== ''}
          >
            {TEAMS.map((value) => (
              <option key={value} value={value}>{teamLabel(value)}</option>
            ))}
          </Select>
        </Field>

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
