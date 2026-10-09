import type { CSSProperties, ReactNode } from 'react';
import { contractHours, dayHours, formatHours, isChanged, pauseMinutes, productionStaffing, weekHours, workedHours, type Block } from '@/domain/schedule/schedule';
import type { ScheduleKind, SchedulePerson, ScheduleProduct, ScheduleWeekHeader } from '@/types/schedule';

/*
 * The schedule as a sheet — the page the team has always been sent.
 *
 * One drawing for the screen and for the PDF, so what is edited is what is
 * shared. Its words are the sheet's own and do not follow the reader's
 * language: German weekdays, Spanish labels, as it has always been printed.
 * White paper and black ink whatever the app's theme, with the colours set
 * inline so a printer keeps them.
 */

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const NOTE_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const CHANGED = '#FFFF00';
const LINE = '1px solid #000';
const THIN = '1px solid #9a9a9a';

const ddmm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const ddmmyy = (date: string) => `${ddmm(date)}.${date.slice(2, 4)}`;

/** "11.10.26 - 17.10.26" */
export function weekTitle(dates: string[]): string {
  return `${ddmmyy(dates[0])} - ${ddmmyy(dates[6])}`;
}

/**
 * A kind's fill: its colour — or, for the days nobody works, white under the
 * hatch that <Hatch> draws inside the same box.
 */
export function kindFill(kind: Pick<ScheduleKind, 'color' | 'hatched'>): CSSProperties {
  return kind.hatched ? { backgroundColor: '#fff', position: 'relative', overflow: 'hidden' } : { backgroundColor: kind.color };
}

const HATCH_LINES = [...Array(24)].map((_, k) => `M${k * 4 - 22} 22L${k * 4} 0`).join('');

/**
 * The hatch, as lines. Drawn rather than set as a CSS gradient because a
 * printer turns each gradient into a picture: the same week came out as a PDF
 * of 4 MB, and of 30 MB without scaling. As lines it is some 100 KB.
 */
export function Hatch({ kind }: { kind: Pick<ScheduleKind, 'color' | 'hatched'> | undefined }) {
  if (!kind?.hatched) return null;
  return (
    <svg viewBox="0 0 48 22" preserveAspectRatio="none" width="100%" height="100%" aria-hidden style={{ position: 'absolute', inset: 0, display: 'block' }}>
      <path d={HATCH_LINES} stroke={kind.color} strokeWidth="1.4" />
    </svg>
  );
}

/** The pause as the sheet draws it: an empty, quarter, half or full circle. */
export function PauseIcon({ minutes, size = 13 }: { minutes: 0 | 15 | 30 | 60; size?: number }) {
  const r = 5;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-label={`${minutes} min`} role="img" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="6" cy="6" r={r} fill={minutes === 60 ? '#404040' : '#fff'} stroke="#404040" strokeWidth="0.8" />
      {minutes === 15 && <path d={`M6 6 L6 ${6 - r} A${r} ${r} 0 0 1 ${6 + r} 6 Z`} fill="#404040" />}
      {minutes === 30 && <path d={`M6 ${6 - r} A${r} ${r} 0 0 1 6 ${6 + r} Z`} fill="#404040" />}
    </svg>
  );
}

export function ScheduleSheet({
  title,
  tag,
  dates,
  people,
  blocks,
  kinds,
  products,
  header,
  changed,
  absentDays = {},
  showTotal = false,
  showContract = false,
  showStaffing = false,
  timeCell,
  onCell,
  onDay,
}: {
  title: string;
  /** Beside the title: "v2", "Borrador". */
  tag?: string;
  /** The week's seven dates, or null for the usual week. */
  dates: string[] | null;
  people: SchedulePerson[];
  blocks: Block[];
  kinds: ScheduleKind[];
  products: ScheduleProduct[];
  header: ScheduleWeekHeader;
  /** Cells changed since the version before: drawn yellow. */
  changed: Set<string>;
  /** Days with an approved absence, per person — a hint on screen only. */
  absentDays?: Record<string, number[]>;
  /**
   * The sum of everyone's hours under the totals. Payroll's figure: only for
   * whoever makes the schedule, on screen — never on the page that is shared.
   */
  showTotal?: boolean;
  /** Under each total, the hours worked against the person's contract. On screen, for whoever makes it. */
  showContract?: boolean;
  /** Under the rows, the people in production each day against what the product takes. On screen only. */
  showStaffing?: boolean;
  /**
   * Draws a time as something to type into. With it the sheet is edited in
   * place, and a person's day opens on a double click instead of a click.
   */
  timeCell?: (at: { personId: string; day: number; slot: 1 | 2; field: 'start' | 'end'; text: string }) => ReactNode;
  onCell?: (personId: string, day: number) => void;
  onDay?: (day: number) => void;
}) {
  const kindOf = new Map(kinds.map((k) => [k.id, k]));
  const rules = new Map(kinds.map((k) => [k.id, { id: k.id, counts_hours: k.counts_hours }]));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const days = [0, 1, 2, 3, 4, 5, 6];
  const total = people.reduce((s, p) => s + weekHours(blocks, p.id, rules), 0);

  const th: CSSProperties = { border: LINE, padding: '2px 3px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' };
  const cell: CSSProperties = { borderTop: THIN, borderBottom: THIN, borderLeft: THIN, borderRight: THIN, padding: '2px 3px', textAlign: 'center', height: 19, minWidth: 40 };

  /** The two time cells of one slot of a person's day. */
  const slotCells = (person: SchedulePerson, day: number, slot: 1 | 2): ReactNode => {
    const mine = blocks.filter((b) => b.person_id === person.id && b.day === day);
    const own = mine.find((b) => b.slot === slot);
    // A whole day off fills both lines of the day, as the sheet always drew it.
    const wholeDay = mine.find((b) => !b.start_time && b.kind_id);
    const block = own ?? (wholeDay && mine.length === 1 ? wholeDay : undefined);
    const kind = block?.kind_id ? kindOf.get(block.kind_id) : undefined;
    const yellow = isChanged(changed, person.id, day);
    const absent = absentDays[person.id]?.includes(day) ?? false;
    const fill: CSSProperties = kind ? kindFill(kind) : yellow && (own || slot === 1) ? { backgroundColor: CHANGED } : {};
    const style: CSSProperties = {
      ...cell,
      ...fill,
      ...(yellow && kind ? { boxShadow: `inset 0 0 0 2px ${CHANGED}` } : {}),
      ...(absent ? { outline: '1.5px dashed #c0392b', outlineOffset: -2 } : {}),
      ...(onCell && !timeCell ? { cursor: 'pointer' } : {}),
      ...(timeCell ? { padding: 0 } : {}),
      ...(slot === 1 ? { borderTop: LINE } : { borderBottom: LINE }),
    };
    const open = onCell ? () => onCell(person.id, day) : undefined;
    // Typed into in place: a click is for the cursor, so the day opens on a double click.
    const handlers = timeCell ? { onDoubleClick: open } : { onClick: open };
    const time = (field: 'start' | 'end', text: string) =>
      timeCell ? timeCell({ personId: person.id, day, slot, field, text }) : <span style={{ position: 'relative' }}>{text}</span>;
    return (
      <>
        <td style={{ ...style, borderLeft: LINE }} {...handlers} title={absent ? 'Ausencia aprobada' : kind?.name}>
          <Hatch kind={kind} />
          {time('start', own?.start_time ?? '')}
        </td>
        <td style={style} {...handlers} title={absent ? 'Ausencia aprobada' : kind?.name}>
          <Hatch kind={kind} />
          {time('end', own?.end_time ?? '')}
        </td>
      </>
    );
  };

  return (
    <div style={{ background: '#fff', color: '#000', fontSize: 11, lineHeight: 1.2, fontFamily: 'Calibri, Arial, Helvetica, sans-serif' }} className="schedule-sheet">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th colSpan={23} style={{ ...th, background: '#F4D4E9', fontSize: 13 }}>
                  {title}
                  {tag && <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11 }}>{tag}</span>}
                </th>
              </tr>
              <tr>
                <th style={{ ...th, background: '#ADB9CA' }} rowSpan={2} />
                {days.map((d) => (
                  <th key={d} colSpan={3} style={{ ...th, background: '#D6DCE4', fontSize: 9.5, height: 14, ...(onDay ? { cursor: 'pointer' } : {}) }} onClick={onDay ? () => onDay(d) : undefined}>
                    {(header.day_products[String(d)] ?? []).map((id) => productName.get(id)).filter(Boolean).join(' · ')}
                    {header.holidays.includes(d) && <span style={{ marginLeft: 4, fontWeight: 400 }}>(Feiertag)</span>}
                  </th>
                ))}
                <th style={{ ...th, background: '#D6DCE4' }} />
              </tr>
              <tr>
                {days.map((d) => (
                  <Day key={d} label={`${WEEKDAYS[d]}${dates ? ` ${ddmm(dates[d])}` : ''}`} style={th} onClick={onDay ? () => onDay(d) : undefined} />
                ))}
                <th style={{ ...th, background: '#D9D9D9' }}>Total Stunden</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const hours = weekHours(blocks, p.id, rules);
                return [1, 2].map((slot) => (
                  <tr key={`${p.id}-${slot}`}>
                    {slot === 1 && (
                      <td rowSpan={2} style={{ ...th, background: '#F4D4E9', minWidth: 78 }}>
                        {p.name}
                      </td>
                    )}
                    {days.map((d) => {
                      const worked = dayHours(blocks, p.id, d, rules);
                      return (
                        <Slot key={d}>
                          {slotCells(p, d, slot as 1 | 2)}
                          {slot === 1 && (
                            <td
                              rowSpan={2}
                              style={{ border: LINE, textAlign: 'center', width: 18, padding: 1, ...(onCell ? { cursor: 'pointer' } : {}) }}
                              onClick={onCell ? () => onCell(p.id, d) : undefined}
                            >
                              {worked > 0 && <PauseIcon minutes={pauseMinutes(worked)} />}
                            </td>
                          )}
                        </Slot>
                      );
                    })}
                    {slot === 1 && (
                      <td rowSpan={2} style={{ ...th, background: '#D9D9D9' }}>
                        {formatHours(hours)}
                        {showContract && <Contract worked={workedHours(blocks, p.id, rules)} person={p} />}
                      </td>
                    )}
                  </tr>
                ));
              })}
              {showStaffing && (
                <tr>
                  <td style={{ ...th, fontWeight: 400, fontSize: 9.5, whiteSpace: 'normal' }}>En producción</td>
                  {productionStaffing(blocks, header.day_products, products).map((s) => (
                    <td
                      key={s.day}
                      colSpan={3}
                      style={{ ...th, fontWeight: s.short ? 700 : 400, fontSize: 10.5, color: s.need == null ? '#525252' : s.short ? '#b45309' : '#15803d' }}
                      title="Personas en producción (según sus horas) / las que necesita el producto del día"
                    >
                      {s.count > 0 || s.need != null ? `${s.count.toFixed(1)}${s.need != null ? ` / ${s.need.toFixed(1)}` : ''}` : ''}
                    </td>
                  ))}
                  <td style={{ border: 'none' }} />
                </tr>
              )}
              {showTotal && (
                <tr>
                  <td colSpan={22} style={{ border: 'none' }} />
                  <td style={{ ...th }}>{formatHours(total)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* The kinds, as the sheet's own legend. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', margin: '8px 0 8px 82px' }}>
            {kinds.filter((k) => k.is_active).map((k) => (
              <div key={k.id} style={{ minWidth: 86 }}>
                <div style={{ fontWeight: 700, fontSize: 10 }}>{k.name}:</div>
                <div style={{ ...kindFill(k), border: LINE, height: 22, width: 86 }}>
                  <Hatch kind={k} />
                </div>
              </div>
            ))}
            {/* Not a kind of block, but read the same way: beside them. */}
            <div style={{ minWidth: 86 }}>
              <div style={{ fontWeight: 700, fontSize: 10 }}>Cambio en horario:</div>
              <div style={{ background: CHANGED, border: LINE, height: 22, width: 86 }} />
            </div>
          </div>

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {[1, 2, 3].map((d, i) => (
                <tr key={d}>
                  {i === 0 && (
                    <td rowSpan={3} style={{ ...th, width: 82, whiteSpace: 'normal' }}>
                      Datos importantes de la semana
                    </td>
                  )}
                  <NoteCell label={NOTE_DAYS[d]} text={header.day_notes[String(d)]} />
                  <NoteCell label={NOTE_DAYS[d + 3]} text={header.day_notes[String(d + 3)]} />
                  {i === 0 && (
                    <td rowSpan={3} style={{ border: LINE, padding: '2px 4px', width: '18%', verticalAlign: 'top' }}>
                      <span style={{ fontSize: 9.5 }}>{NOTE_DAYS[0]}:</span> {header.day_notes['0'] ?? ''}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside style={{ flex: '0 0 132px', textAlign: 'center' }}>
          <p style={{ margin: '34px 0 4px' }}>
            <strong>P</strong> = Pausenzeit
          </p>
          {([[0, '≤ 5.5 Stdn = 0 Min.'], [15, '> 5.5 Stdn = 15 Min.'], [30, '> 7 Stdn = 30 Min.'], [60, '> 9 Stdn = 60 Min.']] as const).map(([m, text]) => (
            <p key={m} style={{ margin: '0 0 10px' }}>
              <PauseIcon minutes={m} size={15} />
              <br />
              {text}
            </p>
          ))}
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 6 }}>
            <tbody>
              <tr>
                <td colSpan={2} style={{ ...th, background: '#DCE6F0', padding: '6px 3px', fontSize: 12 }}>
                  Limpieza semanal
                </td>
              </tr>
              <tr>
                <td style={{ ...th, textAlign: 'left' }}>Baños:</td>
                <td style={{ ...th, fontWeight: 400 }}>{(header.cleaning_bathroom && personName.get(header.cleaning_bathroom)) || ''}</td>
              </tr>
              <tr>
                <td style={{ ...th, textAlign: 'left' }}>Cocina:</td>
                <td style={{ ...th, fontWeight: 400 }}>{(header.cleaning_kitchen && personName.get(header.cleaning_kitchen)) || ''}</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </div>
    </div>
  );
}

/**
 * Hours worked against the contract — "41.50 / 42.00". Amber while the week
 * is short of it, green once it is reached, red over the person's maximum.
 */
function Contract({ worked, person }: { worked: number; person: SchedulePerson }) {
  const target = contractHours(person.percent);
  if (target == null) return null;
  const over = person.max_hours != null && worked > person.max_hours;
  const color = over ? '#b91c1c' : worked + 0.001 < target ? '#b45309' : '#15803d';
  return (
    <div style={{ fontWeight: 400, fontSize: 9.5, color, marginTop: 1 }} title="Horas trabajadas (sin pausas) / contrato">
      {formatHours(worked)} / {formatHours(target)}
    </div>
  );
}

function Slot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Day({ label, style, onClick }: { label: string; style: CSSProperties; onClick?: () => void }) {
  return (
    <>
      <th colSpan={2} style={{ ...style, background: '#D6DCE4', ...(onClick ? { cursor: 'pointer' } : {}) }} onClick={onClick}>
        {label}
      </th>
      <th style={{ ...style, background: '#D6DCE4', width: 18 }}>P</th>
    </>
  );
}

function NoteCell({ label, text }: { label: string; text?: string }) {
  return (
    <>
      <td style={{ border: LINE, padding: '2px 4px', width: 58, fontSize: 9.5 }}>{label}:</td>
      <td style={{ border: LINE, padding: '2px 4px', textAlign: 'left', width: '30%' }}>{text ?? ''}</td>
    </>
  );
}
