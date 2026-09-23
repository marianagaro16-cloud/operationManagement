/**
 * Notes that can hold a list.
 *
 * Somebody writing "what to do before loading" writes steps, and steps are a
 * list. Until now a note was one unbroken run of text on screen, so a list
 * written as three lines arrived as one sentence three instructions long.
 *
 * The note is still PLAIN TEXT in the database — "- Contar cajas", exactly as
 * it was typed. Nothing is stored that a person could not read in a CSV
 * export or a database row, and no note written before today changes meaning.
 * This file only decides how that text READS on screen.
 *
 * Deliberately just lists and line breaks. No bold, no links, no headings:
 * every mark a note can carry is a mark somebody has to learn, and the ones
 * here are the ones people already type out of habit.
 */

/** A run of lines that are not a list. Line breaks inside it are kept. */
export interface NoteParagraph {
  kind: 'paragraph';
  lines: string[];
}

/** Bullets, or numbers that count from wherever the writer started. */
export interface NoteList {
  kind: 'bullets' | 'numbers';
  items: string[];
  /** The first number written, so "3." then "4." does not restart at one. */
  start: number;
}

export type NoteBlock = NoteParagraph | NoteList;

/*
 * A dash, an asterisk or a bullet character followed by a space. The space
 * matters: "-5 cajas" is a quantity, not a list item, and a note that turns
 * a minus sign into a bullet would be worse than one with no lists at all.
 */
const BULLET = /^[ \t]*[-*•][ \t]+(.*)$/;
const NUMBER = /^[ \t]*(\d{1,3})[.)][ \t]+(.*)$/;

/** What a line is, before its neighbours are considered. */
function classify(line: string):
  | { kind: 'bullets'; text: string }
  | { kind: 'numbers'; text: string; number: number }
  | { kind: 'text' } {
  const bullet = BULLET.exec(line);
  if (bullet) return { kind: 'bullets', text: bullet[1].trim() };
  const numbered = NUMBER.exec(line);
  if (numbered) return { kind: 'numbers', text: numbered[2].trim(), number: Number(numbered[1]) };
  return { kind: 'text' };
}

/**
 * Read a note as blocks.
 *
 * Consecutive list lines of the same sort become one list; anything else
 * accumulates into a paragraph. A blank line ends whatever was open, which is
 * how somebody writes two lists in one note.
 */
export function parseNote(text: string | null | undefined): NoteBlock[] {
  if (!text) return [];
  const blocks: NoteBlock[] = [];
  let open: NoteBlock | null = null;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      // A blank line between list items is still the same list — people leave
      // them for air. Between paragraphs it is a real break.
      if (open?.kind === 'paragraph') { blocks.push(open); open = null; }
      else if (open === null) continue;
      continue;
    }

    const parsed = classify(line);
    if (parsed.kind === 'text') {
      if (open && open.kind !== 'paragraph') { blocks.push(open); open = null; }
      if (open === null) open = { kind: 'paragraph', lines: [] };
      (open as NoteParagraph).lines.push(line.trim());
      continue;
    }

    if (open && open.kind !== parsed.kind) { blocks.push(open); open = null; }
    if (open === null) {
      open = { kind: parsed.kind, items: [], start: parsed.kind === 'numbers' ? parsed.number : 1 };
    }
    (open as NoteList).items.push(parsed.text);
  }

  if (open) blocks.push(open);
  // A list whose every item is empty ("- " on its own) is somebody's abandoned
  // start, not a list.
  return blocks.filter((b) => (b.kind === 'paragraph' ? b.lines.length > 0 : b.items.some((i) => i !== '')));
}

/** Whether a note holds anything worth showing at all. */
export function hasNote(text: string | null | undefined): boolean {
  return parseNote(text).length > 0;
}

/**
 * The note as one line, for a chip, a tooltip or a column in an export.
 *
 * List items keep a bullet so the reader can still see it was a list, because
 * "Contar cajas Sacar fotos" reads as one instruction and is not one.
 */
export function noteToPlainLine(text: string | null | undefined): string {
  return parseNote(text)
    .flatMap((b) => (b.kind === 'paragraph' ? b.lines : b.items.filter(Boolean).map((i) => `• ${i}`)))
    .join(' ')
    .trim();
}

/**
 * What pressing Enter should do inside a note.
 *
 * Writing a list means writing the mark once: the next line starts with its
 * own bullet, and an empty bullet ends the list rather than making another
 * one — the same bargain every notes app makes, and the reason nobody has to
 * be told how to stop.
 *
 * Returns the whole new value and where the caret lands, or null when Enter
 * should just be Enter.
 */
export function continueList(value: string, caret: number): { value: string; caret: number } | null {
  const before = value.slice(0, caret);
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const parsed = classify(line);
  if (parsed.kind === 'text') return null;

  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  if (parsed.text === '') {
    // An empty item: take the mark away and leave the list, rather than
    // opening an item nobody asked for.
    const start = before.length - line.length;
    return { value: value.slice(0, start) + value.slice(caret), caret: start };
  }

  const mark = parsed.kind === 'bullets'
    ? (/^[ \t]*([-*•])/.exec(line)?.[1] ?? '-')
    : `${parsed.number + 1}.`;
  const insert = `\n${indent}${mark} `;
  return { value: before + insert + value.slice(caret), caret: caret + insert.length };
}
