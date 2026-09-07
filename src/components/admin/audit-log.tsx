'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
 * Values are still rendered as JSON rather than prettified per action. There
 * are 13 inventory action types alone, each with its own shape; a bespoke
 * renderer for every one would be a lot of code to describe data an admin
 * reads a few times a year, and it would silently fall behind whenever a new
 * action type is added.
 *
 * What changed is that the JSON is no longer TRUNCATED. A screen whose stated
 * job is "what was changed, by whom, and when" showed the detail clipped at
 * 22rem with an ellipsis — unreadable in precisely the cases somebody opens it
 * for. Each row expands to the full value, formatted, and the whole thing
 * renders as cards below the tablet breakpoint instead of a sideways-scrolling
 * rectangle in an app otherwise built out of cards.
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

  const showOperational = tab === 'operational' || !canSeeSecurity;

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

      {showOperational ? (
        operational.length === 0 ? (
          <EmptyState title={t('audit.empty')} />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {operational.map((r) => (
                <AuditEntry
                  key={`${r.source}-${r.id}`}
                  when={when(r.created_at)}
                  who={who(r.actor)}
                  action={r.action}
                  // Three sources now, not two: task completions, skips and
                  // definition edits were never audited at all.
                  tone={r.source === 'inventory' ? 'accent' : r.source === 'task' ? 'done' : 'neutral'}
                  detail={{ [t('audit.detail')]: r.detail }}
                />
              ))}
            </ul>
          </Card>
        )
      ) : security.length === 0 ? (
        <EmptyState title={t('audit.empty')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {security.map((r) => (
              <AuditEntry
                key={r.id}
                when={when(r.created_at)}
                who={who(r.actor)}
                target={r.target ? who(r.target) : undefined}
                action={r.action}
                tone="warn"
                detail={{
                  [t('audit.before')]: r.previous_value,
                  [t('audit.after')]: r.new_value,
                }}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * One entry, expandable.
 *
 * Deliberately a list row rather than a table row: the facts are a handful of
 * short labelled values, which wrap on a phone and line up on a desktop with
 * no minimum width and no horizontal scroller.
 */
function AuditEntry({
  when,
  who,
  target,
  action,
  tone,
  detail,
}: {
  when: string;
  who: string;
  target?: string;
  action: string;
  tone: 'accent' | 'done' | 'neutral' | 'warn';
  detail: Record<string, Record<string, unknown> | null>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Nothing recorded means nothing to expand — an empty drawer reads as a
  // failure to load rather than as "this action carried no payload".
  const hasDetail = Object.values(detail).some((v) => v !== null);

  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          'flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left text-[13px]',
          hasDetail && 'transition-colors hover:bg-surface-2/60',
        )}
      >
        <span className="w-[7.5rem] shrink-0 tabular text-muted">{when}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{who}</span>
        {target && <span className="min-w-0 truncate text-muted">→ {target}</span>}
        <Badge tone={tone}>{action}</Badge>
        {hasDetail && (
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border bg-surface-2/40 px-3.5 py-2.5">
          {Object.entries(detail).map(([label, value]) =>
            value === null ? null : (
              <div key={label}>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-subtle">{label}</p>
                {/* The whole value, wrapped rather than clipped. */}
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-surface p-2 font-mono text-[11.5px] leading-relaxed text-muted">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </div>
            ),
          )}
          {!hasDetail && <p className="text-[12px] text-subtle">{t('audit.empty')}</p>}
        </div>
      )}
    </li>
  );
}
