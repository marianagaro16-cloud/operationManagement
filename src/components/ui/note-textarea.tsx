'use client';

import { forwardRef, useRef, type TextareaHTMLAttributes } from 'react';
import { continueList } from '@/domain/notes';
import { Textarea } from './primitives';

/**
 * A note field that keeps a list going.
 *
 * Type "- " and press Enter: the next line opens with its own bullet. Press
 * Enter on an empty bullet and the list ends. Numbers count themselves up.
 * Nothing to tap and nothing to learn — it is what every notes app does, and
 * it is why nobody has to be told how to stop a list.
 *
 * A drop-in for Textarea: same props, same value, still plain text. It only
 * edits what Enter inserts, so a field that was working before goes on
 * working.
 */
export const NoteTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function NoteTextarea({ onKeyDown, onChange, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);

    return (
      <Textarea
        {...props}
        onChange={onChange}
        ref={(node) => {
          inner.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          // Enter alone. Shift+Enter stays a plain line break, and the
          // modifiers belong to whatever dialog wraps this field.
          if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;

          const field = e.currentTarget;
          // A selection is a replacement, not a continuation.
          if (field.selectionStart !== field.selectionEnd) return;

          const next = continueList(field.value, field.selectionStart);
          if (!next) return;
          e.preventDefault();

          /*
           * Written through the native setter so React sees a real change:
           * assigning to .value directly leaves a controlled field showing
           * text its owner never heard about, which is how a typed note
           * silently fails to save.
           */
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          setter?.call(field, next.value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.setSelectionRange(next.caret, next.caret);
        }}
      />
    );
  },
);
