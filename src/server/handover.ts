import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { HandoverItem, HandoverSuggestion } from '@/types/absences';

/*
 * Handover reads. RLS decides who sees it: the absent person, the approvers
 * and whoever covers that absence.
 */

export async function canSeeHandover(absenceId: string): Promise<{ see: boolean; write: boolean }> {
  const supabase = createClient();
  const [{ data: see }, { data: write }] = await Promise.all([
    supabase.rpc('can_see_handover', { p_absence_id: absenceId }),
    supabase.rpc('can_write_handover', { p_absence_id: absenceId }),
  ]);
  return { see: see === true, write: write === true };
}

export async function getHandover(absenceId: string): Promise<{ items: HandoverItem[]; lastSent: string | null }> {
  const supabase = createClient();
  const [{ data, error }, { data: sends }] = await Promise.all([
    supabase
      .from('handover_items')
      .select('id, absence_id, title, body, link_type, link_id, link_label, status, coverer_note, updated_at, updater:profiles!handover_items_updated_by_fkey ( name, email )')
      .eq('absence_id', absenceId)
      .is('removed_at', null)
      .order('sort_order')
      .order('created_at'),
    supabase.from('handover_sends').select('sent_at').eq('absence_id', absenceId).order('sent_at', { ascending: false }).limit(1),
  ]);
  if (error) throw new Error(error.message);
  type Raw = Omit<HandoverItem, 'updater_name'> & { updater: { name: string | null; email: string } | null };
  return {
    items: ((data ?? []) as unknown as Raw[]).map(({ updater, ...i }) => ({ ...i, updater_name: updater ? updater.name || updater.email : null })),
    lastSent: sends?.[0]?.sent_at ?? null,
  };
}

/**
 * For preparing the handover: the absent person's activities, reminders and
 * personal tasks that fall in the absence. Only for the person themselves —
 * RLS returns nobody else's reminders or personal tasks.
 */
export async function getHandoverSuggestions(profileId: string, from: string, to: string): Promise<HandoverSuggestion[]> {
  const supabase = createClient();
  const [{ data: occ }, { data: reminders }, { data: tasks }] = await Promise.all([
    supabase
      .from('task_occurrences')
      .select('id, effective_due_date, task:tasks!inner ( id, title )')
      .eq('assignee_id', profileId)
      .in('status', ['pending', 'blocked'])
      .gte('effective_due_date', from)
      .lte('effective_due_date', to)
      .order('effective_due_date')
      .limit(40),
    supabase
      .from('reminders')
      .select('id, title, due_at')
      .eq('created_by', profileId)
      .eq('status', 'open')
      .gte('due_at', `${from}T00:00:00`)
      .lte('due_at', `${to}T23:59:59`)
      .order('due_at')
      .limit(20),
    supabase
      .from('personal_tasks')
      .select('id, title, due_date')
      .eq('owner_id', profileId)
      .in('status', ['open', 'in_progress'])
      .gte('due_date', from)
      .lte('due_date', to)
      .order('due_date')
      .limit(20),
  ]);
  const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
  // One activity once, however many days it falls on.
  const seen = new Set<string>();
  const activities: HandoverSuggestion[] = [];
  for (const o of (occ ?? []) as unknown as { effective_due_date: string; task: { id: string; title: string } }[]) {
    if (seen.has(o.task.id)) continue;
    seen.add(o.task.id);
    activities.push({ type: 'task', id: o.task.id, label: `${o.task.title} · ${day(o.effective_due_date)}` });
  }
  return [
    ...activities,
    ...(reminders ?? []).map((r) => ({ type: 'reminder' as const, id: r.id, label: `${r.title} · ${day(r.due_at.slice(0, 10))}` })),
    ...(tasks ?? []).map((p) => ({ type: 'personal_task' as const, id: p.id, label: p.due_date ? `${p.title} · ${day(p.due_date)}` : p.title })),
  ];
}
