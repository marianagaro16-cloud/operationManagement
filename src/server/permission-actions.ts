'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { CONFIGURABLE_ROLES, PERMISSIONS, isConfigurable, type Permission } from '@/lib/authz';
import type { ActionResult } from './actions';

/**
 * Editing the role/permission matrix.
 *
 * Admin-only, and enforced in three independent places, which is deliberate
 * for a screen that decides who may do what:
 *
 *   1. the `role_permissions: admin writes` RLS policy;
 *   2. a CHECK constraint allowing only 'manager' and 'power_user' rows;
 *   3. a trigger refusing any permission catalogued as non-configurable.
 *
 * The validation below is a fourth layer whose only job is to produce a
 * translatable message instead of a raw Postgres error. It is not what makes
 * the rule true.
 */

const toggleSchema = z.object({
  role: z.enum(CONFIGURABLE_ROLES),
  permission: z.enum(PERMISSIONS),
  enabled: z.boolean(),
});

export async function setRolePermission(
  input: z.infer<typeof toggleSchema>,
): Promise<ActionResult> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_permission' };

  const { role, permission, enabled } = parsed.data;

  // Refused here as well as by the database trigger, so the UI can say which
  // rule was broken rather than surfacing an error code from a trigger.
  if (!isConfigurable(permission as Permission)) {
    return { ok: false, error: 'permission_not_configurable' };
  }

  const supabase = createClient();

  if (enabled) {
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role, permission }, { onConflict: 'role,permission', ignoreDuplicates: true });
    if (error) return fail(error);
  } else {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role', role)
      .eq('permission', permission);
    if (error) return fail(error);
  }

  // A permission change alters what every screen offers, so the whole
  // authenticated surface is stale, not just this page.
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('permission_not_configurable')) {
    return { ok: false, error: 'permission_not_configurable' };
  }
  if (message.includes('role_permissions_role_configurable')) {
    return { ok: false, error: 'invalid_permission' };
  }
  if (message.includes('violates row-level security')) {
    return { ok: false, error: 'not_authorized' };
  }
  return { ok: false, error: message };
}
