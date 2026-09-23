'use client';

import { useState, useTransition } from 'react';
import { BellOff, BellRing, Send, Users } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import {
  Badge,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Textarea,
} from '@/components/ui/primitives';
import { sendDirectNotification, type SendOutcome } from '@/server/notify-actions';
import type { NotifiableUser } from '@/server/notifications';
import { requiresOk } from '@/domain/direct-messages';
import type { Role } from '@/lib/authz';
import { NoteTextarea } from '@/components/ui/note-textarea';

const ROLE_LABEL: Record<Role, MessageKey> = {
  admin: 'roles.admin',
  manager: 'roles.manager',
  power_user: 'roles.powerUser',
  production_manager: 'roles.productionManager',
  user: 'roles.user',
};

/** Matches MAX_MESSAGE in the action, which is what actually refuses. */
const MAX_MESSAGE = 400;

/**
 * The refusals this screen can explain.
 *
 * Anything else the action returns is a database message, which is shown
 * verbatim rather than pushed through `t()` — a missing translation falls
 * back to the key, so an unlisted code would render as
 * "notify.error.<postgres text>" and read as a broken screen.
 */
const KNOWN_ERRORS = [
  'invalid_message',
  'invalid_recipient',
  'not_authorized',
  'push_not_configured',
] as const;

/**
 * Compose a direct notification.
 *
 * Deliberately one message field and a list of people. There is no subject
 * line — the notification is titled with the sender's name, which is the only
 * thing a recipient needs in order to know whether to act on it — and no
 * scheduling and no template.
 *
 * People come in two groups, because the message arrives differently: for a
 * User it stays on screen until OK, for everyone else it is an ordinary
 * notification. Each group says so, and each has its own Select all — the
 * common case is still "tell the whole floor", which must not quietly include
 * every admin.
 *
 * What the screen DOES insist on saying is who has no device registered. The
 * message waits in their inbox, but nothing pops up until they open the app;
 * marking them before the send, and naming them again after it, is what stops
 * "I told them" from being false.
 */
export function NotificationSender({ users }: { users: NotifiableUser[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const floor = users.filter((u) => requiresOk(u.role));
  const office = users.filter((u) => !requiresOk(u.role));
  const text = message.trim();
  const canSend = selected.size > 0 && text.length > 0 && text.length <= MAX_MESSAGE;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    // Any edit invalidates the previous result: leaving it on screen would
    // let a stale "sent to 3 people" sit above a different set of 3 people.
    setOutcome(null);
  }

  /** Everyone in one group, or nobody in it; the other group is left alone. */
  function toggleGroup(group: NotifiableUser[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = group.every((u) => next.has(u.id));
      for (const u of group) {
        if (all) next.delete(u.id);
        else next.add(u.id);
      }
      return next;
    });
    setOutcome(null);
  }

  const group = (people: NotifiableUser[], title: MessageKey, hint: MessageKey) => {
    if (people.length === 0) return null;
    const reachableCount = people.filter((u) => u.reachable).length;
    const allSelected = people.every((u) => selected.has(u.id));
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">{t(title)}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {t(hint)} · {t('notify.reachableCount', { reachable: reachableCount, total: people.length })}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => toggleGroup(people)} disabled={pending}>
            {allSelected ? t('notify.selectNone') : t('notify.selectAll')}
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {people.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <Checkbox
                label={displayName(u)}
                checked={selected.has(u.id)}
                disabled={pending}
                onChange={(e) => toggle(u.id, e.target.checked)}
              />
              <div className="flex shrink-0 items-center gap-1.5">
                {!requiresOk(u.role) && <Badge>{t(ROLE_LABEL[u.role])}</Badge>}
                {u.reachable ? (
                  <Badge tone="done">
                    <BellRing className="h-3 w-3" aria-hidden />
                    {t('notify.reachable')}
                  </Badge>
                ) : (
                  <Badge tone="warn" title={t('notify.unreachableHint')}>
                    <BellOff className="h-3 w-3" aria-hidden />
                    {t('notify.unreachable')}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  function send() {
    startTransition(async () => {
      const res = await sendDirectNotification({
        recipient_ids: [...selected],
        message: text,
      });

      if (!res.ok) {
        const known = (KNOWN_ERRORS as readonly string[]).includes(res.error);
        setError(known ? t(`notify.error.${res.error}` as MessageKey) : res.error);
        setOutcome(null);
        return;
      }

      setError(null);
      setOutcome(res.data);
      // The message is gone, not saved as a draft — clearing the box is the
      // honest representation of that, and stops a double tap re-sending it.
      setMessage('');
      setSelected(new Set());
    });
  }

  if (users.length === 0) {
    return (
      <>
        <PageHeader title={t('notify.title')} subtitle={t('notify.subtitle')} />
        <EmptyState
          title={t('notify.noUsers')}
          body={t('notify.noUsersBody')}
          icon={<Users className="h-5 w-5" aria-hidden />}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('notify.title')} subtitle={t('notify.subtitle')} />

      <div className="space-y-4">
        {error && <ErrorState message={error} />}

        {outcome && (
          <Card
            className={
              outcome.delivered === 0
                ? 'border-late/25 bg-late/5 p-3.5'
                : 'border-done/25 bg-done/5 p-3.5'
            }
            role="status"
          >
            <p className="text-[13px] font-medium">
              {outcome.delivered === 0
                ? t('notify.reachedNobody')
                : t('notify.sent', {
                    people: outcome.addressed,
                    devices: outcome.delivered,
                  })}
            </p>
            {outcome.unreachable.length > 0 && (
              <p className="mt-1 text-[12.5px] text-muted">
                {t('notify.notReached', { names: outcome.unreachable.join(', ') })}
              </p>
            )}
          </Card>
        )}

        <Card className="p-4">
          <Field
            label={t('notify.message')}
            hint={t('notify.messageHint')}
            required
            htmlFor="notify-message"
          >
            <NoteTextarea
              id="notify-message"
              value={message}
              maxLength={MAX_MESSAGE}
              placeholder={t('notify.messagePlaceholder')}
              onChange={(e) => {
                setMessage(e.target.value);
                setOutcome(null);
              }}
            />
          </Field>
          <p className="mt-1.5 text-right text-[11.5px] text-subtle">
            {text.length} / {MAX_MESSAGE}
          </p>
        </Card>

        {group(floor, 'notify.groupFloor', 'notify.groupFloorHint')}
        {group(office, 'notify.groupOffice', 'notify.groupOfficeHint')}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted">
            {t('notify.selectedCount', { count: selected.size })}
          </p>
          <Button variant="primary" onClick={send} loading={pending} disabled={!canSend}>
            <Send className="h-3.5 w-3.5" aria-hidden />
            {t('notify.send')}
          </Button>
        </div>
      </div>
    </>
  );
}
