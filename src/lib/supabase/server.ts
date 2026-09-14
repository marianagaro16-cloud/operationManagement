import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Every database read must be a read of the database.
 *
 * Next.js 14 keeps GET fetches in its Data Cache unless told otherwise, and
 * on Vercel that cache outlives the request, the function and the deployment.
 * supabase-js reads through fetch, so the service-role client — which never
 * touches cookies() and so never opts a route out implicitly — was served
 * cached rows. The delivery notifier worked all of 2026-09-14 from the 11
 * orders that existed at its first run: orders placed later were never
 * alerted on, and alerts already sent were re-claimed every 15 minutes,
 * hitting the unique constraint each time. Its reads never reached Supabase.
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

/**
 * Request-scoped Supabase client bound to the user's session cookies.
 * Every query made through this runs as the signed-in user, so RLS applies.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: noStoreFetch },
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component; the middleware refreshes cookies.
          }
        },
        remove: (name, options) => {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // As above.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely — never import this into
 * anything that renders. Reserved for occurrence generation and the importer,
 * which legitimately act as the system rather than as a user.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    global: { fetch: noStoreFetch },
    cookies: { get: () => undefined, set: () => {}, remove: () => {} },
  });
}
