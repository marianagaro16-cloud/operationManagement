'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Flame, Meh, Pencil, Star, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { hasResults } from '@/lib/events';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { productLabel, type Product } from '@/types/orders';
import { saveResults } from '@/server/event-actions';
import { saveMyEventReview } from '@/server/event-assignee-actions';
import type {
  EventContact,
  EventCost,
  EventFile,
  EventLesson,
  EventMaterial,
  EventProduct,
  EventProductFeedback,
  EventReturn,
  EventRow,
  EventStaffReview,
} from '@/types/events';
import { chf, useEventLabels, useEventsLimited } from './event-parts';

/*
 * How it went (fuller review, decided 2026-11-02): went well / wrong / next
 * time, how each product was received, place and public, organisation; a
 * closing check of what the event already recorded; and the short views of
 * whoever worked a shift.
 */

/** What the event already recorded, for the closing check and the summary. */
export interface ReviewData {
  products: EventProduct[];
  returns: EventReturn[];
  feedback: EventProductFeedback[];
  costs: EventCost[];
  contacts: EventContact[];
  files: EventFile[];
  materials: EventMaterial[];
  catalog: Product[];
  staffReviews: EventStaffReview[];
  staffMissing: string[];
}

const num = (n: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 }).format(n);

function Section({ id, title, action, children }: { id?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A part of the review, in the card and in the form. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="border-b border-border pb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t('event.ratingOf', { rating: value })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('h-3.5 w-3.5', n <= value ? 'fill-warn text-warn' : 'text-subtle')} aria-hidden />
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={t('event.ratingOf', { rating: n })}
          aria-pressed={value === n}
          onClick={() => onChange(value === n ? null : n)}
          className="rounded p-0.5 hover:bg-surface-2"
        >
          <Star className={cn('h-6 w-6', value !== null && n <= value ? 'fill-warn text-warn' : 'text-subtle')} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ closing facts ----------------------------- */

function closingFacts(event: EventRow, d: ReviewData) {
  const back = new Map(d.returns.map((r) => [r.product_id, r]));
  const lines = d.products.map((l) => {
    const taken = l.prepared ?? l.quantity;
    const r = back.get(l.product_id);
    return { product_id: l.product_id, taken, used: r ? Math.max(taken - r.back_quantity - r.discarded_quantity, 0) : null };
  });
  const anyActual = d.costs.some((c) => c.actual_amount !== null);
  const planned = d.costs.reduce((n, c) => n + (c.planned_amount ?? 0), 0);
  const actual = anyActual ? d.costs.reduce((n, c) => n + (c.actual_amount ?? 0), 0) : null;
  const contacts = d.contacts.length || event.result_contacts || 0;
  return {
    lines,
    returnsOpen: lines.filter((l) => l.used === null).length,
    costsOpen: d.costs.filter((c) => c.actual_amount === null).length,
    planned,
    actual,
    perContact: actual !== null && contacts > 0 ? actual / contacts : null,
    materialsOpen: d.materials.filter((m) => !m.came_back).length,
  };
}

/** Used per product, the budget, the cost per contact. */
function ClosingSummary({ event, data }: { event: EventRow; data: ReviewData }) {
  const { t } = useI18n();
  const limited = useEventsLimited();
  const f = closingFacts(event, data);
  const byId = new Map(data.catalog.map((p) => [p.id, p]));
  if (f.lines.length === 0 && (limited || data.costs.length === 0)) return null;
  return (
    <div className="space-y-1.5 text-[13px]">
      {f.lines.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11.5px] text-muted">
              <th className="py-0.5 font-medium">{t('event.product')}</th>
              <th className="py-0.5 pl-2 text-right font-medium">{t('event.taken')}</th>
              <th className="py-0.5 pl-2 text-right font-medium">{t('event.used')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {f.lines.map((l) => {
              const p = byId.get(l.product_id);
              return (
                <tr key={l.product_id}>
                  <td className="py-1 pr-2">{p ? productLabel(p) : '—'}</td>
                  <td className="py-1 pl-2 text-right tabular">{num(l.taken)}</td>
                  <td className="py-1 pl-2 text-right font-medium tabular">{l.used === null ? <span className="text-muted">—</span> : num(l.used)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!limited && data.costs.length > 0 && (
        <p>
          <span className="text-muted">{t('event.budget')}:</span>{' '}
          <span className="tabular">{t('event.budgetVs', { actual: f.actual === null ? '—' : chf(f.actual), planned: chf(f.planned) })}</span>
        </p>
      )}
      {!limited && f.perContact !== null && (
        <p>
          <span className="text-muted">{t('event.costPerContact')}:</span> <span className="font-medium tabular">{chf(f.perContact)}</span>
        </p>
      )}
    </div>
  );
}

/** What the event recorded and what is missing, each a link to fill it. Never blocks. */
function ClosingCheck({ event, data, onGo }: { event: EventRow; data: ReviewData; onGo: (anchor: string) => void }) {
  const { t } = useI18n();
  const limited = useEventsLimited();
  const f = closingFacts(event, data);
  const rows: { ok: boolean; text: string; anchor: string }[] = [];
  if (data.products.length > 0) {
    rows.push({ ok: f.returnsOpen === 0, text: f.returnsOpen === 0 ? t('event.checkReturns') : t('event.checkReturnsOpen', { count: f.returnsOpen }), anchor: 'products' });
  }
  if (!limited) {
    rows.push(
      data.costs.length === 0
        ? { ok: false, text: t('event.checkCostsNone'), anchor: 'budget' }
        : { ok: f.costsOpen === 0, text: f.costsOpen === 0 ? t('event.checkCosts') : t('event.checkCostsOpen', { count: f.costsOpen }), anchor: 'budget' },
    );
    rows.push({
      ok: data.contacts.length > 0,
      text: data.contacts.length > 0 ? t('event.checkContacts', { count: data.contacts.length }) : t('event.checkContactsNone'),
      anchor: 'contacts',
    });
  }
  rows.push({
    ok: data.files.length > 0,
    text: data.files.length > 0 ? t('event.checkFiles', { count: data.files.length }) : t('event.checkFilesNone'),
    anchor: 'files',
  });
  if (data.materials.length > 0) {
    rows.push({ ok: f.materialsOpen === 0, text: f.materialsOpen === 0 ? t('event.checkMaterials') : t('event.checkMaterialsOpen', { count: f.materialsOpen }), anchor: 'materials' });
  }

  return (
    <Part title={t('event.closingCheck')}>
      <p className="text-[12px] text-muted">{t('event.closingCheckHint')}</p>
      <ul className="divide-y divide-border text-[13px]">
        {rows.map((r) => (
          <li key={r.anchor} className="flex items-center gap-2 py-1">
            {r.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-done" aria-hidden />
              : <AlertCircle className="h-4 w-4 shrink-0 text-warn" aria-hidden />}
            <span className="min-w-0 flex-1">{r.text}</span>
            {!r.ok && (
              <Button size="sm" variant="ghost" onClick={() => onGo(r.anchor)}>{t('event.checkGo')}</Button>
            )}
          </li>
        ))}
      </ul>
      <ClosingSummary event={event} data={data} />
    </Part>
  );
}

/* ------------------------------- the card ------------------------------- */

function useReviewLabels() {
  const { t } = useI18n();
  return {
    repeat: { yes: t('event.repeatYes'), no: t('event.repeatNo'), maybe: t('event.repeatMaybe') },
    stand: { good: t('event.standGood'), average: t('event.standAverage'), bad: t('event.standBad') },
    staffing: { enough: t('event.staffingEnough'), short: t('event.staffingShort'), too_many: t('event.staffingTooMany') },
    reaction: { liked: t('event.reactionLiked'), neutral: t('event.reactionNeutral'), disliked: t('event.reactionDisliked') },
  };
}

const REACTION_TONE = { liked: 'done', neutral: 'neutral', disliked: 'late' } as const;

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[12px] text-muted sm:pt-px">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export function ResultsCard({ event, data }: { event: EventRow; data: ReviewData }) {
  const { t } = useI18n();
  const labels = useReviewLabels();
  const [editing, setEditing] = useState(false);
  const readOnly = useEventsLimited();
  const byId = new Map(data.catalog.map((p) => [p.id, p]));
  const figures: [string, number | null][] = [
    [t('event.visitors'), event.result_visitors],
    [t('event.samplesGiven'), event.result_samples],
    [t('event.contactsMade'), event.result_contacts],
  ];
  const texts: [string, string | null][] = [
    [t('event.wentWell'), event.result_went_well],
    [t('event.wentWrong'), event.result_went_wrong],
    [t('event.nextTime'), event.result_next_time],
    [t('event.earlierSummary'), event.result_summary],
  ];
  const place: [string, ReactNode][] = (
    [
      [t('event.stand'), event.result_stand && labels.stand[event.result_stand]],
      [t('event.public'), event.result_public],
      [t('event.busiest'), event.result_busiest],
      [t('event.weather'), event.result_weather],
      [t('event.competitors'), event.result_competitors && <NoteText text={event.result_competitors} />],
    ] as [string, ReactNode][]
  ).filter(([, v]) => v);
  const organisation: [string, ReactNode][] = (
    [
      [t('event.organiserRating'), event.result_organiser_rating !== null && <Stars value={event.result_organiser_rating} />],
      [t('event.staffing'), event.result_staffing && labels.staffing[event.result_staffing]],
      [t('event.setup'), event.result_setup && <NoteText text={event.result_setup} />],
      [t('event.materialsReview'), event.result_materials && <NoteText text={event.result_materials} />],
    ] as [string, ReactNode][]
  ).filter(([, v]) => v);
  const feedback = data.feedback
    .map((f) => ({ ...f, order: data.products.findIndex((p) => p.product_id === f.product_id) }))
    .sort((a, b) => a.order - b.order);

  return (
    <Section
      id="results"
      title={t('event.results')}
      action={
        !readOnly && event.stage !== 'cancelled' && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('common.edit')}
          </Button>
        )
      }
    >
      {!hasResults(event) ? (
        <p className="text-[12.5px] text-muted">{t('event.resultsNone')}</p>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {event.result_rating !== null && <Stars value={event.result_rating} />}
            {event.result_repeat && (
              <span>
                <span className="text-muted">{t('event.repeat')}:</span> <span className="font-medium">{labels.repeat[event.result_repeat]}</span>
              </span>
            )}
            {figures
              .filter(([, v]) => v !== null)
              .map(([label, v]) => (
                <span key={label}>
                  <span className="text-muted">{label}:</span> <span className="font-medium tabular">{v}</span>
                </span>
              ))}
          </div>

          {texts.some(([, v]) => v) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {texts.filter(([, v]) => v).map(([label, v]) => (
                <div key={label}>
                  <p className="text-[12px] font-semibold text-muted">{label}</p>
                  <NoteText text={v!} />
                </div>
              ))}
            </div>
          )}

          {feedback.length > 0 && (
            <Part title={t('event.productsReception')}>
              <ul className="divide-y divide-border">
                {feedback.map((f) => {
                  const p = byId.get(f.product_id);
                  return (
                    <li key={f.product_id} className="py-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{p ? productLabel(p) : '—'}</span>
                        {f.reaction && <Badge tone={REACTION_TONE[f.reaction]}>{labels.reaction[f.reaction]}</Badge>}
                        {f.most_asked && (
                          <Badge tone="warn">
                            <Flame className="mr-0.5 h-3 w-3" aria-hidden />
                            {t('event.mostAsked')}
                          </Badge>
                        )}
                      </span>
                      {f.comment && <span className="block text-[12.5px] text-muted">{f.comment}</span>}
                    </li>
                  );
                })}
              </ul>
            </Part>
          )}

          {(place.length > 0 || organisation.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {place.length > 0 && (
                <Part title={t('event.placePublic')}>
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                    {place.map(([label, v]) => <Line key={label} label={label}>{v}</Line>)}
                  </dl>
                </Part>
              )}
              {organisation.length > 0 && (
                <Part title={t('event.organisation')}>
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                    {organisation.map(([label, v]) => <Line key={label} label={label}>{v}</Line>)}
                  </dl>
                </Part>
              )}
            </div>
          )}

          {event.stage === 'done' && (
            <Part title={t('event.summary')}>
              <ClosingSummary event={event} data={data} />
            </Part>
          )}
        </div>
      )}

      {event.stage === 'done' && <StaffViews reviews={data.staffReviews} missing={data.staffMissing} />}
      {editing && <ResultsDialog event={event} data={data} markDone={false} onClose={() => setEditing(false)} />}
    </Section>
  );
}

/** The short views of whoever worked a shift, with their names; and who has not given one. */
function StaffViews({ reviews, missing }: { reviews: EventStaffReview[]; missing: string[] }) {
  const { t } = useI18n();
  if (reviews.length === 0 && missing.length === 0) return null;
  return (
    <div className="mt-4 text-[13px]">
      <Part title={`${t('event.staffViews')}${reviews.length ? ` · ${reviews.length}` : ''}`}>
        {reviews.length > 0 && (
          <ul className="divide-y divide-border">
            {[...reviews].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
              <li key={r.profile_id} className="py-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.rating !== null && <Stars value={r.rating} />}
                </span>
                {r.went_well && <p><span className="text-muted">{t('event.myWentWell')}:</span> {r.went_well}</p>}
                {r.to_improve && <p><span className="text-muted">{t('event.toImprove')}:</span> {r.to_improve}</p>}
              </li>
            ))}
          </ul>
        )}
        {missing.length > 0 && <p className="text-[12px] text-muted">{t('event.staffViewsMissing', { names: missing.join(', ') })}</p>}
      </Part>
    </div>
  );
}

/* -------------------------------- the form ------------------------------- */

type Reaction = EventProductFeedback['reaction'];

/** How it went. From "Mark as done" it also marks the event done; anything can be left for later. */
export function ResultsDialog({ event, data, markDone, onClose }: { event: EventRow; data: ReviewData; markDone: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const names = useReviewLabels();
  const byId = new Map(data.catalog.map((p) => [p.id, p]));
  const [summary, setSummary] = useState(event.result_summary ?? '');
  const [rating, setRating] = useState<number | null>(event.result_rating);
  const [repeat, setRepeat] = useState(event.result_repeat ?? '');
  const [visitors, setVisitors] = useState(event.result_visitors?.toString() ?? '');
  const [samples, setSamples] = useState(event.result_samples?.toString() ?? '');
  const [contacts, setContacts] = useState(event.result_contacts?.toString() ?? '');
  const [wentWell, setWentWell] = useState(event.result_went_well ?? '');
  const [wentWrong, setWentWrong] = useState(event.result_went_wrong ?? '');
  const [nextTime, setNextTime] = useState(event.result_next_time ?? '');
  const [stand, setStand] = useState(event.result_stand ?? '');
  const [audience, setAudience] = useState(event.result_public ?? '');
  const [busiest, setBusiest] = useState(event.result_busiest ?? '');
  const [weather, setWeather] = useState(event.result_weather ?? '');
  const [competitors, setCompetitors] = useState(event.result_competitors ?? '');
  const [organiser, setOrganiser] = useState<number | null>(event.result_organiser_rating);
  const [setup, setSetup] = useState(event.result_setup ?? '');
  const [staffing, setStaffing] = useState(event.result_staffing ?? '');
  const [materials, setMaterials] = useState(event.result_materials ?? '');
  const [products, setProducts] = useState(() => {
    const saved = new Map(data.feedback.map((f) => [f.product_id, f]));
    return data.products.map((p) => ({
      product_id: p.product_id,
      reaction: saved.get(p.product_id)?.reaction ?? null,
      most_asked: saved.get(p.product_id)?.most_asked ?? false,
      comment: saved.get(p.product_id)?.comment ?? '',
    }));
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const whole = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = [visitors, samples, contacts].every((v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0));
  const setProduct = (id: string, patch: Partial<(typeof products)[number]>) =>
    setProducts((list) => list.map((p) => (p.product_id === id ? { ...p, ...patch } : p)));

  function go(anchor: string) {
    onClose();
    // Once the dialog has closed.
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function submit() {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const res = await saveResults(
        event.id,
        {
          result_summary: summary,
          result_rating: rating,
          result_repeat: (repeat || null) as 'yes' | 'no' | 'maybe' | null,
          result_visitors: whole(visitors),
          result_samples: whole(samples),
          result_contacts: whole(contacts),
          result_went_well: wentWell,
          result_went_wrong: wentWrong,
          result_next_time: nextTime,
          result_stand: (stand || null) as 'good' | 'average' | 'bad' | null,
          result_public: audience,
          result_busiest: busiest,
          result_weather: weather,
          result_competitors: competitors,
          result_organiser_rating: organiser,
          result_setup: setup,
          result_staffing: (staffing || null) as 'enough' | 'short' | 'too_many' | null,
          result_materials: materials,
        },
        markDone,
        products,
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      router.refresh();
    });
  }

  const reactionButton = (id: string, current: Reaction, value: NonNullable<Reaction>, Icon: typeof ThumbsUp, on: string) => (
    <button
      type="button"
      aria-label={names.reaction[value]}
      title={names.reaction[value]}
      aria-pressed={current === value}
      onClick={() => setProduct(id, { reaction: current === value ? null : value })}
      className={cn('rounded-md border p-1.5', current === value ? on : 'border-border text-muted hover:bg-surface-2')}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={markDone ? t('event.markDone') : t('event.results')}
      description={markDone ? t('event.markDoneResultsHint') : undefined}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant={markDone ? 'success' : 'primary'} onClick={submit} loading={pending} disabled={!valid}>
            {markDone ? t('event.markDone') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <ErrorState message={error} />}

        {markDone && <ClosingCheck event={event} data={data} onGo={go} />}

        <Part title={t('event.reviewGeneral')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('event.rating')}>
              <StarPicker value={rating} onChange={setRating} />
            </Field>
            <Field label={t('event.repeat')} htmlFor="event-result-repeat">
              <Select id="event-result-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                <option value="">—</option>
                <option value="yes">{t('event.repeatYes')}</option>
                <option value="maybe">{t('event.repeatMaybe')}</option>
                <option value="no">{t('event.repeatNo')}</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('event.visitors')} htmlFor="event-result-visitors">
              <Input id="event-result-visitors" type="number" inputMode="numeric" min={0} value={visitors} onChange={(e) => setVisitors(e.target.value)} />
            </Field>
            <Field label={t('event.samplesGiven')} htmlFor="event-result-samples">
              <Input id="event-result-samples" type="number" inputMode="numeric" min={0} value={samples} onChange={(e) => setSamples(e.target.value)} />
            </Field>
            <Field label={t('event.contactsMade')} htmlFor="event-result-contacts">
              <Input id="event-result-contacts" type="number" inputMode="numeric" min={0} value={contacts} onChange={(e) => setContacts(e.target.value)} />
            </Field>
          </div>
          <Field label={t('event.wentWell')} htmlFor="event-result-well">
            <NoteTextarea id="event-result-well" rows={3} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
          </Field>
          <Field label={t('event.wentWrong')} htmlFor="event-result-wrong">
            <NoteTextarea id="event-result-wrong" rows={3} value={wentWrong} onChange={(e) => setWentWrong(e.target.value)} />
          </Field>
          <Field label={t('event.nextTime')} hint={t('event.nextTimeHint')} htmlFor="event-result-next">
            <NoteTextarea id="event-result-next" rows={3} value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
          </Field>
          {/* The single summary of before: kept for the events that have one. */}
          {event.result_summary && (
            <Field label={t('event.earlierSummary')} htmlFor="event-result-summary">
              <NoteTextarea id="event-result-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          )}
        </Part>

        <Part title={t('event.productsReception')}>
          {products.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('event.productsReceptionNone')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {products.map((p) => {
                const product = byId.get(p.product_id);
                return (
                  <li key={p.product_id} className="space-y-1.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium">{product ? productLabel(product) : '—'}</span>
                      <span className="flex items-center gap-1">
                        {reactionButton(p.product_id, p.reaction, 'liked', ThumbsUp, 'border-done bg-done/10 text-done')}
                        {reactionButton(p.product_id, p.reaction, 'neutral', Meh, 'border-muted bg-surface-2 text-fg')}
                        {reactionButton(p.product_id, p.reaction, 'disliked', ThumbsDown, 'border-late bg-late/10 text-late')}
                        <button
                          type="button"
                          aria-pressed={p.most_asked}
                          title={t('event.mostAsked')}
                          onClick={() => setProduct(p.product_id, { most_asked: !p.most_asked })}
                          className={cn(
                            'ml-1 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]',
                            p.most_asked ? 'border-warn bg-warn/10 text-warn' : 'border-border text-muted hover:bg-surface-2',
                          )}
                        >
                          <Flame className="h-3.5 w-3.5" aria-hidden />
                          {t('event.mostAsked')}
                        </button>
                      </span>
                    </div>
                    <Input
                      aria-label={t('event.productComment')}
                      placeholder={t('event.productComment')}
                      value={p.comment}
                      onChange={(e) => setProduct(p.product_id, { comment: e.target.value })}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Part>

        <Part title={t('event.placePublic')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('event.stand')} htmlFor="event-result-stand">
              <Select id="event-result-stand" value={stand} onChange={(e) => setStand(e.target.value as typeof stand)}>
                <option value="">—</option>
                <option value="good">{t('event.standGood')}</option>
                <option value="average">{t('event.standAverage')}</option>
                <option value="bad">{t('event.standBad')}</option>
              </Select>
            </Field>
            <Field label={t('event.public')} htmlFor="event-result-public">
              <Input id="event-result-public" placeholder={t('event.publicHint')} value={audience} onChange={(e) => setAudience(e.target.value)} />
            </Field>
            <Field label={t('event.busiest')} htmlFor="event-result-busiest">
              <Input id="event-result-busiest" placeholder={t('event.busiestHint')} value={busiest} onChange={(e) => setBusiest(e.target.value)} />
            </Field>
            <Field label={t('event.weather')} htmlFor="event-result-weather">
              <Input id="event-result-weather" value={weather} onChange={(e) => setWeather(e.target.value)} />
            </Field>
          </div>
          <Field label={t('event.competitors')} htmlFor="event-result-competitors">
            <NoteTextarea id="event-result-competitors" rows={2} value={competitors} onChange={(e) => setCompetitors(e.target.value)} />
          </Field>
        </Part>

        <Part title={t('event.organisation')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('event.organiserRating')}>
              <StarPicker value={organiser} onChange={setOrganiser} />
            </Field>
            <Field label={t('event.staffing')} htmlFor="event-result-staffing">
              <Select id="event-result-staffing" value={staffing} onChange={(e) => setStaffing(e.target.value as typeof staffing)}>
                <option value="">—</option>
                <option value="enough">{t('event.staffingEnough')}</option>
                <option value="short">{t('event.staffingShort')}</option>
                <option value="too_many">{t('event.staffingTooMany')}</option>
              </Select>
            </Field>
          </div>
          <Field label={t('event.setup')} htmlFor="event-result-setup">
            <NoteTextarea id="event-result-setup" rows={2} value={setup} onChange={(e) => setSetup(e.target.value)} />
          </Field>
          <Field label={t('event.materialsReview')} htmlFor="event-result-materials">
            <NoteTextarea id="event-result-materials" rows={2} value={materials} onChange={(e) => setMaterials(e.target.value)} />
          </Field>
        </Part>
      </div>
    </Dialog>
  );
}

/* ---------------------------- the staff's view ---------------------------- */

/** Their own short view, for whoever worked a shift on a done event. */
export function MyReviewCard({
  eventId,
  review,
}: {
  eventId: string;
  review: { rating: number | null; went_well: string | null; to_improve: string | null } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useEventLabels();
  const [editing, setEditing] = useState(!review);
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [wentWell, setWentWell] = useState(review?.went_well ?? '');
  const [toImprove, setToImprove] = useState(review?.to_improve ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = rating !== null || !!wentWell.trim() || !!toImprove.trim();

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await saveMyEventReview(eventId, { rating, went_well: wentWell, to_improve: toImprove });
      if (!res.ok) return setError(labels.error(res.error));
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Section
      id="my-review"
      title={t('event.myReview')}
      action={
        review && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('common.edit')}
          </Button>
        )
      }
    >
      {error && <div className="mb-2"><ErrorState message={error} /></div>}
      {!editing && review ? (
        <div className="space-y-1 text-[13px]">
          {review.rating !== null && <Stars value={review.rating} />}
          {review.went_well && <p><span className="text-muted">{t('event.myWentWell')}:</span> {review.went_well}</p>}
          {review.to_improve && <p><span className="text-muted">{t('event.toImprove')}:</span> {review.to_improve}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">{t('event.myReviewHint')}</p>
          <StarPicker value={rating} onChange={setRating} />
          <Field label={t('event.myWentWell')} htmlFor="event-my-well">
            <NoteTextarea id="event-my-well" rows={2} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
          </Field>
          <Field label={t('event.toImprove')} htmlFor="event-my-improve">
            <NoteTextarea id="event-my-improve" rows={2} value={toImprove} onChange={(e) => setToImprove(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            {review && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>{t('common.cancel')}</Button>
            )}
            <Button variant="primary" size="sm" onClick={submit} loading={pending} disabled={!ready}>{t('common.save')}</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------ for next time ----------------------------- */

/** While planning: what earlier events of the same kind said to do next time. */
export function LessonsCard({ lessons }: { lessons: EventLesson[] }) {
  const { t, formatDate } = useI18n();
  if (lessons.length === 0) return null;
  return (
    <Section title={t('event.lessons')}>
      <ul className="divide-y divide-border text-[13px]">
        {lessons.map((l) => (
          <li key={l.event_id} className="py-1.5">
            <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <Link href={`/events/${l.event_id}#results`} className="font-medium text-fg hover:text-accent">{l.name}</Link>
              <span className="tabular">{formatDate(l.start_date, 'shortYear')}</span>
              {l.same_name && <Badge tone="accent">{t('event.lessonsSameEvent')}</Badge>}
            </p>
            <NoteText text={l.next_time} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
