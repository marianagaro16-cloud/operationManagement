import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/server/data';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Human resources as a spreadsheet: the worker list, the arrivals of a
 * period, or the evaluations of a period.
 *
 * A route, so the rows are read under the caller's own session: RLS gives a
 * Production manager Production's people only, and hides the Owners' files
 * and one's own, exactly as on screen.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TEAM_ES: Record<string, string> = {
  production: 'Producción',
  operations: 'Operaciones',
  logistics: 'Logística',
  sales: 'Ventas',
  marketing: 'Marketing',
};

type Column = { header: string; key: string; width: number };

async function workbook(name: string, columns: Column[], rows: Record<string, unknown>[]) {
  // Dynamic, so a large CommonJS dependency stays out of every other request.
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return wb.xlsx.writeBuffer();
}

const nameOf = (p: { name: string | null; email: string } | null) => (p ? p.name || p.email : '');
const date = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`) : null);

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer?.can('hr.manage')) return new NextResponse('Not authorized', { status: 403 });

  const p = request.nextUrl.searchParams;
  const kind = p.get('kind');
  const from = ISO.test(p.get('from') ?? '') ? p.get('from')! : '2000-01-01';
  const to = ISO.test(p.get('to') ?? '') ? p.get('to')! : '2999-12-31';
  const supabase = createClient();
  let file: ArrayBuffer | Buffer;
  let filename: string;

  if (kind === 'workers') {
    const { data, error } = await supabase
      .from('hr_workers')
      .select('name, team, position, start_date, birth_date, phone, email, address, emergency_contact, is_active, left_on')
      .order('is_active', { ascending: false })
      .order('name');
    if (error) return new NextResponse(error.message, { status: 500 });
    file = await workbook(
      'Trabajadores',
      [
        { header: 'Nombre', key: 'name', width: 28 },
        { header: 'Equipo', key: 'team', width: 14 },
        { header: 'Puesto', key: 'position', width: 24 },
        { header: 'Desde', key: 'start_date', width: 12 },
        { header: 'Nacimiento', key: 'birth_date', width: 12 },
        { header: 'Teléfono', key: 'phone', width: 16 },
        { header: 'Correo', key: 'email', width: 28 },
        { header: 'Dirección', key: 'address', width: 36 },
        { header: 'Contacto de emergencia', key: 'emergency_contact', width: 28 },
        { header: 'Activo', key: 'active', width: 8 },
        { header: 'Salida', key: 'left_on', width: 12 },
      ],
      (data ?? []).map((w) => ({
        ...w,
        team: TEAM_ES[w.team] ?? w.team,
        start_date: date(w.start_date),
        birth_date: date(w.birth_date),
        left_on: date(w.left_on),
        active: w.is_active ? 'Sí' : 'No',
      })),
    );
    filename = 'trabajadores';
  } else if (kind === 'arrivals') {
    const { data, error } = await supabase
      .from('hr_late_arrivals')
      .select(
        'arrival_date, expected_time, arrived_time, kind, minutes_off, excused, notified, note, worker:hr_workers ( name, team ), reason:hr_late_reasons ( name ), author:profiles!hr_late_arrivals_created_by_fkey ( name, email )',
      )
      .gte('arrival_date', from)
      .lte('arrival_date', to)
      .order('arrival_date');
    if (error) return new NextResponse(error.message, { status: 500 });
    type Row = {
      arrival_date: string; expected_time: string; arrived_time: string; kind: string; minutes_off: number;
      excused: boolean; notified: boolean; note: string | null;
      worker: { name: string; team: string } | null; reason: { name: string } | null; author: { name: string | null; email: string } | null;
    };
    file = await workbook(
      'Llegadas',
      [
        { header: 'Día', key: 'day', width: 12 },
        { header: 'Trabajador', key: 'worker', width: 26 },
        { header: 'Equipo', key: 'team', width: 14 },
        { header: 'Tipo', key: 'kind', width: 14 },
        { header: 'Debía entrar', key: 'expected', width: 12 },
        { header: 'Llegó', key: 'arrived', width: 10 },
        { header: 'Minutos', key: 'minutes', width: 10 },
        { header: 'Motivo', key: 'reason', width: 20 },
        { header: 'Justificada', key: 'excused', width: 11 },
        { header: 'Avisó antes', key: 'notified', width: 11 },
        { header: 'Nota', key: 'note', width: 40 },
        { header: 'Registró', key: 'author', width: 22 },
      ],
      ((data ?? []) as unknown as Row[]).map((a) => ({
        day: date(a.arrival_date),
        worker: a.worker?.name ?? '',
        team: TEAM_ES[a.worker?.team ?? ''] ?? '',
        kind: a.kind === 'early' ? 'Muy temprano' : 'Tarde',
        expected: a.expected_time.slice(0, 5),
        arrived: a.arrived_time.slice(0, 5),
        minutes: a.minutes_off,
        reason: a.reason?.name ?? '',
        excused: a.excused ? 'Sí' : 'No',
        notified: a.notified ? 'Sí' : 'No',
        note: a.note ?? '',
        author: nameOf(a.author),
      })),
    );
    filename = `llegadas-${from === '2000-01-01' ? 'todas' : `${from}_${to}`}`;
  } else if (kind === 'evaluations') {
    const { data, error } = await supabase
      .from('hr_evaluations')
      .select(
        'evaluated_on, comment, goals, worker:hr_workers ( name, team, position ), author:profiles!hr_evaluations_created_by_fkey ( name, email ), scores:hr_evaluation_scores ( criterion_name, score, comment, sort_order )',
      )
      .gte('evaluated_on', from)
      .lte('evaluated_on', to)
      .order('evaluated_on');
    if (error) return new NextResponse(error.message, { status: 500 });
    type Row = {
      evaluated_on: string; comment: string | null; goals: string | null;
      worker: { name: string; team: string; position: string | null } | null;
      author: { name: string | null; email: string } | null;
      scores: { criterion_name: string; score: number; comment: string | null; sort_order: number }[];
    };
    // One row per criterion rated, so it can be filtered and averaged.
    const rows = ((data ?? []) as unknown as Row[]).flatMap((e) => {
      const base = {
        day: date(e.evaluated_on),
        worker: e.worker?.name ?? '',
        team: TEAM_ES[e.worker?.team ?? ''] ?? '',
        position: e.worker?.position ?? '',
        author: nameOf(e.author),
      };
      const average = e.scores.length ? Math.round((e.scores.reduce((s, x) => s + x.score, 0) / e.scores.length) * 10) / 10 : null;
      return [...e.scores]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ ...base, criterion: s.criterion_name, score: s.score, criterion_comment: s.comment ?? '', average, comment: e.comment ?? '', goals: e.goals ?? '' }));
    });
    file = await workbook(
      'Evaluaciones',
      [
        { header: 'Día', key: 'day', width: 12 },
        { header: 'Trabajador', key: 'worker', width: 26 },
        { header: 'Equipo', key: 'team', width: 14 },
        { header: 'Puesto', key: 'position', width: 22 },
        { header: 'Evaluó', key: 'author', width: 22 },
        { header: 'Criterio', key: 'criterion', width: 36 },
        { header: 'Puntuación (1–5)', key: 'score', width: 14 },
        { header: 'Comentario del criterio', key: 'criterion_comment', width: 36 },
        { header: 'Media de la evaluación', key: 'average', width: 14 },
        { header: 'Comentario general', key: 'comment', width: 40 },
        { header: 'Objetivos', key: 'goals', width: 40 },
      ],
      rows,
    );
    filename = `evaluaciones-${from === '2000-01-01' ? 'todas' : `${from}_${to}`}`;
  } else {
    return new NextResponse('Unknown export', { status: 400 });
  }

  return new NextResponse(file as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
