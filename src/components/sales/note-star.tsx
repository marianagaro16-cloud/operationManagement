'use client';

import { useState, useTransition } from 'react';
import { Star } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { setNoteStar } from '@/server/summary-actions';

/** A note as a highlight for the weekly summary: one tap, on or off. */
export function NoteStar({ target, noteId, starred }: { target: 'customer' | 'prospect'; noteId: string; starred: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useState(starred);
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('summary.unstar') : t('summary.star')}
      title={on ? t('summary.unstar') : t('summary.star')}
      disabled={pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(async () => {
          const res = await setNoteStar(target, noteId, next);
          if (!res.ok) setOn(!next);
        });
      }}
      className="ml-auto rounded p-0.5 hover:bg-surface-2"
    >
      <Star className={cn('h-4 w-4', on ? 'fill-warn text-warn' : 'text-subtle')} aria-hidden />
    </button>
  );
}
