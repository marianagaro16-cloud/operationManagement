import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { businessToday } from '@/lib/datetime';

/*
 * The equipment list and each machine's maintenance: the activities about
 * it, what is planned and what was done. RLS decides who reads what — a
 * helper sees the days that are theirs.
 */

export interface Equipment {
  id: string;
  name: string;
  location: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  service_contact: string | null;
  service_phone: string | null;
  service_email: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface EquipmentRow extends Equipment {
  last_done: string | null;
  next_planned: string | null;
}

export interface EquipmentDay {
  id: string;
  date: string;
  title: string;
  status: string;
  assignee_name: string | null;
  done_at: string | null;
}

const COLUMNS = 'id, name, location, brand, model, serial_number, service_contact, service_phone, service_email, notes, is_active';

type DayRaw = { id: string; effective_due_date: string; status: string; completed_at: string | null; assignee_id: string | null; task: { title: string; equipment_id: string } };

async function daysOf(equipmentIds: string[]): Promise<DayRaw[]> {
  if (!equipmentIds.length) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from('task_occurrences')
    .select('id, effective_due_date, status, completed_at, assignee_id, task:tasks!inner ( title, equipment_id )')
    .in('task.equipment_id', equipmentIds)
    .order('effective_due_date', { ascending: false })
    .limit(2000);
  return (data ?? []) as unknown as DayRaw[];
}

export async function getEquipmentList(): Promise<EquipmentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('equipment').select(COLUMNS).order('is_active', { ascending: false }).order('name');
  if (error) throw new Error(error.message);
  const list = (data ?? []) as Equipment[];
  const days = await daysOf(list.map((e) => e.id));
  const today = businessToday();
  return list.map((e) => {
    const mine = days.filter((d) => d.task.equipment_id === e.id);
    const done = mine.filter((d) => d.status === 'completed').map((d) => d.effective_due_date).sort();
    const ahead = mine.filter((d) => d.status === 'pending' && d.effective_due_date >= today).map((d) => d.effective_due_date).sort();
    return { ...e, last_done: done[done.length - 1] ?? null, next_planned: ahead[0] ?? null };
  });
}

export async function getEquipment(id: string): Promise<{
  equipment: Equipment;
  activities: { id: string; title: string; is_active: boolean }[];
  days: EquipmentDay[];
} | null> {
  const supabase = createClient();
  const [{ data: equipment }, { data: tasks }] = await Promise.all([
    supabase.from('equipment').select(COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('tasks').select('id, title, is_active').eq('equipment_id', id).neq('frequency', 'one_off').order('title'),
  ]);
  if (!equipment) return null;
  const raw = await daysOf([id]);
  const people = [...new Set(raw.map((d) => d.assignee_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data } = await supabase.from('profiles').select('id, name, email').in('id', people);
    for (const p of data ?? []) names.set(p.id, p.name || p.email);
  }
  return {
    equipment: equipment as Equipment,
    activities: (tasks ?? []) as { id: string; title: string; is_active: boolean }[],
    days: raw.map((d) => ({
      id: d.id,
      date: d.effective_due_date,
      title: d.task.title,
      status: d.status,
      assignee_name: d.assignee_id ? names.get(d.assignee_id) ?? null : null,
      done_at: d.completed_at,
    })),
  };
}

/** For the activity form: active equipment, by name. */
export async function getEquipmentChoices(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient();
  const { data } = await supabase.from('equipment').select('id, name').eq('is_active', true).order('name');
  return data ?? [];
}
