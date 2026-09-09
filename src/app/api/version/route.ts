import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * What is actually deployed.
 *
 * "Did the deploy pick up my changes?" was asked repeatedly and could not be
 * answered: the URL lived in a Vault secret, the repository host was not
 * authenticated from here, and every screen worth inspecting sits behind a
 * login. Guessing from the shape of a JavaScript bundle is not an answer.
 *
 * So the running build says which commit it is. Vercel injects these at build
 * time; locally they are absent and the route says so rather than inventing a
 * value.
 *
 * PUBLIC on purpose. A commit sha is not a secret — it is meaningless without
 * the repository — and a check that needs a token is a check nobody runs. The
 * response carries the sha, the branch and when the build happened, and
 * deliberately nothing else: no environment dump, no configuration, no
 * versions of anything installed.
 */
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  return NextResponse.json(
    {
      commit: sha,
      short: sha ? sha.slice(0, 7) : null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      environment: process.env.VERCEL_ENV ?? 'local',
      // When this instance answered, not when it was built. Enough to tell a
      // live response from a cached one, and deliberately not dressed up as a
      // build timestamp, which is not available here.
      startedAt: new Date().toISOString(),
    },
    // Never cached. A cached answer to "what is deployed" is the one kind of
    // answer this route must not give.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
