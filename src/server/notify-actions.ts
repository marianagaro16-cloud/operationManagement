'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { displayName } from '@/lib/utils';
import { getViewer } from './data';
import { reachableUserIds } from './notifications';
import { planDirectSend } from '@/domain/direct-messages';
import { teamScope, type Team } from '@/lib/authz';
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
 * that could be bypassed without consequence. The only row written is the
 * recipients' inbox entry, filed by the service role, and delivery has to run
 * as the service role too, because RLS hides push endpoints from everyone but
 * the person who owns the device.
 * So the two rules the feature has are enforced HERE, before the service-role
 * client is touched at all, and nowhere else:
 *
 *   1. the sender holds `notifications.send`, read from their own session
 *      rather than from anything the client sent;
 *   2. every recipient is an approved account other than the sender — any
 *      role: down to the floor, and sideways or up (see direct-messages.ts);
 *   3. a sender confined to a team (the production manager) writes to that
 *      team only.
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

  // Re-read the recipients rather than trusting the ids that arrived: a
  // forged request naming a pending, deactivated or deleted account finds no
  // matching row and is refused below.
  const { data: rows, error } = await admin
    .from('profiles')
    .select('id, name, email, role, team')
    .in('id', requested)
    .eq('status', 'approved')
    .is('deleted_at', null);

  if (error) return { ok: false, error: error.message };

  const recipients = (rows ?? []) as { id: string; name: string | null; email: string; role: string; team: Team }[];

  const scope = teamScope(viewer.role, viewer.profile.team);
  if (scope && recipients.some((r) => r.team !== scope)) return { ok: false, error: 'not_your_team' };

  // All or nothing, and never to yourself — see planDirectSend.
  const plan = planDirectSend(requested, recipients, viewer.profile.id);
  if (!plan.ok) return { ok: false, error: plan.error };

  const reachable = await reachableUserIds(requested);

  const payload = {
    // The sender's name IS the title. A message with no attributable author
    // is one nobody acts on, and the alternative — a separate subject field —
    // is one more thing to fill in for a two-line instruction.
    title: displayName(viewer.profile),
    body: parsed.data.message,
    // Unique per send, so two messages from the same person stack instead of
    // the second silently replacing the first — which is what a shared tag
    // does, and is right for an escalating order but wrong for a message.
    tag: `direct-${crypto.randomUUID()}`,
    // The message itself is the content, and the inbox is where it lives.
    url: '/inbox',
  };

  // Users wait for OK; colleagues get an ordinary notification.
  const [toFloor, toOffice] = await Promise.all([
    plan.floor.length ? sendToUsers(plan.floor, { ...payload, requireOk: true }) : 0,
    plan.office.length ? sendToUsers(plan.office, payload) : 0,
  ]);
  const delivered = toFloor + toOffice;

  return {
    ok: true,
    data: {
      addressed: recipients.length,
      delivered,
      unreachable: recipients.filter((r) => !reachable.has(r.id)).map(displayName),
    },
  };
}
