'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { cn, displayName } from '@/lib/utils';
import type { OperationalAuditRow, SecurityAuditRow } from '@/server/permissions';

/**
 * The audit trail.
 *
 * Both module logs have been written by triggers since their modules shipped,
 * but nothing ever read them — there was no screen. This is that screen.
 *
 * Values are rendered as compact JSON rather than being prettified per action.
 * There are 13 inventory action types alone, each with its own shape; a
 * bespoke renderer for every one would be a lot of code to describe data an
 * admin reads a few times a year, and it would silently fall behind whenever a
 * new action type is added.
 */
export function AuditLog({
  operational,
  security,
  canSeeSecurity,
}: {
  operational: OperationalAuditRow[];
  security: SecurityAuditRow[];
  canSeeSecurity: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<'operational' | 'security'>('operational');

  const who = (actor: { name: string | null; email: string } | null) =>
    actor ? displayName(actor) : t('audit.system');

  const when = (iso: string) =>
    `${formatDate(iso.slice(0, 10), 'short')} ${iso.slice(11, 16)}`;

  const value = (v: Record<string, unknown> | null) =>
    v === null ? '—' : JSON.stringify(v);

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      {canSeeSecurity && (
        <div className="mb-4 flex gap-1 border-b border-border">
          {(['operational', 'security'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {key === 'operational' ? t('audit.operational') : t('audit.security')}
            </button>
          ))}
        </div>
      )}

      {tab === 'operational' || !canSeeSecurity ? (
        operational.length === 0 ? (
          <EmptyState title={t('audit.empty')} />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3.5 py-2.5 font-semibold">{t('audit.when')}</th>
                    <th className="px-3.5 py-2.5 font-semibold">{t('audit.who')}</th>
                    <th className="px-3.5 py-2.5 font-semibold">{t('audit.action')}</th>
                    <th className="px-3.5 py-2.5 font-semibold">{t('audit.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {operational.map((r) => (
                    <tr key={`${r.source}-${r.id}`} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-3.5 py-2 tabular text-muted">{when(r.created_at)}</td>
                      <td className="px-3.5 py-2">{who(r.actor)}</td>
                      <td className="px-3.5 py-2">
                        {/* Three sources now, not two: task completions,
                            skips and definition edits were never audited. */}
                        <Badge
                          tone={
                            r.source === 'inventory' ? 'accent'
                              : r.source === 'task' ? 'done'
                                : 'neutral'
                          }
                        >
                          {r.action}
                        </Badge>
                      </td>
                      <td className="max-w-[22rem] truncate px-3.5 py-2 font-mono text-[11.5px] text-muted">
                        {value(r.detail)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : security.length === 0 ? (
        <EmptyState title={t('audit.empty')} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-3.5 py-2.5 font-semibold">{t('audit.when')}</th>
                  <th className="px-3.5 py-2.5 font-semibold">{t('audit.who')}</th>
                  <th className="px-3.5 py-2.5 font-semibold">{t('audit.target')}</th>
                  <th className="px-3.5 py-2.5 font-semibold">{t('audit.action')}</th>
                  <th className="px-3.5 py-2.5 font-semibold">{t('audit.change')}</th>
                </tr>
              </thead>
              <tbody>
                {security.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3.5 py-2 tabular text-muted">{when(r.created_at)}</td>
                    <td className="px-3.5 py-2">{who(r.actor)}</td>
                    <td className="px-3.5 py-2">{r.target ? who(r.target) : '—'}</td>
                    <td className="px-3.5 py-2"><Badge tone="warn">{r.action}</Badge></td>
                    <td className="max-w-[20rem] truncate px-3.5 py-2 font-mono text-[11.5px] text-muted">
                      {value(r.previous_value)} → {value(r.new_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
