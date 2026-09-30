'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Printer, Send } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Select } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { attachSummary, sendSummary } from '@/server/summary-actions';
import type { SalesSummary } from '@/types/summaries';
import { SummaryView } from './summary-view';

/** A saved summary: to print, send, or attach to a meeting — the sharing is for sales. */
export function SummaryPage({
  summary,
  canShare,
  people,
  meetings,
}: {
  summary: SalesSummary;
  canShare: boolean;
  people: { id: string; name: string }[];
  /** Upcoming meetings the viewer is part of, to attach it to. */
  meetings: { id: string; label: string }[];
}) {
  const { t, formatDate } = useI18n();
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={summary.title}
        subtitle={[summary.author, formatDate(summary.created_at.slice(0, 10), 'medium')].filter(Boolean).join(' · ')}
        action={
          <div className="flex flex-wrap justify-end gap-1.5">
            <a href={`/print/summaries/${summary.id}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">
                <Printer className="h-3.5 w-3.5" aria-hidden />
                {t('summary.print')}
              </Button>
            </a>
            {canShare && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setSending(true)}>
                  <Send className="h-3.5 w-3.5" aria-hidden />
                  {t('summary.send')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAttaching(true)}>
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {t('summary.attach')}
                </Button>
              </>
            )}
          </div>
        }
      />
      {done && <p className="mb-3 text-[12.5px] font-medium text-done">{done}</p>}
      <SummaryView content={summary.content} from={summary.period_from} to={summary.period_to} />
      {sending && <SendDialog summaryId={summary.id} people={people} onClose={() => setSending(false)} onDone={setDone} />}
      {attaching && <AttachDialog summaryId={summary.id} meetings={meetings} onClose={() => setAttaching(false)} onDone={setDone} />}
    </>
  );
}

function SendDialog({ summaryId, people, onClose, onDone }: { summaryId: string; people: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('summary.send')}
      description={t('summary.sendHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!chosen.length}
            onClick={() =>
              startTransition(async () => {
                const res = await sendSummary(summaryId, chosen);
                if (!res.ok) return setError(res.error);
                onDone(t('summary.sentTo', { count: chosen.length }));
                onClose();
              })
            }
          >
            {t('summary.send')}
          </Button>
        </>
      }
    >
      {error && <ErrorState message={error} />}
      <div className="flex flex-wrap gap-1.5">
        {people.map((p) => {
          const on = chosen.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}
              className={cn('rounded-full border px-2.5 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg')}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

function AttachDialog({ summaryId, meetings, onClose, onDone }: { summaryId: string; meetings: { id: string; label: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('summary.attach')}
      description={t('summary.attachHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!meetingId}
            onClick={() =>
              startTransition(async () => {
                const res = await attachSummary(summaryId, meetingId);
                if (!res.ok) return setError(res.error === 'not_authorized' ? t('meeting.errNotAuthorized') : res.error);
                onDone(t('summary.attached'));
                onClose();
                router.refresh();
              })
            }
          >
            {t('summary.attach')}
          </Button>
        </>
      }
    >
      {error && <ErrorState message={error} />}
      {meetings.length === 0 ? (
        <p className="text-[13px] text-muted">{t('summary.noMeetings')}</p>
      ) : (
        <Field label={t('meeting.one')} htmlFor="summary-meeting">
          <Select id="summary-meeting" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
            {meetings.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}
