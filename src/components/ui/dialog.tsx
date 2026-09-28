'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { isSaveKey, mainAction } from './enter-to-save';

/**
 * Modal built on <dialog> so focus trapping, Esc handling and inertness of the
 * background come from the platform rather than a hand-rolled implementation.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) dismisses.
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        // Enter saves: it presses the dialog's main button. A <form> inside
        // submits itself, so it is left to do that.
        if (!isSaveKey(e.nativeEvent) || (e.target as HTMLElement).closest('form')) return;
        const button = mainAction(footerRef.current ?? e.currentTarget);
        if (!button) return;
        e.preventDefault();
        button.click();
      }}
      className={cn(
        'w-[calc(100vw-2rem)] max-w-md rounded-xl border border-border bg-surface p-0 text-fg shadow-pop',
        'backdrop:bg-black/40 open:animate-slide-up',
        className,
      )}
      aria-labelledby="dialog-title"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 id="dialog-title" className="text-[15px] font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {children && <div className="px-5 py-4">{children}</div>}
      {footer && (
        <div ref={footerRef} className="flex justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive or irreversible admin actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
