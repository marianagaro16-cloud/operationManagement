import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ProductionRecord } from '@/types/database';

/*
 * Production orders at a glance: what is still to make, and what was made.
 * RLS decides who sees what — the planners see all.
 */

export interface OpenProduction {
  occurrence_id: string;
  due: string;
  product_name: string;
  target_quantity: number;
  assignee_name: string | null;
}

export interface MadeProduction extends ProductionRecord {
  occurrence_id: string;
  due: string;
  product_name: string;
  recorded_by_name: string | null;
  recorded_at: string;
}

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);

export async function getProductionOverview(today: string, until: string, since: string): Promise<{ open: OpenProduction[]; made: MadeProduction[] }> {
  const supabase = createClient();
  const [open, made] = await Promise.all([
    supabase
      .from('task_occurrences')
      .select('id, effective_due_date, assignee_id, target_quantity, task:tasks!inner ( target_quantity, product_id, product:products ( name ) )')
      .not('task.product_id', 'is', null)
      .eq('status', 'pending')
      .lte('effective_due_date', until)
      .order('effective_due_date'),
    supabase
      .from('production_records')
      .select(
        'occurrence_id, produced_quantity, target_quantity, lot_number, best_before, shortfall_reason, shortfall_note, recorded_at, product:products ( name ), occurrence:task_occurrences ( effective_due_date ), recorder:profiles!production_records_recorded_by_fkey ( name, email )',
      )
      .gte('recorded_at', `${since}T00:00:00Z`)
      .order('recorded_at', { ascending: false })
      .limit(300),
  ]);
  if (open.error) throw new Error(open.error.message);
  if (made.error) throw new Error(made.error.message);

  const openRows = (open.data ?? []) as unknown as {
    id: string;
    effective_due_date: string;
    assignee_id: string | null;
    target_quantity: number | null;
    task: { target_quantity: number; product: { name: string } | null };
  }[];
  const ids = [...new Set(openRows.map((r) => r.assignee_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from('profiles').select('id, name, email').in('id', ids);
    for (const p of data ?? []) names.set(p.id, p.name || p.email);
  }
  void today;

  return {
    open: openRows.map((r) => ({
      occurrence_id: r.id,
      due: r.effective_due_date,
      product_name: r.task.product?.name ?? '—',
      target_quantity: Number(r.target_quantity ?? r.task.target_quantity),
      assignee_name: r.assignee_id ? names.get(r.assignee_id) ?? null : null,
    })),
    made: ((made.data ?? []) as unknown as (ProductionRecord & {
      occurrence_id: string;
      recorded_at: string;
      product: { name: string } | null;
      occurrence: { effective_due_date: string } | null;
      recorder: Person;
    })[]).map(({ product, occurrence, recorder, ...r }) => ({
      ...r,
      due: occurrence?.effective_due_date ?? r.recorded_at.slice(0, 10),
      product_name: product?.name ?? '—',
      recorded_by_name: nameOf(recorder),
    })),
  };
}
