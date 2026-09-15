'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { StickyNote } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorState, Textarea } from '@/components/ui/primitives';
import { addComment } from '@/server/actions';
import { BUSINESS_TZ } from '@/lib/datetime';
import type { TaskComment } from '@/types/database';

/**
 * The comments on a task, always on the card.
 *
 * They used to load only when somebody opened the thread, in grey, so a
 * comment like "the scale is broken, use the other one" sat hidden behind a
 * button on exactly the card that needed it. They now arrive with the task
 * and are shown in the note colour — violet, the colour kept for things people
 * wrote, never read as late or blocked.
 */
export function TaskComments({ comments }: { comments: TaskComment[] }) {
  const { locale } = useI18n();
  if (comments.length === 0) return null;

  const sorted = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return (
    <ul className="mt-2 space-y-1.5 border-l-4 border-note bg-note/[0.15] px-2.5 py-2">
      {sorted.map((c) => (
        <li key={c.id} className="flex items-start gap-1.5 text-[13px] text-note">
          <StickyNote className="mt-[2px] h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="whitespace-pre-wrap font-medium">{c.body}</span>
            <span className="ml-1.5 text-[11.5px] text-note/80">
              {c.author ? displayName(c.author) : '—'} ·{' '}
              {DateTime.fromISO(c.created_at).setZone(BUSINESS_TZ).setLocale(locale).toFormat('d LLL, HH:mm')}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Writing a new comment. The list itself is TaskComments, always visible. */
export function CommentComposer({
  occurrenceId,
  taskId,
  onPosted,
}: {
  occurrenceId: string;
  taskId: string;
  onPosted: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const res = await addComment(occurrenceId, taskId, text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody('');
      onPosted();
      // The card's comments come from the server; refresh to show the new one.
      router.refresh();
    });
  }

  return (
    <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
      {error && <ErrorState message={error} />}
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('task.commentPlaceholder')}
          className="min-h-[38px] text-[13px]"
          rows={1}
          autoFocus
          aria-label={t('task.addComment')}
        />
        <Button size="sm" variant="secondary" onClick={submit} loading={pending} disabled={!body.trim()}>
          {t('task.postComment')}
        </Button>
      </div>
    </div>
  );
}
