import { StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Something a person wrote, made findable at a glance.
 *
 * Notes used to render as grey text on a grey block — the same treatment as
 * every other secondary line — so "deliver before 10" sat invisible next to
 * the delivery method.
 *
 * DELIBERATELY NOT AMBER. On the screens these appear on, amber already means
 * short, late or needs attention. Dressing an instruction somebody left as a
 * problem with the order is a worse error than leaving it grey, so a
 * different meaning gets its own colour: violet, which nothing else in the
 * palette uses and which therefore cannot be read as a status.
 *
 * Lives in ui/ rather than beside the orders module because incidents show
 * notes too, and a shared widget owned by one feature is how a component ends
 * up imported across a boundary it was never meant to cross.
 */

/** A note with room to breathe: its own block, marked down the left edge. */
export function NoteBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 border-l-2 border-note bg-note/[0.07] text-[12.5px] text-note',
        className,
      )}
    >
      <StickyNote className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/**
 * The same meaning where there is no room for a block.
 *
 * A lot line and a replacement row are already dense; a full callout inside
 * one would be noise. The colour is what carries the meaning, so the chip
 * keeps it and drops everything else.
 */
export function NoteChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('rounded bg-note/[0.08] px-1.5 py-0.5 text-note', className)}>
      {children}
    </span>
  );
}
