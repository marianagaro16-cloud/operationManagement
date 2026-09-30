'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { HANDOVER_LINK_TYPES, type HandoverLinkType } from '@/types/absences';
import { sendToUsers } from './push';
import type { ActionResult } from './actions';

/*
 * Handover writes. The absent person and the approvers write it (RLS); the
 * people covering move an item on and write a note back
 * (handover_item_progress). A linked record is looked up with the writer's
 * own access — what they cannot read, they cannot link — and only its label
 * is kept with the item.
 */

const uuid = z.string().uuid();
const KNOWN = ['not_authorized', 'handover_item_removed', 'handover_item_locked', 'handover_item_not_found', 'handover_bad_status', 'link_not_found'];
function fail(error: { message: string }): { ok: false; error: string } {
  if (error.message.includes('row-level security')) return { ok: false, error: 'not_authorized' };
  return { ok: false, error: KNOWN.find((c) => error.message.includes(c)) ?? error.message };
}
function revalidateHandover(absenceId: string) {
  revalidatePath(`/absences/${absenceId}`);
  revalidatePath('/dashboard');
}

const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One record, as the viewer may read it: its label. Null when they may not, or it does not exist. */
async function labelOf(type: HandoverLinkType, id: string): Promise<string | null> {
  const supabase = createClient();
  switch (type) {
    case 'customer': {
      const { data } = await supabase.from('customers').select('company_name, city').eq('id', id).maybeSingle();
      return data ? [data.company_name, data.city].filter(Boolean).join(' · ') : null;
    }
    case 'product': {
      const { data } = await supabase.from('products').select('code, name, family').eq('id', id).maybeSingle();
      return data ? [data.code, data.name || data.family].filter(Boolean).join(' · ') : null;
    }
    case 'order': {
      const { data } = await supabase.from('orders').select('reference, delivery_date, customer:customers ( company_name )').eq('id', id).maybeSingle();
      if (!data) return null;
      const o = data as unknown as { reference: number; delivery_date: string; customer: { company_name: string } | null };
      return `#${o.reference} · ${o.customer?.company_name ?? ''} · ${day(o.delivery_date)}`;
    }
    case 'incident': {
      const { data } = await supabase.from('incidents').select('incident_number, description').eq('id', id).maybeSingle();
      return data ? `${data.incident_number} · ${clip(data.description)}` : null;
    }
    case 'goods_reception': {
      const { data } = await supabase.from('goods_receptions').select('reception_number, received_at, delivery_note').eq('id', id).maybeSingle();
      return data ? [data.reception_number, day(data.received_at.slice(0, 10)), data.delivery_note].filter(Boolean).join(' · ') : null;
    }
    case 'inventory': {
      const { data } = await supabase.from('inventory_instances').select('name_snapshot, inventory_date').eq('id', id).maybeSingle();
      return data ? `${data.name_snapshot} · ${day(data.inventory_date)}` : null;
    }
    case 'task': {
      const { data } = await supabase.from('tasks').select('title').eq('id', id).maybeSingle();
      return data ? data.title : null;
    }
    case 'reminder': {
      // Only one's own: linking someone else's reminder would show it to people it was never shared with.
      const { data: { user } } = await supabase.auth.getUser();
      const { data } = await supabase.from('reminders').select('title, due_at').eq('id', id).eq('created_by', user?.id ?? '').maybeSingle();
      return data ? `${data.title} · ${day(data.due_at.slice(0, 10))}` : null;
    }
    case 'personal_task': {
      const { data } = await supabase.from('personal_tasks').select('title, due_date').eq('id', id).maybeSingle();
      return data ? (data.due_date ? `${data.title} · ${day(data.due_date)}` : data.title) : null;
    }
  }
}

/** Records of a kind matching some text, as the viewer may read them — for linking. */
export async function searchLinkables(type: HandoverLinkType, query: string): Promise<ActionResult<{ id: string; label: string }[]>> {
  if (!HANDOVER_LINK_TYPES.includes(type)) return { ok: false, error: 'invalid_link' };
  const q = query.trim().replace(/[%,()]/g, ' ');
  const like = `%${q}%`;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const rows = async (): Promise<{ id: string; label: string }[]> => {
    switch (type) {
      case 'customer': {
        const { data } = await supabase.from('customers').select('id, company_name, city').ilike('company_name', like).eq('is_active', true).order('company_name').limit(12);
        return (data ?? []).map((c) => ({ id: c.id, label: [c.company_name, c.city].filter(Boolean).join(' · ') }));
      }
      case 'product': {
        const { data } = await supabase.from('products').select('id, code, name, family').or(`name.ilike.${like},code.ilike.${like},family.ilike.${like}`).eq('is_active', true).limit(12);
        return (data ?? []).map((p) => ({ id: p.id, label: [p.code, p.name || p.family].filter(Boolean).join(' · ') }));
      }
      case 'order': {
        const ref = Number(q.replace(/^#/, ''));
        let query = supabase.from('orders').select('id, reference, delivery_date, customer:customers!inner ( company_name )').neq('status', 'cancelled');
        query = Number.isInteger(ref) && ref > 0 ? query.eq('reference', ref) : query.ilike('customer.company_name', like);
        const { data } = await query.order('delivery_date', { ascending: false }).limit(12);
        return ((data ?? []) as unknown as { id: string; reference: number; delivery_date: string; customer: { company_name: string } }[]).map((o) => ({
          id: o.id,
          label: `#${o.reference} · ${o.customer.company_name} · ${day(o.delivery_date)}`,
        }));
      }
      case 'incident': {
        const { data } = await supabase.from('incidents').select('id, incident_number, description').or(`incident_number.ilike.${like},description.ilike.${like}`).order('created_at', { ascending: false }).limit(12);
        return (data ?? []).map((i) => ({ id: i.id, label: `${i.incident_number} · ${clip(i.description)}` }));
      }
      case 'goods_reception': {
        const { data } = await supabase.from('goods_receptions').select('id, reception_number, received_at, delivery_note').or(`reception_number.ilike.${like},delivery_note.ilike.${like}`).order('received_at', { ascending: false }).limit(12);
        return (data ?? []).map((g) => ({ id: g.id, label: [g.reception_number, day(g.received_at.slice(0, 10)), g.delivery_note].filter(Boolean).join(' · ') }));
      }
      case 'inventory': {
        const { data } = await supabase.from('inventory_instances').select('id, name_snapshot, inventory_date').ilike('name_snapshot', like).order('inventory_date', { ascending: false }).limit(12);
        return (data ?? []).map((i) => ({ id: i.id, label: `${i.name_snapshot} · ${day(i.inventory_date)}` }));
      }
      case 'task': {
        const { data } = await supabase.from('tasks').select('id, title').ilike('title', like).eq('is_active', true).order('title').limit(12);
        return (data ?? []).map((tk) => ({ id: tk.id, label: tk.title }));
      }
      case 'reminder': {
        const { data } = await supabase.from('reminders').select('id, title, due_at').eq('created_by', user?.id ?? '').eq('status', 'open').ilike('title', like).order('due_at').limit(12);
        return (data ?? []).map((r) => ({ id: r.id, label: `${r.title} · ${day(r.due_at.slice(0, 10))}` }));
      }
      case 'personal_task': {
        const { data } = await supabase.from('personal_tasks').select('id, title, due_date').eq('owner_id', user?.id ?? '').in('status', ['open', 'in_progress']).ilike('title', like).limit(12);
        return (data ?? []).map((p) => ({ id: p.id, label: p.due_date ? `${p.title} · ${day(p.due_date)}` : p.title }));
      }
    }
  };
  return { ok: true, data: await rows() };
}

const itemSchema = z.object({
  title: z.string().trim().min(1, { message: 'title_required' }).max(300),
  body: z.string().trim().max(5000).nullable().optional().transform((v) => v || null),
  link: z
    .object({ type: z.enum(HANDOVER_LINK_TYPES as [HandoverLinkType, ...HandoverLinkType[]]), id: uuid })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type HandoverItemInput = z.input<typeof itemSchema>;

/** Add or change an item. A new link is looked up now, with the writer's access. */
export async function saveHandoverItem(absenceId: string, input: HandoverItemInput, id?: string): Promise<ActionResult> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(absenceId).success) return { ok: false, error: parsed.error?.issues[0]?.message ?? 'invalid_item' };
  const v = parsed.data;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let link: { link_type: HandoverLinkType | null; link_id: string | null; link_label?: string | null } = { link_type: null, link_id: null, link_label: null };
  if (v.link) {
    const before = id ? (await supabase.from('handover_items').select('link_type, link_id').eq('id', id).maybeSingle()).data : null;
    const unchanged = before && before.link_type === v.link.type && before.link_id === v.link.id;
    if (unchanged) {
      link = { link_type: v.link.type, link_id: v.link.id };
    } else {
      const label = await labelOf(v.link.type, v.link.id);
      if (!label) return { ok: false, error: 'link_not_found' };
      link = { link_type: v.link.type, link_id: v.link.id, link_label: label };
    }
  }

  const row = { title: v.title, body: v.body, ...link, updated_by: user?.id ?? null };
  const { error } = id
    ? await supabase.from('handover_items').update(row).eq('id', id).is('removed_at', null)
    : await supabase.from('handover_items').insert({ ...row, absence_id: absenceId, created_by: user?.id ?? null });
  if (error) return fail(error);
  revalidateHandover(absenceId);
  return { ok: true, data: undefined };
}

/** Off the handover — kept, for the history. */
export async function removeHandoverItem(id: string, absenceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('handover_items')
    .update({ removed_at: new Date().toISOString(), updated_by: user?.id ?? null })
    .eq('id', id)
    .is('removed_at', null)
    .select('id');
  if (error) return fail(error);
  if (!data?.length) return { ok: false, error: 'not_authorized' };
  revalidateHandover(absenceId);
  return { ok: true, data: undefined };
}

/** Whoever covers (or writes): where an item stands, and a note back. */
export async function progressHandoverItem(id: string, absenceId: string, status: 'open' | 'in_progress' | 'done', note: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('handover_item_progress', { p_item_id: id, p_status: status, p_note: note.slice(0, 2000) });
  if (error) return fail(error);
  revalidateHandover(absenceId);
  return { ok: true, data: undefined };
}

/** "Send to the people covering me": one notification each, recorded. */
export async function sendHandover(absenceId: string): Promise<ActionResult<{ recipients: number }>> {
  if (!uuid.safeParse(absenceId).success) return { ok: false, error: 'not_authorized' };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: coverage }, { data: brief }, { count }] = await Promise.all([
    supabase.from('coverage_assignments').select('coverer_id').eq('absence_id', absenceId).is('removed_at', null),
    supabase.rpc('absence_brief', { p_absence_id: absenceId }),
    supabase.from('handover_items').select('id', { count: 'exact', head: true }).eq('absence_id', absenceId).is('removed_at', null),
  ]);
  const recipients = [...new Set((coverage ?? []).map((c) => c.coverer_id))].filter((id) => id !== user?.id);
  const { error } = await supabase.from('handover_sends').insert({ absence_id: absenceId, sent_by: user?.id ?? null, recipients: recipients.length });
  if (error) return fail(error);
  const person = ((brief ?? []) as { person_name: string }[])[0]?.person_name ?? '';
  if (recipients.length) {
    try {
      // In Spanish, like every other server-sent notification.
      await sendToUsers(recipients, {
        title: 'Entrega de trabajo',
        body: `${person}: ${count ?? 0} punto(s) para su ausencia`,
        url: `/absences/${absenceId}#handover`,
        tag: `handover-${absenceId}`,
      });
    } catch (err) {
      console.error('handover notice failed', err);
    }
  }
  revalidateHandover(absenceId);
  return { ok: true, data: { recipients: recipients.length } };
}
