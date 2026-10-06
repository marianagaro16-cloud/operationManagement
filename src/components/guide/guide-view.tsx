'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, BookOpen, Check, Clock, Pencil, Plus, ShieldCheck, Trash2, Truck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { daysWithPoints, isoWeekday, openCount, pointsOn } from '@/domain/guide/guide';
import {
  checkGuidePoint,
  removeGuidePoint,
  saveGuide,
  saveGuidePoint,
  saveSupplierCard,
  swapGuidePoints,
  type GuidePointInput,
} from '@/server/guide-actions';
import type { Guide, GuideAccess, GuideArticleBrief, GuideCheck, GuidePoint, SupplierCard } from '@/types/guide';

export type GuideTab = 'days' | 'articles' | 'suppliers' | 'customers';

/** A weekday's name in the viewer's language; 1 = Monday. */
function useWeekdayName() {
  const { locale } = useI18n();
  return (day: number, style: 'long' | 'short' = 'long') => {
    // 2024-01-01 was a Monday.
    const name = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, day)));
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
}

function useGuideError() {
  const { t } = useI18n();
  return (error: string) =>
    error === 'not_authorized' ? t('guide.errNotAuthorized')
      : error === 'not_today' ? t('guide.errNotToday')
        : error === 'title_required' ? t('guide.errTitle')
          : error === 'weekdays_required' ? t('guide.errWeekdays')
            : t('guide.errUnknown');
}

/**
 * Guides: what a person does day by day, for whoever covers them — with the
 * shared articles and how to order from each supplier.
 *
 * The guide's own person only reads it. Whoever covers them today ticks the
 * day's points off; that is the only checklist there is.
 */
export function GuideView({
  access,
  tab,
  guide,
  people,
  today,
  checks,
  articles,
  suppliers,
  reader,
  customers,
}: {
  /** Reads guides at all. Someone who only manages customers gets the Clientes tab alone. */
  reader: boolean;
  /** The Clientes tab, made by the page: the standing notes per customer. */
  customers: ReactNode;
  access: GuideAccess;
  tab: GuideTab;
  /** The guide being read; null when there is none to show. */
  guide: Guide | null;
  /** Accounts without a guide yet: whom an editor can start one for. */
  people: { id: string; name: string }[];
  today: string;
  /** How today's points of this guide stand. */
  checks: GuideCheck[];
  articles: GuideArticleBrief[];
  suppliers: SupplierCard[];
}) {
  const { t } = useI18n();
  const tabs: { key: GuideTab; label: string }[] = [
    ...(reader
      ? [
          { key: 'days' as const, label: t('guide.tabDays') },
          { key: 'articles' as const, label: t('guide.tabArticles') },
          { key: 'suppliers' as const, label: t('guide.tabSuppliers') },
        ]
      : []),
    { key: 'customers', label: t('guide.tabCustomers') },
  ];
  const person = guide ? `&person=${guide.profile_id}` : '';

  return (
    <>
      <PageHeader title={t('guide.title')} subtitle={t('guide.subtitle')} />
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/guide?tab=${item.key}${person}`}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === item.key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === 'days' && (
        <DaysTab access={access} guide={guide} people={people} today={today} checks={checks} articles={articles} suppliers={suppliers} />
      )}
      {tab === 'articles' && <ArticlesTab articles={articles} canEdit={access.edit} />}
      {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} canEdit={access.edit} />}
      {tab === 'customers' && customers}
    </>
  );
}

/* --------------------------------- the days -------------------------------- */

function DaysTab({
  access,
  guide,
  people,
  today,
  checks,
  articles,
  suppliers,
}: {
  access: GuideAccess;
  guide: Guide | null;
  people: { id: string; name: string }[];
  today: string;
  checks: GuideCheck[];
  articles: GuideArticleBrief[];
  suppliers: SupplierCard[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const weekdayName = useWeekdayName();
  const errorText = useGuideError();
  const todayWeekday = isoWeekday(today);
  const days = useMemo(() => daysWithPoints(guide?.points ?? []), [guide]);
  const [day, setDay] = useState(days.includes(todayWeekday) ? todayWeekday : 1);
  const [editing, setEditing] = useState(false);
  const [pointDialog, setPointDialog] = useState<{ point: GuidePoint | null } | null>(null);
  const [guideDialog, setGuideDialog] = useState<'new' | 'edit' | null>(null);
  const [removing, setRemoving] = useState<GuidePoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const entry = access.guides.find((g) => g.profile_id === guide?.profile_id);
  // Only whoever covers this person today ticks, and only today's list.
  const ticking = !!entry?.covering_today && day === todayWeekday && !editing;
  const dayPoints = guide ? pointsOn(guide.points, day) : [];
  const rules = dayPoints.filter((p) => p.kind === 'rule');
  const tasks = dayPoints.filter((p) => p.kind === 'task');
  const checkOf = new Map(checks.map((c) => [c.point_id, c]));
  const showChecks = day === todayWeekday && (ticking || checks.length > 0);
  const open = openCount(tasks, checks.map((c) => c.point_id));

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(errorText(res.error ?? 'unknown'));
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {access.guides.length > 1 ? (
          <Select
            aria-label={t('guide.whose')}
            value={guide?.profile_id ?? ''}
            onChange={(e) => router.push(`/guide?tab=days&person=${e.target.value}`)}
            className="h-9 w-auto py-0 text-[13px]"
          >
            {access.guides.map((g) => (
              <option key={g.profile_id} value={g.profile_id}>{t('guide.of', { name: g.name })}</option>
            ))}
          </Select>
        ) : (
          <h2 className="text-[15px] font-semibold">{entry ? t('guide.of', { name: entry.name }) : ''}</h2>
        )}
        {access.edit && (
          <div className="flex flex-wrap gap-2">
            {guide && (
              <Button size="sm" variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing(!editing)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {editing ? t('guide.doneEditing') : t('common.edit')}
              </Button>
            )}
            {people.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setGuideDialog('new')}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('guide.newGuide')}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <ErrorState message={error} />}

      {!guide ? (
        <EmptyState title={t('guide.none')} body={access.edit ? t('guide.noneBodyEditor') : t('guide.noneBody')} />
      ) : (
        <>
          {entry?.covering_today && (
            <Card className="flex items-start gap-2.5 border-accent/30 bg-accent/[0.04] p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p className="text-[13px]">{t('guide.coveringToday', { name: entry.name })}</p>
            </Card>
          )}
          {guide.intro && (
            <Card className="p-3 text-[13px] leading-relaxed">
              <NoteText text={guide.intro} />
            </Card>
          )}
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => setGuideDialog('edit')}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('guide.editIntro')}
            </Button>
          )}

          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                onClick={() => setDay(d)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13px]',
                  day === d ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                )}
              >
                {weekdayName(d)}
                {d === todayWeekday && <span className="ml-1 text-[11px]">· {t('common.today')}</span>}
              </button>
            ))}
          </div>

          {(guide.day_notes[String(day)] || showChecks) && (
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              {guide.day_notes[String(day)] && <span>{guide.day_notes[String(day)]}</span>}
              {showChecks && tasks.length > 0 && (
                <Badge tone={open === 0 ? 'done' : 'neutral'}>
                  {t('guide.progress', { done: tasks.length - open, total: tasks.length, date: formatDate(today, 'short') })}
                </Badge>
              )}
            </p>
          )}

          {rules.length > 0 && (
            <Card className="p-3">
              <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('guide.keepInMind')}</h3>
              <ul className="space-y-2.5">
                {rules.map((p) => (
                  <li key={p.id}>
                    <PointBody point={p} articles={articles} suppliers={suppliers} />
                    {editing && <PointTools point={p} list={rules} disabled={pending} onEdit={() => setPointDialog({ point: p })} onRemove={() => setRemoving(p)} onSwap={(a, b) => run(() => swapGuidePoints(a, b))} />}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {tasks.length === 0 && rules.length === 0 ? (
            <EmptyState title={t('guide.dayEmpty', { day: weekdayName(day) })} />
          ) : (
            tasks.length > 0 && (
              <Card className="overflow-hidden">
                <ol className="divide-y divide-border">
                  {tasks.map((p, i) => {
                    const check = checkOf.get(p.id);
                    return (
                      <li key={p.id} className={cn('flex gap-2.5 px-3 py-2.5', check && showChecks && 'bg-surface-2/40')}>
                        {ticking ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn('h-7 w-7 shrink-0 border border-border', check?.status === 'done' && 'border-done bg-done/10 text-done')}
                            aria-label={t(check?.status === 'done' ? 'guide.untick' : 'guide.tick')}
                            aria-pressed={check?.status === 'done'}
                            disabled={pending}
                            onClick={() => run(() => checkGuidePoint(p.id, check?.status === 'done' ? null : 'done', check?.comment ?? null))}
                          >
                            {check?.status === 'done' && <Check className="h-3.5 w-3.5" aria-hidden />}
                          </Button>
                        ) : (
                          <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] tabular text-subtle">{i + 1}.</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <PointBody point={p} articles={articles} suppliers={suppliers} struck={showChecks && !!check} />
                          {showChecks && check && (
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                              <Badge tone={check.status === 'done' ? 'done' : 'skipped'}>{t(check.status === 'done' ? 'guide.done' : 'guide.skipped')}</Badge>
                              {check.checked_by_name && <span>{check.checked_by_name}</span>}
                              {!ticking && check.comment && <span>· {check.comment}</span>}
                            </p>
                          )}
                          {ticking && (
                            <TickExtras
                              key={`${p.id}-${check?.status ?? ''}-${check?.comment ?? ''}`}
                              check={check}
                              disabled={pending}
                              onSkip={() => run(() => checkGuidePoint(p.id, check?.status === 'skipped' ? null : 'skipped', check?.comment ?? null))}
                              onComment={(comment) => check && run(() => checkGuidePoint(p.id, check.status, comment))}
                            />
                          )}
                          {editing && <PointTools point={p} list={tasks} disabled={pending} onEdit={() => setPointDialog({ point: p })} onRemove={() => setRemoving(p)} onSwap={(a, b) => run(() => swapGuidePoints(a, b))} />}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )
          )}

          {editing && (
            <Button size="sm" variant="primary" onClick={() => setPointDialog({ point: null })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('guide.addPoint')}
            </Button>
          )}
        </>
      )}

      {pointDialog && guide && (
        <PointDialog
          guideId={guide.profile_id}
          point={pointDialog.point}
          day={day}
          articles={articles}
          suppliers={suppliers}
          onClose={() => setPointDialog(null)}
        />
      )}
      {guideDialog && (
        <GuideDialog guide={guideDialog === 'edit' ? guide : null} people={people} onClose={() => setGuideDialog(null)} />
      )}
      {removing && (
        <ConfirmDialog
          open
          title={t('guide.removePoint')}
          message={removing.title}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            run(() => removeGuidePoint(id));
          }}
        />
      )}
    </div>
  );
}

/** A point's words: by when, what, the details, its how-to and its supplier. */
function PointBody({
  point,
  articles,
  suppliers,
  struck = false,
}: {
  point: GuidePoint;
  articles: GuideArticleBrief[];
  suppliers: SupplierCard[];
  struck?: boolean;
}) {
  const { t } = useI18n();
  const article = articles.find((a) => a.id === point.article_id);
  const supplier = suppliers.find((s) => s.supplier_id === point.supplier_id);
  return (
    <>
      <p className={cn('break-words text-[13.5px] leading-snug', struck && 'text-muted')}>
        {point.deadline && (
          <Badge tone="warn" className="mr-1.5 align-middle">
            <Clock className="h-3 w-3" aria-hidden />
            {t('guide.by', { time: point.deadline.slice(0, 5) })}
          </Badge>
        )}
        {point.title}
      </p>
      {point.body && (
        <div className="mt-1 text-[12.5px] leading-relaxed text-muted">
          <NoteText text={point.body} />
        </div>
      )}
      {article && (
        <Link href={`/guide/articles/${article.id}`} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
          <BookOpen className="h-3.5 w-3.5" aria-hidden />
          {article.title}
        </Link>
      )}
      {supplier && (
        <details className="mt-1 text-[12.5px]">
          <summary className="inline-flex cursor-pointer items-center gap-1 font-medium text-accent">
            <Truck className="h-3.5 w-3.5" aria-hidden />
            {t('guide.howToOrder', { name: supplier.name })}
          </summary>
          <SupplierDetails card={supplier} className="mt-1.5 rounded-lg border border-border p-2.5" />
        </details>
      )}
    </>
  );
}

/** Under a point being ticked: "not today", and a comment once it has a state. */
function TickExtras({
  check,
  disabled,
  onSkip,
  onComment,
}: {
  check: GuideCheck | undefined;
  disabled: boolean;
  onSkip: () => void;
  onComment: (comment: string | null) => void;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState(check?.comment ?? '');
  const changed = comment.trim() !== (check?.comment ?? '');
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={check?.status === 'skipped'}
        onClick={onSkip}
        className={cn('rounded-md border px-2 py-1 text-[12px]', check?.status === 'skipped' ? 'border-skipped bg-skipped/10 font-medium' : 'border-border text-muted hover:text-fg')}
      >
        {t('guide.notToday')}
      </button>
      {check && (
        <>
          <Input
            aria-label={t('guide.comment')}
            placeholder={t('guide.comment')}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => changed && onComment(comment.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-8 min-w-0 flex-1 py-0 text-[12.5px]"
          />
        </>
      )}
    </div>
  );
}

/** While editing: change, move within the day, take off. */
function PointTools({
  point,
  list,
  disabled,
  onEdit,
  onRemove,
  onSwap,
}: {
  point: GuidePoint;
  list: GuidePoint[];
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onSwap: (a: GuidePoint, b: GuidePoint) => void;
}) {
  const { t } = useI18n();
  const weekdayName = useWeekdayName();
  const index = list.findIndex((p) => p.id === point.id);
  const before = list[index - 1];
  const after = list[index + 1];
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[11.5px] text-subtle">{point.weekdays.map((d) => weekdayName(d, 'short')).join(' · ')}</span>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('common.edit')} disabled={disabled} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('guide.moveUp')} disabled={disabled || !before} onClick={() => before && onSwap(point, before)}>
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('guide.moveDown')} disabled={disabled || !after} onClick={() => after && onSwap(point, after)}>
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-late" aria-label={t('common.delete')} disabled={disabled} onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

function PointDialog({
  guideId,
  point,
  day,
  articles,
  suppliers,
  onClose,
}: {
  guideId: string;
  point: GuidePoint | null;
  /** The day being looked at: where a new point starts. */
  day: number;
  articles: GuideArticleBrief[];
  suppliers: SupplierCard[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const weekdayName = useWeekdayName();
  const errorText = useGuideError();
  const [form, setForm] = useState<GuidePointInput>({
    guide_id: guideId,
    kind: point?.kind ?? 'task',
    weekdays: point?.weekdays ?? [day],
    title: point?.title ?? '',
    body: point?.body ?? '',
    deadline: point?.deadline?.slice(0, 5) ?? null,
    article_id: point?.article_id ?? null,
    supplier_id: point?.supplier_id ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<GuidePointInput>) => setForm({ ...form, ...patch });

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveGuidePoint(form, point?.id);
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(point ? 'guide.editPoint' : 'guide.addPoint')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!form.title.trim() || form.weekdays.length === 0}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('guide.pointKind')} htmlFor="point-kind">
          <Select id="point-kind" value={form.kind} onChange={(e) => set({ kind: e.target.value as 'task' | 'rule' })}>
            <option value="task">{t('guide.kindTask')}</option>
            <option value="rule">{t('guide.kindRule')}</option>
          </Select>
        </Field>
        <Field label={t('guide.pointTitle')} required htmlFor="point-title">
          <NoteTextarea id="point-title" rows={2} value={form.title} maxLength={500} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label={t('guide.pointBody')} hint={t('guide.pointBodyHint')} htmlFor="point-body">
          <NoteTextarea id="point-body" rows={4} value={form.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <Field label={t('guide.pointDays')} required>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = form.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ weekdays: on ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d] })}
                  className={cn('rounded-full border px-2.5 py-1 text-[12.5px]', on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg')}
                >
                  {weekdayName(d, 'short')}
                </button>
              );
            })}
          </div>
        </Field>
        {form.kind === 'task' && (
          <Field label={t('guide.pointDeadline')} htmlFor="point-deadline">
            <Input id="point-deadline" type="time" value={form.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || null })} className="w-auto" />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('guide.pointArticle')} htmlFor="point-article">
            <Select id="point-article" value={form.article_id ?? ''} onChange={(e) => set({ article_id: e.target.value || null })}>
              <option value="">—</option>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('guide.pointSupplier')} htmlFor="point-supplier">
            <Select id="point-supplier" value={form.supplier_id ?? ''} onChange={(e) => set({ supplier_id: e.target.value || null })}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Starts a guide for someone, or changes its introduction and the note of each day. */
function GuideDialog({ guide, people, onClose }: { guide: Guide | null; people: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const weekdayName = useWeekdayName();
  const errorText = useGuideError();
  const [profileId, setProfileId] = useState(guide?.profile_id ?? people[0]?.id ?? '');
  const [intro, setIntro] = useState(guide?.intro ?? '');
  const [notes, setNotes] = useState<Record<string, string>>(guide?.day_notes ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveGuide({ profile_id: profileId, intro, day_notes: notes });
      if (!res.ok) return setError(errorText(res.error));
      router.push(`/guide?tab=days&person=${profileId}`);
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(guide ? 'guide.editIntro' : 'guide.newGuide')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!profileId}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        {!guide && (
          <Field label={t('guide.whose')} htmlFor="guide-person">
            <Select id="guide-person" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('guide.intro')} hint={t('guide.introHint')} htmlFor="guide-intro">
          <NoteTextarea id="guide-intro" rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </Field>
        <Field label={t('guide.dayNotes')} hint={t('guide.dayNotesHint')}>
          <div className="space-y-1.5">
            {[1, 2, 3, 4, 5].map((d) => (
              <div key={d} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[12.5px] text-muted">{weekdayName(d)}</span>
                <Input
                  aria-label={weekdayName(d)}
                  value={notes[String(d)] ?? ''}
                  maxLength={300}
                  onChange={(e) => setNotes({ ...notes, [String(d)]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------- articles ------------------------------- */

function ArticlesTab({ articles, canEdit }: { articles: GuideArticleBrief[]; canEdit: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? articles.filter((a) => `${a.title} ${a.topic}`.toLowerCase().includes(q)) : articles;
  const topics = [...new Set(shown.map((a) => a.topic))];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input aria-label={t('common.search')} placeholder={t('guide.searchArticles')} value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 max-w-xs py-0" />
        {canEdit && (
          <Link href="/guide/articles/new" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg hover:opacity-90">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('guide.newArticle')}
          </Link>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState title={t('guide.noArticles')} />
      ) : (
        topics.map((topic) => (
          <section key={topic}>
            <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{topic || t('guide.noTopic')}</h2>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {shown.filter((a) => a.topic === topic).map((a) => (
                  <li key={a.id}>
                    <Link href={`/guide/articles/${a.id}`} className="flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors hover:bg-surface-2/60">
                      <BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}

/* ------------------------------- suppliers ------------------------------- */

const hasInfo = (c: SupplierCard) => !!(c.how || c.contact || c.minimum || c.deadline || c.notes);

/** How to order from a supplier, as a short list. */
export function SupplierDetails({ card, className }: { card: SupplierCard; className?: string }) {
  const { t } = useI18n();
  const rows: [string, string | null][] = [
    [t('guide.supHow'), card.how],
    [t('guide.supContact'), card.contact],
    [t('guide.supMinimum'), card.minimum],
    [t('guide.supDeadline'), card.deadline],
    [t('guide.supNotes'), card.notes],
  ];
  if (!hasInfo(card)) return <p className={cn('text-[12.5px] text-muted', className)}>{t('guide.supEmpty')}</p>;
  return (
    <dl className={cn('space-y-1.5 text-[13px] leading-relaxed', className)}>
      {rows.filter(([, v]) => v).map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
          <dd><NoteText text={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

function SuppliersTab({ suppliers, canEdit }: { suppliers: SupplierCard[]; canEdit: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<SupplierCard | null>(null);
  const [all, setAll] = useState(false);
  const written = suppliers.filter(hasInfo);
  const shown = all ? suppliers : written;

  return (
    <div className="space-y-3">
      {canEdit && suppliers.length > written.length && (
        <Button size="sm" variant="secondary" onClick={() => setAll(!all)}>
          {t(all ? 'guide.supOnlyWritten' : 'guide.supShowAll', { count: suppliers.length - written.length })}
        </Button>
      )}
      {shown.length === 0 ? (
        <EmptyState title={t('guide.supNone')} />
      ) : (
        <ul className="space-y-2">
          {shown.map((card) => (
            <li key={card.supplier_id}>
              <Card className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[14px] font-semibold">{card.name}</h2>
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('common.edit')} onClick={() => setEditing(card)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
                <SupplierDetails card={card} className="mt-1.5" />
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <SupplierDialog card={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierDialog({ card, onClose }: { card: SupplierCard; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useGuideError();
  const [form, setForm] = useState({
    how: card.how ?? '',
    contact: card.contact ?? '',
    minimum: card.minimum ?? '',
    deadline: card.deadline ?? '',
    notes: card.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveSupplierCard({ supplier_id: card.supplier_id, ...form });
      if (!res.ok) return setError(errorText(res.error));
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('guide.howToOrder', { name: card.name })}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('guide.supHow')} hint={t('guide.supHowHint')} htmlFor="sup-how">
          <NoteTextarea id="sup-how" rows={4} value={form.how} onChange={(e) => setForm({ ...form, how: e.target.value })} />
        </Field>
        <Field label={t('guide.supContact')} htmlFor="sup-contact">
          <Input id="sup-contact" value={form.contact} maxLength={500} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('guide.supMinimum')} htmlFor="sup-min">
            <Input id="sup-min" value={form.minimum} maxLength={300} onChange={(e) => setForm({ ...form, minimum: e.target.value })} />
          </Field>
          <Field label={t('guide.supDeadline')} htmlFor="sup-deadline">
            <Input id="sup-deadline" value={form.deadline} maxLength={300} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </Field>
        </div>
        <Field label={t('guide.supNotes')} htmlFor="sup-notes">
          <NoteTextarea id="sup-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
