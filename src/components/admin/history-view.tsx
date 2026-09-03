'use client';

import { useI18n } from '@/i18n';
import { localizedTitle } from '@/lib/localized-content';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import type { OccurrenceWithTask } from '@/types/database';

/**
 * The operational record. Deactivating a task must never remove rows from
 * here, so the query behind it does not filter on `is_active`.
 */
export function HistoryView({
  occurrences,
  names,
}: {
  occurrences: OccurrenceWithTask[];
  names: Record<string, string>;
}) {
  const { t, locale, formatDate } = useI18n();

  return (
    <>
      <PageHeader title={t('admin.historyTitle')} subtitle={t('admin.historySubtitle')} />

      {occurrences.length === 0 ? (
        <EmptyState title={t('stats.noData')} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11.5px] uppercase text-subtle">
                  <th className="px-3.5 py-2 text-left font-medium">{t('admin.taskTitle')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('task.periodHalf')}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('task.due', { date: '' })}</th>
                  <th className="px-2 py-2 text-left font-medium">{t('admin.userStatus')}</th>
                  <th className="px-3.5 py-2 text-left font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {occurrences.map((o) => {
                  const actor = o.completed_by ?? o.skipped_by;
                  return (
                    <tr key={o.id}>
                      <td className="max-w-[240px] truncate px-3.5 py-2">
                        {localizedTitle(o.task, locale)}
                        {!o.task.is_active && (
                          <Badge tone="neutral" className="ml-1.5">
                            {t('status.inactive')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 tabular text-muted">{o.period_key}</td>
                      <td className="px-2 py-2 tabular text-muted">
                        {formatDate(o.due_date_override ?? o.due_date, 'short')}
                      </td>
                      <td className="px-2 py-2">
                        <Badge
                          tone={
                            o.status === 'completed' ? 'done' : o.status === 'skipped' ? 'skipped' : 'neutral'
                          }
                        >
                          {t(`status.${o.status}` as 'status.pending')}
                        </Badge>
                      </td>
                      <td className="px-3.5 py-2 text-muted">
                        {actor ? (
                          <span>
                            {names[actor] ?? '—'}
                            {o.skip_reason && (
                              <span className="block text-[11.5px] text-subtle">{o.skip_reason}</span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
