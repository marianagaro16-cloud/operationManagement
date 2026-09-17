/**
 * "3 minutes ago", "yesterday", "5 days ago" — in the viewer's language.
 *
 * Minutes under an hour, hours under a day, days after that. Anything in the
 * last minute reads as one minute ago rather than "now", because the instant
 * shown is always one that already happened.
 */
export function formatAgo(iso: string, now: number, locale: string): string {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes > -60) return relative.format(Math.min(minutes, -1), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}
