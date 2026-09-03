'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';

/**
 * Push subscription management.
 *
 * A subscription belongs to the person who created it. RLS restricts every
 * operation to `user_id = auth.uid()`, and even admins cannot read another
 * user's endpoints — a push endpoint is a capability URL for delivering to
 * someone's device, not team data.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().nullable().optional(),
});

export async function savePushSubscription(
  input: z.infer<typeof subscriptionSchema>,
): Promise<ActionResult> {
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_subscription' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  // An endpoint identifies the browser, not the person. On a shared device
  // the second person to enable notifications gets the SAME endpoint, which
  // is UNIQUE — so a plain upsert lands on the first person's row and RLS
  // refuses it ("new row violates row-level security policy"), leaving them
  // with a button that appears to do nothing.
  //
  // claim_push_subscription transfers the endpoint to whoever is signed in
  // now, which is the only correct answer for a device two people share.
  const { error } = await supabase.rpc('claim_push_subscription', {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: parsed.data.user_agent ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function deletePushSubscription(endpoint: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
