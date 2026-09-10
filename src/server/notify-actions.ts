'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { displayName } from '@/lib/utils';
import { getViewer } from './data';
import { reachableUserIds } from './notifications';
import { isPushConfigured, sendToUsers } from './push';
import type { ActionResult } from './actions';

/**
 * Sending a direct notification.
 *
 * THIS ACTION IS THE SECURITY BOUNDARY, which is a deviation from the rest of
 * the app and worth stating plainly rather than leaving to be discovered.
 *
 * Everywhere else the database decides: a mutation routes through RLS or a
 * SECURITY DEFINER function, and the server action is a validated transport
 * that could be bypassed without consequence. There is no row here to protect
 * — nothing is written — and delivery has to run as the service role, because
 * RLS hides push endpoints from everyone but the person who owns the device.
 * So the two rules the feature has are enforced HERE, before the service-role
 * client is touched at all, and nowhere else:
 *
 *   1. the sender holds `notifications.send`, read from their own session
 *      rather than from anything the client sent;
 *   2. every recipient is an approved account whose role is 'user'.
 *
 * Neither is re-checked downstream. Do not move either one into the caller.
 */

/**
 * Long enough for an instruction, short enough to survive the transport.
 *
 * Web Push encrypts the payload into a ~4KB envelope, and a message that
 * overruns it fails at the push service rather than at the keyboard.
 */
const MAX_MESSAGE = 400;

const sendSchema = z.object({
  recipient_ids: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
});

export interface SendOutcome {
  /** Recipients the message was addressed to. */
  addressed: number;
  /** Devices the push actually reached. Zero means nobody was told. */
  delivered: number;
  /** Addressed recipients with no registered device, by name. */
  unreachable: string[];
}

export async function sendDirectNotification(
  input: z.infer<typeof sendSchema>,
): Promise<ActionResult<SendOutcome>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_message' };

  const viewer = await getViewer();
  if (
    !viewer ||
    viewer.profile.status !== 'approved' ||
    !viewer.can('notifications.send')
  ) {
    return { ok: false, error: 'not_authorized' };
  }

  if (!isPushConfigured()) return { ok: false, error: 'push_not_configured' };

  const requested = [...new Set(parsed.data.recipient_ids)];
  const admin = createAdminClient();

  // Re-read the recipients rather than trusting the ids that arrived. The
  // role filter is the rule "downward only" — a forged request naming a
  // manager finds no matching row and is refused below.
  const { data: rows, error } = await admin
    .from('profiles')
    .select('id, name, email')
    .in('id', requested)
    .eq('role', 'user')
    .eq('status', 'approved');

  if (error) return { ok: false, error: error.message };

  const recipients = (rows ?? []) as { id: string; name: string | null; email: string }[];

  // All or nothing. A partial send would leave the sender believing everyone
  // named was told, which for a fire-and-forget message is worse than an
  // error they can act on.
  if (recipients.length !== requested.length) {
    return { ok: false, error: 'invalid_recipient' };
  }

  const reachable = await reachableUserIds(requested);

  const delivered = await sendToUsers(requested, {
    // The sender's name IS the title. A message with no attributable author
    // is one nobody acts on, and the alternative — a separate subject field —
    // is one more thing to fill in for a two-line instruction.
    title: displayName(viewer.profile),
    body: parsed.data.message,
    requireOk: true,
    // Unique per send, so two messages from the same person stack instead of
    // the second silently replacing the first — which is what a shared tag
    // does, and is right for an escalating order but wrong for a message.
    tag: `direct-${crypto.randomUUID()}`,
    url: '/dashboard',
  });

  return {
    ok: true,
    data: {
      addressed: recipients.length,
      delivered,
      unreachable: recipients.filter((r) => !reachable.has(r.id)).map(displayName),
    },
  };
}
