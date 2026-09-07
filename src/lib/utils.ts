import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes so later props win over base styles. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null, email: string): string {
  const source = displayName({ name, email });
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}

/**
 * How a person is named on screen.
 *
 * A profile's `name` is optional — an account that has never been given one
 * falls back to its email, which is at least identifying. That fallback was
 * written out by hand at five call sites (the statistics page, the history
 * page, the comment thread, the app shell's initials, and the audit log), and
 * three of them wrote it slightly differently: two used `?? email`, which
 * keeps an empty-string name, and one used `|| email`, which does not.
 *
 * Trimming and falling back on blank is the correct behaviour, so it lives
 * here once.
 */
export function displayName(person: { name: string | null; email: string }): string {
  return person.name?.trim() || person.email;
}

/**
 * Sanitise a post-login redirect target.
 *
 * The middleware records where an unauthenticated user was heading so the
 * sign-in form can send them back there. That value arrives from the query
 * string, so it is attacker-controlled and has to be treated as such:
 *
 *   - only a same-origin absolute path is accepted, never an absolute URL;
 *   - `//evil.com` and `/\evil.com` are protocol-relative and resolve to
 *     another origin, so they are rejected even though they start with `/`;
 *   - `/login` and `/register` are rejected because redirecting back to the
 *     form the user just submitted is a loop, not a destination.
 *
 * Anything else returns null and the caller falls back to the dashboard.
 */
export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw === '/login' || raw === '/register') return null;
  if (raw.startsWith('/login/') || raw.startsWith('/register/')) return null;
  return raw;
}
