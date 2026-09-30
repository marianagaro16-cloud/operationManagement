import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SalesSummary, SummaryContent, SummaryNote } from '@/types/summaries';

/*
 * The sales summary: what was talked about with customers and prospects in
 * a period — the starred notes first — what was done, and the events. Built
 * with sales' own access; shared as a snapshot (sales_summaries), which the
 * people it is shared with read without access to Ventas.
 */

type Person = { name: string | null; email: string } | null;
const nameOf = (p: Person) => (p ? p.name || p.email : null);

export async function buildSummary(from: string, to: string): Promise<SummaryContent> {
  const supabase = createClient();
  const [
    { data: kinds },
    { data: cNotes, error: cError },
    { data: pNotes, error: pError },
    { data: activities },
    { data: created },
    { data: closed },
    { data: events },
  ] = await Promise.all([
    supabase.from('sales_activity_kinds').select('id, name, translations'),
    supabase
      .from('customer_notes')
      .select('id, kind_id, note_date, body, starred, target:customers ( company_name ), author:profiles!customer_notes_created_by_fkey ( name, email )')
      .gte('note_date', from)
      .lte('note_date', to)
      .order('note_date'),
    supabase
      .from('prospect_notes')
      .select('id, kind_id, note_date, body, starred, target:prospects ( company_name ), author:profiles!prospect_notes_created_by_fkey ( name, email )')
      .gte('note_date', from)
      .lte('note_date', to)
      .order('note_date'),
    supabase.from('sales_activities').select('kind_id, status').gte('activity_date', from).lte('activity_date', to).is('event_id', null),
    supabase.from('prospects').select('company_name').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`),
    supabase.from('prospects').select('company_name, stage').gte('closed_at', `${from}T00:00:00`).lte('closed_at', `${to}T23:59:59`),
    supabase
      .from('events')
      .select('id, name, start_date, end_date, stage, place_name, city, result_rating, result_summary, costs:event_costs ( planned_amount, actual_amount ), contacts:prospects ( id )')
      .lte('start_date', to)
      .gte('end_date', from)
      .neq('stage', 'idea')
      .order('start_date'),
  ]);
  if (cError) throw new Error(cError.message);
  if (pError) throw new Error(pError.message);

  type RawNote = { id: string; kind_id: string; note_date: string; body: string; starred: boolean; target: { company_name: string } | null; author: Person };
  const notes: SummaryNote[] = [
    ...((cNotes ?? []) as unknown as RawNote[]).map((n) => ({ ...n, target_kind: 'customer' as const })),
    ...((pNotes ?? []) as unknown as RawNote[]).map((n) => ({ ...n, target_kind: 'prospect' as const })),
  ]
    .map((n) => ({
      id: n.id,
      date: n.note_date,
      target: n.target?.company_name ?? '—',
      target_kind: n.target_kind,
      kind_id: n.kind_id,
      body: n.body,
      author: nameOf(n.author),
      starred: n.starred,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byTarget = new Map<string, SummaryContent['conversations'][number]>();
  for (const n of notes) {
    const key = `${n.target_kind}:${n.target}`;
    const e = byTarget.get(key) ?? { target: n.target, target_kind: n.target_kind, notes: [] };
    e.notes.push(n);
    byTarget.set(key, e);
  }

  const counts = new Map<string, { kind_id: string; done: number; not_done: number; planned: number }>();
  for (const a of activities ?? []) {
    const c = counts.get(a.kind_id) ?? { kind_id: a.kind_id, done: 0, not_done: 0, planned: 0 };
    if (a.status === 'done') c.done++;
    else if (a.status === 'not_done') c.not_done++;
    else c.planned++;
    counts.set(a.kind_id, c);
  }

  type RawEvent = {
    name: string; start_date: string; end_date: string; stage: string; place_name: string | null; city: string | null;
    result_rating: number | null; result_summary: string | null;
    costs: { planned_amount: number | string | null; actual_amount: number | string | null }[] | null;
    contacts: { id: string }[] | null;
  };

  return {
    kinds: Object.fromEntries((kinds ?? []).map((k) => [k.id, { name: k.name, translations: k.translations }])),
    highlights: notes.filter((n) => n.starred),
    conversations: [...byTarget.values()].sort((a, b) => b.notes.length - a.notes.length || a.target.localeCompare(b.target)),
    activity: {
      byKind: [...counts.values()].sort((a, b) => b.done + b.not_done + b.planned - (a.done + a.not_done + a.planned)),
      prospects: {
        created: (created ?? []).map((p) => p.company_name),
        won: (closed ?? []).filter((p) => p.stage === 'won').map((p) => p.company_name),
        lost: (closed ?? []).filter((p) => p.stage === 'lost').map((p) => p.company_name),
      },
    },
    events: ((events ?? []) as unknown as RawEvent[]).map((e) => ({
      name: e.name,
      start_date: e.start_date,
      end_date: e.end_date,
      stage: e.stage,
      place: [e.place_name, e.city].filter(Boolean).join(', ') || null,
      rating: e.result_rating,
      summary: e.result_summary,
      contacts: (e.contacts ?? []).length,
      planned_cost: (e.costs ?? []).reduce((s, c) => s + Number(c.planned_amount ?? 0), 0),
      actual_cost: (e.costs ?? []).reduce((s, c) => s + Number(c.actual_amount ?? 0), 0),
    })),
  };
}

export async function getSummary(id: string): Promise<SalesSummary | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_summaries')
    .select('id, title, period_from, period_to, content, created_at, author:profiles!sales_summaries_created_by_fkey ( name, email )')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const { author, ...s } = data as unknown as Omit<SalesSummary, 'author'> & { author: Person };
  return { ...s, author: nameOf(author) };
}

/** The summaries shared so far, latest first — for sales. */
export async function listSummaries(limit = 20): Promise<Pick<SalesSummary, 'id' | 'title' | 'period_from' | 'period_to' | 'created_at'>[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('sales_summaries')
    .select('id, title, period_from, period_to, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Summaries attached to a meeting. */
export async function getMeetingSummaries(meetingId: string): Promise<{ id: string; title: string }[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('meeting_summaries')
    .select('summary:sales_summaries ( id, title )')
    .eq('meeting_id', meetingId);
  return ((data ?? []) as unknown as { summary: { id: string; title: string } | null }[])
    .map((r) => r.summary)
    .filter((s): s is { id: string; title: string } => !!s);
}
