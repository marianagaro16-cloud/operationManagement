'use client';

import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { useI18n } from '@/i18n';
import { localizedName } from '@/lib/localized-content';
import { NoteText } from '@/components/ui/note';
import type { SummaryContent, SummaryNote } from '@/types/summaries';

const chf = (n: number) => `CHF ${new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(n)}`;

/**
 * A sales summary: highlights first, then the figures, the conversations by
 * customer, and the events. Plain enough to print or project.
 */
export function SummaryView({ content, from, to }: { content: SummaryContent; from: string; to: string }) {
  const { t, locale, formatDate } = useI18n();
  const kindName = (id: string) => {
    const k = content.kinds[id];
    return k ? localizedName(k, locale) : '—';
  };
  const done = content.activity.byKind.reduce((n, k) => n + k.done, 0);
  const note = (n: SummaryNote, withTarget: boolean) => (
    <li key={n.id} className="break-inside-avoid py-1.5">
      <p className="text-[12px] text-muted">
        {formatDate(n.date, 'short')} · {kindName(n.kind_id)}
        {withTarget && <> · <span className="font-medium text-fg">{n.target}</span>{n.target_kind === 'prospect' && ` (${t('summary.prospect')})`}</>}
        {n.author && ` · ${n.author}`}
        {n.starred && !withTarget && <Star className="ml-1 inline h-3 w-3 fill-warn text-warn" aria-label={t('summary.highlight')} />}
      </p>
      <NoteText text={n.body} className="text-[13px]" />
    </li>
  );

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-muted">
        {formatDate(from, 'medium')} – {formatDate(to, 'medium')}
      </p>

      <Block title={t('summary.highlights')} icon={<Star className="h-4 w-4 fill-warn text-warn" aria-hidden />}>
        {content.highlights.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('summary.noHighlights')}</p>
        ) : (
          <ul className="divide-y divide-border">{content.highlights.map((n) => note(n, true))}</ul>
        )}
      </Block>

      <Block title={t('summary.activity')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-muted">
                <th className="py-1 font-medium" />
                <th className="py-1 text-right font-medium">{t('summary.done')}</th>
                <th className="py-1 text-right font-medium">{t('summary.notDone')}</th>
                <th className="py-1 text-right font-medium">{t('summary.stillPlanned')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {content.activity.byKind.map((k) => (
                <tr key={k.kind_id}>
                  <td className="py-1">{kindName(k.kind_id)}</td>
                  <td className="py-1 text-right font-medium tabular">{k.done}</td>
                  <td className="py-1 text-right tabular text-muted">{k.not_done}</td>
                  <td className="py-1 text-right tabular text-muted">{k.planned}</td>
                </tr>
              ))}
              {content.activity.byKind.length === 0 && (
                <tr><td colSpan={4} className="py-1 text-[12.5px] text-muted">{t('summary.none')}</td></tr>
              )}
            </tbody>
          </table>
          <div className="space-y-1 text-[13px]">
            <p><span className="font-semibold tabular">{done}</span> {t('summary.activitiesDone')}</p>
            <Names label={t('summary.newProspects')} names={content.activity.prospects.created} />
            <Names label={t('summary.won')} names={content.activity.prospects.won} />
            <Names label={t('summary.lost')} names={content.activity.prospects.lost} />
          </div>
        </div>
      </Block>

      <Block title={t('summary.conversations')}>
        {content.conversations.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('summary.none')}</p>
        ) : (
          <div className="space-y-3">
            {content.conversations.map((c) => (
              <div key={`${c.target_kind}:${c.target}`} className="break-inside-avoid">
                <p className="text-[13.5px] font-semibold">
                  {c.target}
                  {c.target_kind === 'prospect' && <span className="ml-1.5 text-[12px] font-normal text-muted">{t('summary.prospect')}</span>}
                </p>
                <ul className="divide-y divide-border border-l-2 border-border pl-3">{c.notes.map((n) => note(n, false))}</ul>
              </div>
            ))}
          </div>
        )}
      </Block>

      <Block title={t('summary.events')}>
        {content.events.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t('summary.none')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {content.events.map((e, i) => (
              <li key={i} className="break-inside-avoid py-1.5 text-[13px]">
                <p className="font-medium">
                  {e.name}
                  <span className="ml-2 text-[12px] font-normal text-muted">
                    {formatDate(e.start_date, 'short')}{e.end_date !== e.start_date && ` – ${formatDate(e.end_date, 'short')}`}
                    {e.place && ` · ${e.place}`}
                  </span>
                </p>
                <p className="text-[12.5px] text-muted">
                  {e.rating !== null && `${'★'.repeat(e.rating)}${'☆'.repeat(5 - e.rating)} · `}
                  {t('summary.contacts', { count: e.contacts })}
                  {(e.planned_cost > 0 || e.actual_cost > 0) && ` · ${t('summary.costs', { planned: chf(e.planned_cost), actual: chf(e.actual_cost) })}`}
                </p>
                {e.summary && <NoteText text={e.summary} className="text-[13px]" />}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

function Block({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-3.5 print:border-0 print:p-0">
      <h2 className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Names({ label, names }: { label: string; names: string[] }) {
  return (
    <p>
      <span className="font-semibold tabular">{names.length}</span> {label}
      {names.length > 0 && <span className="text-muted">: {names.join(', ')}</span>}
    </p>
  );
}
