'use client';

import { useState, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Navigation that shows it has started.
 *
 * A link that only changes the query string (Day → Range, the period arrows)
 * stays on the same page, so Next 14 does not show loading.tsx: the screen
 * sat unchanged until the server had read the whole new period, and the tap
 * looked ignored. Going through a transition gives `pending` to dim the
 * content with, and `target` to mark the pressed button straight away.
 */
export function usePendingNav() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const go = (href: string, tag?: string) => {
    setTarget(tag ?? null);
    startTransition(() => router.push(href));
  };

  /** href + onClick for a <Link>; a new-tab click still opens normally. */
  const linkProps = (href: string, tag?: string) => ({
    href,
    onClick: (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(href, tag);
    },
  });

  return { pending, target: pending ? target : null, go, linkProps };
}
