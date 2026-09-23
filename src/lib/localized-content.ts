import type { Locale } from '@/i18n/config';

/**
 * Reading admin-entered content in the reader's language.
 *
 * Task titles are data, so they cannot come from the i18n message files.
 * Spanish is the source language and lives in the base fields; other
 * locales are overrides in a `translations` object.
 *
 * A missing translation falls back to the Spanish original. Showing the
 * source text is always better than showing nothing, and it makes an
 * untranslated activity obvious to whoever is maintaining them.
 */

export interface TranslatableContent {
  title: string;
  description?: string | null;
  translations?: Record<string, { title?: string | null; description?: string | null }> | null;
}

/** Spanish is the source language, not an override. */
export const SOURCE_LOCALE: Locale = 'es';

export function localizedTitle(content: TranslatableContent, locale: Locale): string {
  if (locale === SOURCE_LOCALE) return content.title;
  const t = content.translations?.[locale]?.title;
  return t && t.trim() ? t : content.title;
}

export function localizedDescription(
  content: TranslatableContent,
  locale: Locale,
): string | null {
  if (locale === SOURCE_LOCALE) return content.description ?? null;
  const t = content.translations?.[locale]?.description;
  if (t && t.trim()) return t;
  return content.description ?? null;
}

/**
 * Anything whose name is Spanish in the base field and overridden per locale
 * under `name`: inventory templates, their items, their locations.
 *
 * The same rule as localizedTitle, for the shape the inventory module uses.
 * A brand's inventory (Masamor, Del Barrio…) is a proper noun with no
 * translation to give, and falls back to the Spanish field, which is the name
 * itself.
 */
export function localizedName(
  content: { name: string; translations?: unknown },
  locale: Locale,
): string {
  if (locale === SOURCE_LOCALE) return content.name;
  const translations = content.translations as Record<string, { name?: string | null }> | null | undefined;
  const name = translations?.[locale]?.name;
  return name && name.trim() ? name : content.name;
}

/**
 * An inventory item's name in the reader's language. Reads the sheet's OWN
 * copy, frozen when the row was counted.
 */
export function localizedItemName(
  item: { item_name: string; item_translations?: unknown },
  locale: Locale,
): string {
  return localizedName({ name: item.item_name, translations: item.item_translations }, locale);
}

/** Every language an item reads in, for searching without switching language. */
export function itemNameSearchText(item: { item_name: string; item_translations?: unknown }): string {
  const translations = (item.item_translations ?? {}) as Record<string, { name?: string | null }>;
  return [item.item_name, ...Object.values(translations).map((t) => t?.name ?? '')].join(' ');
}

/** True when this locale has no translation and is falling back. */
export function isUntranslated(content: TranslatableContent, locale: Locale): boolean {
  if (locale === SOURCE_LOCALE) return false;
  const t = content.translations?.[locale]?.title;
  return !(t && t.trim());
}

/** How many of the given items still lack a translation, per locale. */
export function countUntranslated(
  items: TranslatableContent[],
  locales: readonly Locale[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const locale of locales) {
    if (locale === SOURCE_LOCALE) continue;
    out[locale] = items.filter((i) => isUntranslated(i, locale)).length;
  }
  return out;
}
