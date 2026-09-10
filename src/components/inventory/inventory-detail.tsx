'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Lock, MessageSquare, RotateCcw, Search, Users } from 'lucide-react';
import { useI18n } from '@/i18n';
import { filterByQuery } from '@/lib/search';
import { cn, displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Input, ReadOnlyNotice, SectionHeading } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { minutesUntilDeadline } from '@/domain/inventory/calc';
import { formatCalendarWeek } from '@/domain/inventory/schedule';
import { completeInventory, reopenInventory, setInventoryAssignees } from '@/server/inventory-actions';
import { DigitalPendingBadge, StatusBadge, useInventoryError } from './inventory-bits';
import { CommentDialog, ItemCard } from './item-card';
import type { InventoryDetail, InventoryLocation, InventoryStatus } from '@/types/inventory';
import type { Profile } from '@/types/database';

/**
 * One inventory, being counted.
 *
 * `canEdit` and `lock_reason` are computed on the SERVER (and `canEdit` by the
 * same database function RLS uses). Nothing here decides permission — the UI
 * only explains it, so a user who is locked out sees why rather than a screen
 * of controls that silently fail.
 */
export function InventoryDetailView({
  detail,
  locations,
  users,
  canManage,
}: {
  detail: InventoryDetail;
  locations: InventoryLocation[];
  users: Profile[];
  canManage: boolean;
}) {
  const { t, formatDate } = useI18n();
  const translateError = useInventoryError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);

  const canEdit = detail.can_edit;
  const digitalPendingCount = detail.digital_enabled
    ? detail.items.filter((i) => i.digital_quantity === null).length
    : 0;

  // The shared matcher. A 114-item count is exactly where accent folding and
  // multi-term search earn their place, and it was the one list still using a
  // bare substring test.
  const items = useMemo(
    () =>
      filterByQuery(
        detail.items.filter(
          (item) =>
            !onlyOpen || item.status === 'in_progress' || item.status === 'to_review',
        ),
        query,
        (item) => `${item.item_name} ${item.item_group ?? ''}`,
      ),
    [detail.items, query, onlyOpen],
  );

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(translateError(res.error));
    });
  }

  return (
    <div>
      {/* Back to the list. The tab bar returns to the overview, which is not
          where you came from if you arrived through the filtered history —
          and on a phone the tab bar was the only way back at all. */}
      <Link
        href="/inventory"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('common.back')}
      </Link>

      <PageHeader
        title={detail.name_snapshot}
        subtitle={`${formatDate(detail.inventory_date, 'medium')} · ${formatCalendarWeek(detail.iso_week)}`}
        action={<StatusBadge status={detail.status} />}
      />

      {/* ------------------------- header facts ------------------------- */}
      <Card className="mb-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
          <span className="text-muted">
            {t('inventory.assignedTo')}{' '}
            <strong className="text-fg">
              {detail.assignees.length === 0
                ? t('inventory.unassigned')
                : detail.assignees.map((a) => displayName(a)).join(', ')}
            </strong>
          </span>

          {detail.completed_at && (
            <span className="text-muted">
              {t('inventory.completedBy')}{' '}
              <strong className="text-fg">
                {detail.completed_by_profile ? displayName(detail.completed_by_profile) : '—'}
              </strong>
            </span>
          )}

          {digitalPendingCount > 0 && <DigitalPendingBadge count={digitalPendingCount} />}
          <Badge tone="neutral">{t('inventory.itemsCounted', { count: detail.items.length })}</Badge>

          {/* The title is a frozen snapshot, deliberately not the live
              template name — a renamed template must not rewrite history.
              That was true and invisible, so a rename made every past count
              look wrong. */}
          {detail.template && detail.template.name !== detail.name_snapshot && (
            <span className="text-[11.5px] text-subtle">{t('inventory.snapshotName')}</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => setAssignOpen(true)}>
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t('inventory.assign')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCommentOpen(true)}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {t('inventory.generalComment')}
          </Button>
          {canManage && detail.completed_at && (
            <Button size="sm" variant="ghost" onClick={() => run(() => reopenInventory(detail.id))} loading={pending}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('inventory.reopen')}
            </Button>
          )}
        </div>
      </Card>

      {/* --------------------------- lock notice --------------------------- */}
      {!canEdit && <LockNotice reason={detail.lock_reason} />}
      {canEdit && !detail.completed_at && (
        <DeadlineNotice
          inventoryDate={detail.inventory_date}
          grantEndsAt={detail.active_grant?.ends_at ?? null}
        />
      )}

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {/* -------------------------- general comments -----------------------
          Carries the note colour for the same reason the per-item comments
          do: this block only exists because somebody wrote something, and it
          should not look like the surface it sits on. */}
      {detail.general_comments.length > 0 && (
        <Card className="mb-4 border-l-2 border-l-note bg-note/[0.07] p-3">
          <ul className="space-y-1.5">
            {detail.general_comments.map((c) => (
              <li key={c.id} className="text-[12.5px]">
                <span className="font-medium text-note">
                  {c.author ? displayName(c.author) : '—'}
                </span>
                <span className="text-note/80"> · {c.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------- items ----------------------------- */}
      <SectionHeading title={t('inventory.items')} />

      {/* A 114-item count is unusable without a way to jump to a product. */}
      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="pl-9"
            aria-label={t('common.search')}
          />
        </div>
        <Checkbox
          label={t('inventory.needsReview')}
          checked={onlyOpen}
          onChange={(e) => setOnlyOpen(e.target.checked)}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState title={t('inventory.emptyHistory')} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              instanceId={detail.id}
              kind={detail.kind}
              digitalEnabled={detail.digital_enabled}
              locations={locations}
              canEdit={canEdit}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      {/* ----------------------------- complete ---------------------------- */}
      {canEdit && !detail.completed_at && (
        <div className="sticky bottom-20 mt-5 md:bottom-4">
          <Button
            variant="success"
            size="lg"
            className="w-full justify-center shadow-pop"
            onClick={() => setCompleteOpen(true)}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t('inventory.completeInventory')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        onConfirm={() => {
          setCompleteOpen(false);
          run(() => completeInventory(detail.id));
        }}
        title={t('inventory.completeInventory')}
        message={t('inventory.completeConfirm')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />

      <AssignDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        instanceId={detail.id}
        users={users}
        current={detail.assignees.map((a) => a.id)}
      />

      <CommentDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        instanceId={detail.id}
        itemId={null}
        hint={t('inventory.generalCommentHint')}
      />
    </div>
  );
}

/** Says WHY the screen is read-only, rather than just disabling everything. */
function LockNotice({ reason }: { reason: InventoryDetail['lock_reason'] }) {
  const { t } = useI18n();
  const message =
    reason === 'past_deadline'
      ? t('inventory.lockPastDeadline')
      : reason === 'completed'
        ? t('inventory.lockCompleted')
        : t('inventory.lockNotAssigned');

  // The shared notice; this screen's version is now the one every other
  // screen borrows rather than the only one in the app.
  return (
    <ReadOnlyNotice
      title={t('inventory.readOnly')}
      reason={message}
      icon={<Lock className="h-4 w-4" aria-hidden />}
    />
  );
}

/**
 * The countdown to 18:00.
 *
 * Computed from the inventory date on render rather than ticking: a live timer
 * would re-render 114 cards every second on a phone, and the exact minute only
 * matters near the end, when the page is being interacted with anyway.
 */
function DeadlineNotice({
  inventoryDate,
  grantEndsAt,
}: {
  inventoryDate: string;
  grantEndsAt: string | null;
}) {
  const { t } = useI18n();

  if (grantEndsAt) {
    return (
      <div className="mb-4 rounded-lg border border-accent/25 bg-accent/5 px-3.5 py-2.5 text-[12.5px] text-fg">
        {t('inventory.grantActive', {
          time: new Date(grantEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })}
      </div>
    );
  }

  const minutes = minutesUntilDeadline(inventoryDate);
  if (minutes === 0) return null;

  const urgent = minutes <= 60;
  return (
    <div
      className={cn(
        'mb-4 rounded-lg border px-3.5 py-2.5 text-[12.5px]',
        urgent ? 'border-warn/30 bg-warn/5 text-fg' : 'border-border bg-surface-2/50 text-muted',
      )}
    >
      {urgent ? t('inventory.deadlineMinutes', { minutes }) : t('inventory.deadlineAt')}
    </div>
  );
}

function AssignDialog({
  open,
  onClose,
  instanceId,
  users,
  current,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  users: Profile[];
  current: string[];
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [selected, setSelected] = useState<string[]>(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('inventory.assign')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setInventoryAssignees(instanceId, selected);
                if (res.ok) onClose();
                else setError(translateError(res.error));
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {/* Several people counting one inventory together is normal, so this is
          a multi-select rather than a single owner. */}
      <div className="space-y-2">
        {users
          .filter((u) => u.status === 'approved')
          .map((u) => (
            <Checkbox
              key={u.id}
              label={displayName(u)}
              hint={u.name ? u.email : undefined}
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
          ))}
      </div>
      {error && <p className="mt-2 text-[12px] text-late">{error}</p>}
    </Dialog>
  );
}
