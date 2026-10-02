import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* Repair requests. RLS: whoever reported one sees it; Maintenance sees them all. */

export type RepairUrgency = 'normal' | 'urgent' | 'stops_production';
export type RepairStatus = 'new' | 'in_progress' | 'fixed' | 'cancelled';

export interface Repair {
  id: string;
  title: string;
  description: string | null;
  equipment_id: string | null;
  equipment_name: string | null;
  place: string | null;
  urgency: RepairUrgency;
  status: RepairStatus;
  reported_by: string;
  reporter_name: string | null;
  task_id: string | null;
  planned_on: string | null;
  resolution: string | null;
  cost: number | null;
  fixed_by_name: string | null;
  fixed_at: string | null;
  created_at: string;
}

const COLUMNS = `
  id, title, description, equipment_id, place, urgency, status, reported_by, task_id, resolution, cost, fixed_at, created_at,
  equipment:equipment ( name ),
  reporter:profiles!repair_requests_reported_by_fkey ( name, email ),
  fixer:profiles!repair_requests_fixed_by_fkey ( name, email ),
  task:tasks ( starts_on )
`;

type Person = { name: string | null; email: string } | null;
type Raw = Omit<Repair, 'equipment_name' | 'reporter_name' | 'fixed_by_name' | 'planned_on'> & {
  equipment: { name: string } | null;
  reporter: Person;
  fixer: Person;
  task: { starts_on: string | null } | null;
};
const nameOf = (p: Person) => (p ? p.name || p.email : null);

function shape({ equipment, reporter, fixer, task, ...r }: Raw): Repair {
  return {
    ...r,
    cost: r.cost === null ? null : Number(r.cost),
    equipment_name: equipment?.name ?? null,
    reporter_name: nameOf(reporter),
    fixed_by_name: nameOf(fixer),
    planned_on: task?.starts_on ?? null,
  };
}

const URGENCY_ORDER: Record<RepairUrgency, number> = { stops_production: 0, urgent: 1, normal: 2 };

/** Open ones, the most urgent first; or closed ones, newest first. */
export async function getRepairs(open: boolean, equipmentId?: string): Promise<Repair[]> {
  const supabase = createClient();
  let query = supabase.from('repair_requests').select(COLUMNS);
  if (equipmentId) query = query.eq('equipment_id', equipmentId);
  else query = query.in('status', open ? ['new', 'in_progress'] : ['fixed', 'cancelled']);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  const rows = (data as unknown as Raw[]).map(shape);
  return open && !equipmentId ? rows.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.created_at.localeCompare(b.created_at)) : rows;
}

export async function getRepair(id: string): Promise<Repair | null> {
  const supabase = createClient();
  const { data } = await supabase.from('repair_requests').select(COLUMNS).eq('id', id).maybeSingle();
  return data ? shape(data as unknown as Raw) : null;
}

/** New reports waiting for Maintenance — the count on its menu entry. */
export async function countNewRepairs(): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase.from('repair_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  return count ?? 0;
}
