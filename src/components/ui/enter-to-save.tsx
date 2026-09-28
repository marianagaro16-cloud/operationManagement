'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * Enter saves.
 *
 * From a one-line field, Enter alone. From a note — which takes several lines
 * and continues lists on Enter — Ctrl+Enter (⌘+Enter on a Mac). A button, a
 * link or an open pick list keeps Enter for itself.
 */

type EnterEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'defaultPrevented' | 'target'
>;

const NOT_TYPED = new Set(['button', 'submit', 'reset', 'file', 'image']);

export function isSaveKey(e: EnterEvent): boolean {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey) return false;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  // A combobox or menu that is open is choosing, not saving.
  if (target.getAttribute('aria-expanded') === 'true') return false;
  if (target instanceof HTMLTextAreaElement) return e.ctrlKey || e.metaKey;
  if (target instanceof HTMLInputElement) return !NOT_TYPED.has(target.type);
  return target instanceof HTMLSelectElement;
}

/** The main action of a dialog: its primary button, else its confirming one. */
export function mainAction(scope: HTMLElement): HTMLButtonElement | null {
  for (const variant of ['primary', 'danger', 'success']) {
    const buttons = scope.querySelectorAll<HTMLButtonElement>(`button[data-variant="${variant}"]`);
    if (buttons.length === 1) return buttons[0].disabled ? null : buttons[0];
    if (buttons.length > 1) return null; // Not clear which one is meant.
  }
  return null;
}

/**
 * A real <form> already submits on Enter from a one-line field; a note in it
 * needs Ctrl+Enter to do the same. Mounted once, for the whole app.
 */
export function FormNoteSubmit() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.form) return;
      if (!isSaveKey(e)) return;
      e.preventDefault();
      target.form.requestSubmit();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return null;
}

/**
 * Enter saves a panel that is not a dialog or a form. `display: contents`, so
 * wrapping a panel leaves its layout exactly as it was.
 */
export function SaveOnEnter({
  onSave,
  disabled,
  children,
}: {
  onSave: () => void;
  /** While saving, or with nothing to save yet. */
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="contents"
      onKeyDown={(e) => {
        if (disabled || !isSaveKey(e.nativeEvent)) return;
        e.preventDefault();
        onSave();
      }}
    >
      {children}
    </div>
  );
}
