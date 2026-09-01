/**
 * Locale configuration shared by BOTH server and client.
 *
 * Deliberately NOT marked 'use client'. A Server Component that imports a
 * plain value from a 'use client' module receives a client-reference proxy
 * rather than the real binding, which builds cleanly and then throws
 * "x is not a function" at runtime. Anything the server needs to *call* has
 * to live in a module like this one.
 */
export const LOCALES = ['es', 'de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Spanish is the operation's working language, so it is the default. */
export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_COOKIE = 'om_locale';

/** Narrow an untrusted string (cookie/header) to a supported locale. */
export function resolveLocale(value: string | undefined | null): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}
