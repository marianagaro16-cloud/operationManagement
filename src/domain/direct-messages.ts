/**
 * Direct messages — who may receive one, and how it arrives.
 *
 * Anybody who can send may write to any approved account except themselves:
 * down to the floor, and sideways or up to an admin, a manager or a power
 * user. Nobody in the User role sends — that is the `notifications.send`
 * capability, which the role structurally cannot hold.
 *
 * How it arrives depends on the recipient. For a User it is an instruction,
 * so it stays on screen until they press OK. For everyone else it is a
 * message between colleagues, so it arrives as an ordinary notification —
 * holding an admin's screen hostage until acknowledged would make the channel
 * something people learn to avoid. Both land in the inbox either way.
 */

export interface Recipient {
  id: string;
  role: string;
}

export type DirectSendPlan =
  | {
      ok: true;
      /** Users: the message stays on screen until OK. */
      floor: string[];
      /** Admins, managers, power users: an ordinary notification. */
      office: string[];
    }
  | { ok: false; error: 'invalid_recipient' };

/** Does a message to this role wait for OK? */
export function requiresOk(role: string): boolean {
  return role === 'user';
}

/**
 * Split the addressed people by how their message arrives.
 *
 * `found` is what the server re-read for the requested ids, already limited to
 * approved accounts. All or nothing: if any requested id is missing from it,
 * or the sender addressed themselves, the whole send is refused — a partial
 * send would leave the sender believing everyone named was told.
 */
export function planDirectSend(
  requestedIds: string[],
  found: Recipient[],
  senderId: string,
): DirectSendPlan {
  const requested = new Set(requestedIds);
  const matched = found.filter((r) => requested.has(r.id));

  if (requested.has(senderId) || matched.length !== requested.size) {
    return { ok: false, error: 'invalid_recipient' };
  }

  return {
    ok: true,
    floor: matched.filter((r) => requiresOk(r.role)).map((r) => r.id),
    office: matched.filter((r) => !requiresOk(r.role)).map((r) => r.id),
  };
}
