'use client';

import Link from 'next/link';
import { forwardRef, useCallback, useEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

/* What the screens of "Mi espacio" share: the page title, a fold, text written in place. */

/** The page's title — large and plain, with the way back on a phone. */
export function SpaceTitle({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4">
      <SpaceBack />
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 break-words text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {action}
      </div>
      {children}
    </div>
  );
}

/** On a phone the side list is its own screen: this goes back to it. */
export function SpaceBack() {
  const { t } = useI18n();
  return (
    <Link href="/space" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg md:hidden">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {t('space.title')}
    </Link>
  );
}

/** A heading that folds what is under it. */
export function Fold({
  open,
  onToggle,
  label,
  count,
  tone,
  action,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: ReactNode;
  count?: number;
  tone?: 'late';
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="group/fold flex items-center gap-1">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[13px] font-semibold text-muted transition-colors hover:bg-surface-2/60 hover:text-fg"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
          {count !== undefined && (
            <span className={cn('text-[12px] font-medium tabular', tone === 'late' ? 'text-late' : 'text-subtle')}>{count}</span>
          )}
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5">{children}</div>}
    </section>
  );
}

/**
 * Text written in place: no box, as tall as what it holds.
 * `singleLine` keeps Enter from breaking the line — the caller decides what
 * Enter means there.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { singleLine?: boolean }>(
  function AutoTextarea({ singleLine, className, value, onKeyDown, ...rest }, forwarded) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const setRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        inner.current = el;
        if (typeof forwarded === 'function') forwarded(el);
        else if (forwarded) forwarded.current = el;
      },
      [forwarded],
    );
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    return (
      <textarea
        ref={setRef}
        rows={1}
        value={value}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (singleLine && e.key === 'Enter' && !e.defaultPrevented) e.preventDefault();
        }}
        className={cn('block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-subtle focus-visible:ring-0 focus-visible:ring-offset-0', className)}
        {...rest}
      />
    );
  },
);
