'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { en, type Messages } from './messages/en';
import { es } from './messages/es';
import { de } from './messages/de';
import { BUSINESS_TZ } from '@/lib/datetime';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './config';

// Values the server must call live in ./config — see the note there.
// Only the type is re-exported here; importing a runtime value through a
// 'use client' module is what breaks Server Components.
export type { Locale };

const DICTIONARIES: Record<Locale, Messages> = { en, es, de };

/** Dot-path into the message tree, e.g. `dashboard.todayTitle`. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & (string | number)]: T[K] extends string
    ? `${P}${K}`
    : Leaves<T[K], `${P}${K}.`>;
}[keyof T & (string | number)];

export type MessageKey = Leaves<Messages>;

function lookup(dict: Messages, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replaces `{name}` placeholders. Deliberately minimal — no eval, no ICU. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m,
  );
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Locale-aware, Zurich-pinned date formatting. */
  formatDate: (isoDate: string, style?: 'short' | 'medium' | 'weekday' | 'monthYear') => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    // Persist so the server render picks the same language next navigation.
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTIONARIES[locale];
    return {
      locale,
      setLocale,
      t: (key, vars) => {
        // Fall back through English so a missing translation degrades to a
        // real sentence rather than a raw key.
        const raw = lookup(dict, key) ?? lookup(en, key) ?? key;
        return interpolate(raw, vars);
      },
      formatDate: (isoDate, style = 'medium') => {
        const dt = DateTime.fromISO(isoDate, { zone: BUSINESS_TZ }).setLocale(locale);
        switch (style) {
          case 'short':
            return dt.toFormat('dd.MM.');
          case 'weekday':
            return dt.toFormat('cccc d LLLL');
          case 'monthYear':
            return dt.toFormat('LLLL yyyy');
          default:
            return dt.toFormat('d LLLL yyyy');
        }
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
