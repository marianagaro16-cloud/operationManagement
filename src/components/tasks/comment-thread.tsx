'use client';

import { useEffect, useState, useTransition } from 'react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Spinner, Textarea } from '@/components/ui/primitives';
import { addComment } from '@/server/actions';
import { BUSINESS_TZ } from '@/lib/datetime';

interface Comment {
  id: string;
  body: string;
  created_at: string;
  profiles: { name: string | null; email: string } | null;
}

/**
 * Comments load lazily when the thread is opened — a dashboard with 50 task
 * cards must not fetch 50 comment lists up front.
 */
export function CommentThread({ occurrenceId, taskId }: { occurrenceId: string; taskId: string }) {
  const { t, locale } = useI18n();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  async function load() {
    const { data } = await createClient()
      .from('task_comments')
      .select('id, body, created_at, profiles:user_id ( name, email )')
      .eq('occurrence_id', occurrenceId)
      .order('created_at', { ascending: true });
    setComments((data ?? []) as unknown as Comment[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceId]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await addComment(occurrenceId, taskId, text);
      if (res.ok) {
        setBody('');
        await load();
      }
    });
  }

  return (
    <div className="mt-2.5 space-y-2.5 border-t border-border pt-2.5">
      {comments === null ? (
        <Spinner />
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-subtle">{t('task.noComments')}</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="text-[12.5px]">
              <div className="flex items-baseline gap-1.5">
                <span className="font-medium">{c.profiles?.name ?? c.profiles?.email ?? '—'}</span>
                <span className="text-[11px] text-subtle">
                  {DateTime.fromISO(c.created_at)
                    .setZone(BUSINESS_TZ)
                    .setLocale(locale)
                    .toFormat('d LLL, HH:mm')}
                </span>
              </div>
              <p className="text-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('task.commentPlaceholder')}
          className="min-h-[38px] text-[13px]"
          rows={1}
          aria-label={t('task.addComment')}
        />
        <Button size="sm" variant="secondary" onClick={submit} loading={pending} disabled={!body.trim()}>
          {t('task.postComment')}
        </Button>
      </div>
    </div>
  );
}
