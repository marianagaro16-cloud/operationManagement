import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes so later props win over base styles. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
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
