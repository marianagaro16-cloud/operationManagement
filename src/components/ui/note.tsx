import { StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseNote } from '@/domain/notes';

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

/**
 * What somebody wrote, laid out as they wrote it.
 *
 * Line breaks are kept, and lines starting with "- " or "1. " become a real
 * list. Steps written as a list used to arrive as one run-on sentence, which
 * is how an instruction gets half-followed.
 *
 * Plain text in, plain text in the database: see domain/notes.
 */
export function NoteText({ text, className }: { text: string | null | undefined; className?: string }) {
  const blocks = parseNote(text);
  if (blocks.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      {blocks.map((block, i) =>
        block.kind === 'paragraph' ? (
          <span key={i} className="block whitespace-pre-wrap break-words">
            {block.lines.join('\n')}
          </span>
        ) : block.kind === 'bullets' ? (
          <ul key={i} className="list-disc space-y-0.5 pl-4 marker:text-current">
            {block.items.filter(Boolean).map((item, j) => (
              <li key={j} className="break-words">{item}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={block.start} className="list-decimal space-y-0.5 pl-5 marker:text-current">
            {block.items.filter(Boolean).map((item, j) => (
              <li key={j} className="break-words">{item}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/**
 * A note with room to breathe: its own block, marked down the left edge.
 *
 * A div rather than a paragraph, because a note may now hold a list and a
 * list inside a <p> is markup the browser silently rearranges.
 */
export function NoteBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Strong enough to be seen on a busy card from arm's length: a note is
        // an instruction somebody expects to be followed.
        'flex items-start gap-1.5 border-l-4 border-note bg-note/[0.15] text-[13px] font-medium text-note',
        className,
      )}
    >
      <StickyNote className="mt-[2px] h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
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
    <span className={cn('rounded bg-note/[0.15] px-1.5 py-0.5 font-medium text-note', className)}>
      {children}
    </span>
  );
}
