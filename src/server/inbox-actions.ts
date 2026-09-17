'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';

/**
 * Mark inbox entries read. A thin transport: mark_inbox_read() only ever
 * touches the caller's own rows, whatever ids arrive.
 *
 * No ids marks everything read.
 */
const schema = z.array(z.string().uuid()).max(500).optional();

export async function markInboxRead(ids?: string[]): Promise<ActionResult> {
  const parsed = schema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = createClient();
  const { error } = await supabase.rpc('mark_inbox_read', { p_ids: parsed.data ?? null });
  if (error) return { ok: false, error: error.message };

  // The unread badge lives in the shell, on every screen.
  revalidatePath('/', 'layout');
  return { ok: true, data: undefined };
}
