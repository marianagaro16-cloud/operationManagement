import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Refreshes the auth session on every request and performs the coarse
 * redirect. This is a convenience gate, NOT the security boundary — RLS and
 * the SECURITY DEFINER RPCs are what actually enforce access.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => request.cookies.get(name)?.value,
        set: (name, value, options) => {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove: (name, options) => {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    // Path AND query: a filtered deep link like /inventory?week=37 is worth
    // as little as the bare page if the filters are dropped on the way back.
    const target = path + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // The clone still carries the original query; clear it so /login gets
    // the next param and nothing else.
    url.search = '';
    url.searchParams.set('next', target);
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // `api` is excluded deliberately: route handlers authenticate themselves
  // (the cron endpoints check CRON_SECRET), and redirecting a machine caller
  // to /login would silently break every scheduled job.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
