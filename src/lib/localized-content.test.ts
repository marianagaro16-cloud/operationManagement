import { describe, it, expect } from 'vitest';
import {
  localizedTitle,
  localizedDescription,
  isUntranslated,
  countUntranslated,
  type TranslatableContent,
} from './localized-content';

const task: TranslatableContent = {
  title: 'Aplastar cartón',
  description: 'Antes de tirarlo',
  translations: {
    de: { title: 'Karton zusammendrücken', description: 'Vor dem Entsorgen' },
    en: { title: 'Flatten cardboard', description: null },
  },
};

describe('localizedTitle', () => {
  it('returns the Spanish source unchanged', () => {
    expect(localizedTitle(task, 'es')).toBe('Aplastar cartón');
  });

  it('returns the translation for other locales', () => {
    expect(localizedTitle(task, 'de')).toBe('Karton zusammendrücken');
    expect(localizedTitle(task, 'en')).toBe('Flatten cardboard');
  });

  it('falls back to Spanish when a locale is missing', () => {
    const partial: TranslatableContent = { title: 'Tirar plástico', translations: { de: { title: 'Plastik entsorgen' } } };
    expect(localizedTitle(partial, 'de')).toBe('Plastik entsorgen');
    expect(localizedTitle(partial, 'en')).toBe('Tirar plástico');
  });

  it('falls back when there are no translations at all', () => {
    const none: TranslatableContent = { title: 'Limpieza Palomo' };
    expect(localizedTitle(none, 'de')).toBe('Limpieza Palomo');
    expect(localizedTitle(none, 'en')).toBe('Limpieza Palomo');
  });

  it('treats an empty or whitespace translation as missing', () => {
    const blank: TranslatableContent = {
      title: 'Aspirar el almacén',
      translations: { de: { title: '' }, en: { title: '   ' } },
    };
    expect(localizedTitle(blank, 'de')).toBe('Aspirar el almacén');
    expect(localizedTitle(blank, 'en')).toBe('Aspirar el almacén');
  });

  it('survives a null translations column', () => {
    expect(localizedTitle({ title: 'X', translations: null }, 'de')).toBe('X');
  });
});

describe('localizedDescription', () => {
  it('returns the translated description', () => {
    expect(localizedDescription(task, 'de')).toBe('Vor dem Entsorgen');
  });

  it('falls back to the Spanish description when the translation is null', () => {
    // The English entry has a title but no description.
    expect(localizedDescription(task, 'en')).toBe('Antes de tirarlo');
  });

  it('returns null when there is no description in any language', () => {
    expect(localizedDescription({ title: 'X' }, 'de')).toBeNull();
    expect(localizedDescription({ title: 'X', description: null }, 'es')).toBeNull();
  });
});

describe('translation coverage', () => {
  it('never reports the source language as untranslated', () => {
    expect(isUntranslated({ title: 'X' }, 'es')).toBe(false);
  });

  it('detects a missing translation', () => {
    expect(isUntranslated({ title: 'X' }, 'de')).toBe(true);
    expect(isUntranslated(task, 'de')).toBe(false);
  });

  it('counts the gaps per locale', () => {
    const items: TranslatableContent[] = [
      task,
      { title: 'Sin traducir' },
      { title: 'Solo alemán', translations: { de: { title: 'Nur Deutsch' } } },
    ];
    expect(countUntranslated(items, ['es', 'de', 'en'])).toEqual({ de: 1, en: 2 });
  });

  it('keeps product names out of the equation — they are just text', () => {
    // "Chile Guajillo" must survive verbatim inside a translated sentence.
    const stock: TranslatableContent = {
      title: 'Mantener un stock de 20 unidades de Chile Guajillo 100g Retail.',
      translations: { en: { title: 'Keep a stock of 20 units of Chile Guajillo 100g Retail.' } },
    };
    expect(localizedTitle(stock, 'en')).toContain('Chile Guajillo');
    expect(localizedTitle(stock, 'de')).toContain('Chile Guajillo');
  });
});
