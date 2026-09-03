import { NextResponse } from 'next/server';
import { createECDH } from 'node:crypto';

// createECDH needs Node crypto; it is unavailable on the Edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The VAPID public key a browser must subscribe with.
 *
 * Served at runtime instead of read from `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the
 * client bundle, because that value is inlined at BUILD time: setting it in
 * the host without redeploying leaves the browser with no key at all, which
 * looks exactly like the feature being switched off. Reading it here means the
 * key the browser uses is whatever the running server actually holds.
 *
 * It is derived from the private key whenever that is possible, so the browser
 * can never subscribe with a public key that does not match the one the server
 * signs with — a mismatch that is invisible until pushes are accepted by the
 * push service and then never arrive.
 *
 * No auth: this key ships to every browser by design. The private key is never
 * returned, and nothing here reveals whether a given person is subscribed.
 */
export async function GET() {
  const configured = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  // An uncompressed P-256 point is 65 bytes starting with 0x04, which is 87
  // base64url characters. Anything else was mis-pasted or truncated.
  let derived: string | null = null;
  try {
    if (privateKey) {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
      derived = ecdh.getPublicKey().toString('base64url');
    }
  } catch {
    derived = null; // unusable private key; fall back to the configured one
  }

  const key = derived ?? configured;

  if (!key) {
    return NextResponse.json({ error: 'push_not_configured' }, { status: 503 });
  }

  return NextResponse.json(
    {
      key,
      // Lets `npm run verify:push` and a plain curl tell a mis-pasted public
      // key from a missing one without exposing anything secret.
      source: derived ? 'derived' : 'configured',
      matches: Boolean(configured && derived && configured === derived),
    },
    // The key only changes when the pair is rotated, so a short cache keeps
    // this off the critical path of enabling notifications.
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
