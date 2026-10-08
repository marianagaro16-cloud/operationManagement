'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileCheck2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Badge, Card, EmptyState, Input, Select } from '@/components/ui/primitives';
import { actaLate } from '@/domain/sales/acta';
import type { ActivityKind } from '@/types/sales';
import type { ActaRow, ActaTopic } from '@/types/sales-acta';
import { KindBadge, useKinds } from './activity-kind';
import { FollowUpBadge, useTopicName } from './acta-view';

/** One Acta in a list: when, with whom, what about, and where it stands. Opens its page. */
function ActaLine({
  row,
  kinds,
  topics,
  today,
  withTarget,
}: {
  row: ActaRow;
  kinds: ActivityKind[];
  topics: ActaTopic[];
  today: string;
  /** Name who it was with: everywhere but in their own file. */
  withTarget: boolean;
}) {
  const { t, formatDate } = useI18n();
  const k = useKinds(kinds);
  const topicName = useTopicName(topics);
  const about = row.points.map((p) => p.title || topicName(p.topic_id)).filter(Boolean).join(' · ');
  return (
    <Link href={`/sales/actas/${row.activity_id}`} className="block px-3 py-2.5 hover:bg-surface-2">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <KindBadge kind={k.get(row.kind_id)} />
        <span className="tabular font-medium text-fg">{formatDate(row.meeting_date, 'medium')}</span>
        {withTarget && (
          <span className="text-[13.5px] font-medium text-fg">
            {row.target.name}
            {row.target.kind === 'prospect' && <span className="ml-1.5 text-[12px] font-normal text-muted">{t('sales.visitProspect')}</span>}
          </span>
        )}
        <span>{row.salesperson_name}</span>
        {row.state === 'pending' && <Badge tone={actaLate(row.meeting_date, today) ? 'late' : 'warn'}>{t('acta.pending')}</Badge>}
        {row.state === 'draft' && <Badge tone="warn">{t('meetingRecord.draft')}</Badge>}
        <FollowUpBadge followUp={row.followUp} />
      </span>
      {about && <span className="mt-0.5 block break-words text-[13px]">{about}</span>}
      {row.agreements.total > 0 && (
        <span className="mt-0.5 block text-[12px] text-muted">{t('acta.agreementsMet', { met: row.agreements.met, total: row.agreements.total })}</span>
      )}
    </Link>
  );
}

/** The Actas in a customer's or a prospect's file; nothing while there are none. */
export function TargetActas({ rows, kinds, topics, today }: { rows: ActaRow[]; kinds: ActivityKind[]; topics: ActaTopic[]; today: string }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <section className="mb-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold">
        <FileCheck2 className="h-4 w-4 text-accent" aria-hidden />
        {t('acta.many')}
        <span className="text-[12px] font-normal tabular text-muted">{rows.length}</span>
      </h2>
      <Card className="divide-y divide-border overflow-hidden">
        {rows.map((row) => <ActaLine key={row.activity_id} row={row} kinds={kinds} topics={topics} today={today} withTarget={false} />)}
      </Card>
    </section>
  );
}

/**
 * Every Acta: what is still to write first, then the follow-ups due, then
 * all of them — found by who it was with or by topic.
 */
export function ActaList({ rows, kinds, topics, today }: { rows: ActaRow[]; kinds: ActivityKind[]; topics: ActaTopic[]; today: string }) {
  const { t } = useI18n();
  const topicName = useTopicName(topics);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');

  const toWrite = rows.filter((r) => r.state !== 'registered').sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const due = rows
    .filter((r) => r.followUp.dueOn && r.followUp.dueOn <= today)
    .sort((a, b) => a.followUp.dueOn!.localeCompare(b.followUp.dueOn!));
  // Topics that some Acta names: no use offering the others.
  const used = useMemo(() => new Set(rows.flatMap((r) => r.points.map((p) => p.topic_id))), [rows]);
  const q = query.trim().toLowerCase();
  const registered = rows.filter(
    (r) =>
      r.state === 'registered' &&
      (!topic || r.points.some((p) => p.topic_id === topic)) &&
      (!q || `${r.target.name} ${r.salesperson_name} ${r.points.map((p) => p.title).join(' ')}`.toLowerCase().includes(q)),
  );

  if (rows.length === 0) return <EmptyState title={t('acta.empty')} body={t('acta.emptyBody')} />;

  const group = (title: string, list: ActaRow[]) =>
    list.length > 0 && (
      <section>
        <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
          {title} <span className="tabular">{list.length}</span>
        </h2>
        <Card className="divide-y divide-border overflow-hidden">
          {list.map((row) => <ActaLine key={row.activity_id} row={row} kinds={kinds} topics={topics} today={today} withTarget />)}
        </Card>
      </section>
    );

  return (
    <div className="space-y-4">
      {group(t('acta.toWrite'), toWrite)}
      {group(t('acta.followUpsDue'), due)}

      <section>
        <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('acta.registeredOnes')}</h2>
        <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_16rem]">
          <Input aria-label={t('sales.search')} placeholder={t('sales.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select aria-label={t('acta.topic')} value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">{t('acta.allTopics')}</option>
            {topics.filter((entry) => used.has(entry.id)).map((entry) => (
              <option key={entry.id} value={entry.id}>{topicName(entry.id)}</option>
            ))}
          </Select>
        </div>
        {registered.length === 0 ? (
          <p className="px-0.5 text-[12.5px] text-muted">{t('acta.noneFound')}</p>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {registered.map((row) => <ActaLine key={row.activity_id} row={row} kinds={kinds} topics={topics} today={today} withTarget />)}
          </Card>
        )}
      </section>
    </div>
  );
}
