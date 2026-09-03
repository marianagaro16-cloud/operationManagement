import 'server-only';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Web Push delivery.
 *
 * Runs with the service role because sending is a system action: the
 * scheduler must reach every approved user's devices, and RLS deliberately
 * hides push endpoints from everyone but their owner.
 *
 * Node runtime only — the encryption `web-push` performs is unavailable on
 * the Edge runtime.
 */

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  level?: 'warning' | 'critical' | 'overdue';
}

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:operations@example.com';
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

/**
 * Deliver to a set of subscriptions.
 *
 * A 404 or 410 means the browser revoked the subscription — that endpoint is
 * dead forever, so it is deleted immediately rather than retried. Other
 * failures increment a counter and are pruned after repeated failures, so a
 * transient push-service outage does not wipe everyone's subscriptions.
 */
async function deliver(subs: SubscriptionRow[], payload: PushPayload): Promise<number> {
  if (!configure() || subs.length === 0) return 0;

  const admin = createAdminClient();
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  const failed: SubscriptionRow[] = [];
  const delivered: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        delivered.push(sub.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(sub.id);
        else failed.push(sub);
      }
    }),
  );

  if (gone.length) {
    await admin.from('push_subscriptions').delete().in('id', gone);
  }
  if (delivered.length) {
    await admin
      .from('push_subscriptions')
      .update({ last_used_at: new Date().toISOString(), failure_count: 0 })
      .in('id', delivered);
  }
  for (const sub of failed) {
    const next = sub.failure_count + 1;
    if (next >= 5) await admin.from('push_subscriptions').delete().eq('id', sub.id);
    else await admin.from('push_subscriptions').update({ failure_count: next }).eq('id', sub.id);
  }

  return delivered.length;
}

/** Send to one user's devices. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId);
  return deliver((data ?? []) as SubscriptionRow[], payload);
}

/**
 * Send to every approved user's devices.
 *
 * Order preparation is shared team work — there is no per-order assignee — so
 * an approaching deadline goes to everyone who can act on it.
 */
export async function sendToApprovedUsers(payload: PushPayload): Promise<number> {
  const admin = createAdminClient();

  const { data: approved } = await admin
    .from('profiles')
    .select('id')
    .eq('status', 'approved');

  const ids = (approved ?? []).map((p) => p.id);
  if (ids.length === 0) return 0;

  const { data } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .in('user_id', ids);

  return deliver((data ?? []) as SubscriptionRow[], payload);
}
