'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';

/* The equipment list: whoever runs Maintenance, Admin and Owners (RLS: can_manage_maintenance). */

const text = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

const schema = z.object({
  name: z.string().trim().min(1, { message: 'name_required' }).max(120),
  location: text(120),
  brand: text(80),
  model: text(80),
  serial_number: text(80),
  service_contact: text(120),
  service_phone: text(40),
  service_email: text(120),
  notes: text(2000),
});

function fail(error: { message: string; code?: string }): { ok: false; error: string } {
  if (error.code === '23505' || error.message.includes('equipment_name_key')) return { ok: false, error: 'name_exists' };
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: error.message };
}

export async function saveEquipment(input: z.input<typeof schema>, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const supabase = createClient();
  if (id) {
    const { data, error } = await supabase.from('equipment').update(parsed.data).eq('id', id).select('id');
    if (error) return fail(error);
    if (!data?.length) return { ok: false, error: 'not_authorized' };
  }
  const res = id ? { data: { id }, error: null } : await supabase.from('equipment').insert(parsed.data).select('id').single();
  if (res.error) return fail(res.error);
  revalidatePath('/maintenance/equipment');
  revalidatePath(`/maintenance/equipment/${res.data!.id}`);
  return { ok: true, data: { id: res.data!.id } };
}

/** Out of service (kept with its history), or back. */
export async function setEquipmentActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from('equipment').update({ is_active: active }).eq('id', id).select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidatePath('/maintenance/equipment');
  revalidatePath(`/maintenance/equipment/${id}`);
  return { ok: true, data: undefined };
}
