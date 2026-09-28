'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { MIN_PASSWORD_LENGTH, tempPassword } from '@/domain/auth/temp-password';
import type { ActionResult } from './actions';

/*
 * Passwords.
 *
 * Setting a password needs the service role: Supabase lets a signed-in user
 * change only their own, and never another's. So the database decides first
 * — request_password_reset() for a reset, the session itself for a change —
 * and only then does the service role write the password.
 */

const KNOWN = ['not_authorized', 'cannot_reset_self', 'user_not_found', 'owner_protected'];

/**
 * An Admin or Owner gives someone a temporary password. Returned once, to
 * be passed on; the person must choose their own at their next sign-in.
 */
export async function resetUserPassword(userId: string): Promise<ActionResult<{ password: string }>> {
  const supabase = createClient();
  const { error } = await supabase.rpc('request_password_reset', { p_user_id: userId });
  if (error) {
    return { ok: false, error: KNOWN.find((code) => error.message.includes(code)) ?? error.message };
  }

  const password = tempPassword();
  const { error: setError } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (setError) return { ok: false, error: setError.message };

  revalidatePath('/admin/users');
  return { ok: true, data: { password } };
}

/** The signed-in person chooses their own password after a reset. */
export async function chooseOwnPassword(password: string): Promise<ActionResult> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: 'password_too_short' };
  }
  if (password.length > 200) return { ok: false, error: 'password_too_long' };

  // Only ever the caller's own account, taken from their session.
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return { ok: false, error: 'not_authorized' };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) return { ok: false, error: error.message };

  const { error: flagError } = await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id);
  if (flagError) return { ok: false, error: flagError.message };

  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}
