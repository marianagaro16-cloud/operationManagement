import { describe, it, expect } from 'vitest';
import { continueList, hasNote, noteToPlainLine, parseNote } from './notes';

describe('reading a note', () => {
  it('keeps plain text as a paragraph, line breaks and all', () => {
    expect(parseNote('Entregar antes de las 10\nPreguntar por Ana')).toEqual([
      { kind: 'paragraph', lines: ['Entregar antes de las 10', 'Preguntar por Ana'] },
    ]);
  });

  it('reads a dash list', () => {
    expect(parseNote('- Contar cajas\n- Sacar fotos')).toEqual([
      { kind: 'bullets', items: ['Contar cajas', 'Sacar fotos'], start: 1 },
    ]);
  });

  it('reads an asterisk or a bullet character as the same list', () => {
    expect(parseNote('* Uno\n• Dos')[0]).toEqual({ kind: 'bullets', items: ['Uno', 'Dos'], start: 1 });
  });

  it('reads a numbered list and counts from where the writer started', () => {
    expect(parseNote('3. Cargar\n4) Firmar')).toEqual([
      { kind: 'numbers', items: ['Cargar', 'Firmar'], start: 3 },
    ]);
  });

  it('does not turn a minus sign or a price into a list', () => {
    // "-5" is a quantity and "10.50" is money; neither has a space after the
    // mark, which is the whole difference.
    expect(parseNote('-5 cajas faltan')).toEqual([{ kind: 'paragraph', lines: ['-5 cajas faltan'] }]);
    expect(parseNote('10.50 por caja')).toEqual([{ kind: 'paragraph', lines: ['10.50 por caja'] }]);
  });

  it('separates a heading line from the list under it', () => {
    expect(parseNote('Antes de cargar:\n- Contar\n- Fotografiar')).toEqual([
      { kind: 'paragraph', lines: ['Antes de cargar:'] },
      { kind: 'bullets', items: ['Contar', 'Fotografiar'], start: 1 },
    ]);
  });

  it('separates two lists of different sorts', () => {
    const blocks = parseNote('- Uno\n1. Dos');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'numbers']);
  });

  it('treats a blank line between items as air, not as a new list', () => {
    expect(parseNote('- Uno\n\n- Dos')).toEqual([{ kind: 'bullets', items: ['Uno', 'Dos'], start: 1 }]);
  });

  it('is empty for nothing at all', () => {
    for (const empty of [null, undefined, '', '   ', '\n\n']) expect(parseNote(empty)).toEqual([]);
    expect(hasNote(null)).toBe(false);
    expect(hasNote('- Uno')).toBe(true);
  });

  it('is not a list when somebody only typed the mark', () => {
    expect(parseNote('- ')).toEqual([]);
  });

  it('survives Windows line endings', () => {
    expect(parseNote('- Uno\r\n- Dos')).toEqual([{ kind: 'bullets', items: ['Uno', 'Dos'], start: 1 }]);
  });
});

describe('the one-line form', () => {
  it('keeps a bullet so a list still reads as a list', () => {
    expect(noteToPlainLine('Antes:\n- Contar\n- Fotografiar')).toBe('Antes: • Contar • Fotografiar');
  });

  it('is empty for an empty note', () => {
    expect(noteToPlainLine(null)).toBe('');
  });
});

describe('pressing Enter inside a list', () => {
  const at = (text: string) => continueList(text, text.length);

  it('opens the next bullet', () => {
    expect(at('- Contar cajas')).toEqual({ value: '- Contar cajas\n- ', caret: 17 });
  });

  it('keeps the mark that was used', () => {
    expect(at('* Uno')?.value).toBe('* Uno\n* ');
  });

  it('counts the next number up', () => {
    expect(at('3. Cargar')?.value).toBe('3. Cargar\n4. ');
  });

  it('ends the list on an empty item, taking the mark away', () => {
    expect(at('- Uno\n- ')).toEqual({ value: '- Uno\n', caret: 6 });
  });

  it('leaves plain text alone', () => {
    expect(at('Entregar antes de las 10')).toBeNull();
  });

  it('keeps the indent of the line it continues', () => {
    expect(at('  - Uno')?.value).toBe('  - Uno\n  - ');
  });

  it('splits at the caret rather than at the end', () => {
    // Caret sits after "Uno", with "Dos" still to its right.
    const result = continueList('- UnoDos', 5);
    expect(result?.value).toBe('- Uno\n- Dos');
  });
});
