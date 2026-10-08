'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { CalendarClock, History, Pencil, Plus, Truck, XCircle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { BUSINESS_TZ, addDays } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shell/app-shell';
import { Badge, Card, EmptyState, Field } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { arrivalVerdict, groupExpected, isLate, type ExpectedSection } from '@/domain/goods-reception/expected';
import { cancelExpectedDelivery } from '@/server/expected-delivery-actions';
import type { Product } from '@/types/orders';
import type { ExpectedDelivery, Supplier, Transporter } from '@/types/goods-reception';
import { ExpectedForm } from './expected-form';
import { ReceptionForm } from './reception-form';
import { ExpectedLines, LoadBadges, ReceptionTabs, useExpectedError, useExpectedLabels } from './expected-bits';

/**
 * What is coming: the deliveries the office announced, in the order the
 * floor meets them — what did not arrive, today, tomorrow, then the days and
 * weeks ahead.
 *
 * The office enters, changes and cancels; whoever receives registers the
 * arrival from the entry itself, which opens the reception already filled in.
 */
export function ExpectedList({
  open,
  history,
  today,
  suppliers,
  transporters,
  products,
  canManage,
  canRegister,
}: {
  open: ExpectedDelivery[];
  /** Arrived and cancelled, when that is what is being looked at. */
  history: ExpectedDelivery[] | null;
  today: string;
  suppliers: Supplier[];
  transporters: Transporter[];
  /** For the lines of the form; empty for whoever only reads. */
  products: Product[];
  canManage: boolean;
  /** May register a reception: on the reception list, or holding the management capability. */
  canRegister: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExpectedDelivery | null>(null);
  const [cancelling, setCancelling] = useState<ExpectedDelivery | null>(null);
  const [arriving, setArriving] = useState<ExpectedDelivery | null>(null);

  const sections = groupExpected(open, today);
  const heading = (s: ExpectedSection<ExpectedDelivery>) =>
    s.kind === 'late'
      ? t('grx.late')
      : s.kind === 'today'
        ? `${t('grx.today')} · ${formatDate(s.date!, 'weekday')}`
        : s.kind === 'tomorrow'
          ? `${t('grx.tomorrow')} · ${formatDate(s.date!, 'weekday')}`
          : s.kind === 'day'
            ? formatDate(s.date!, 'weekday')
            : t('grx.weekNoDay', { from: formatDate(s.date!, 'short'), to: formatDate(addDays(s.date!, 4), 'short') });

  return (
    <>
      <PageHeader
        title={t('gr.title')}
        subtitle={t('grx.subtitle')}
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('grx.new')}
            </Button>
          ) : undefined
        }
      />

      <ReceptionTabs tab="expected" expectedCount={open.length} />

      <div className="mb-3 flex justify-end">
        <Link
          href={history ? '/goods-reception?tab=expected' : '/goods-reception?tab=expected&show=history'}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline"
        >
          {history ? <CalendarClock className="h-3.5 w-3.5" aria-hidden /> : <History className="h-3.5 w-3.5" aria-hidden />}
          {history ? t('grx.showOpen') : t('grx.showHistory')}
        </Link>
      </div>

      {history ? (
        history.length === 0 ? (
          <EmptyState title={t('grx.emptyHistory')} icon={<History className="h-5 w-5" aria-hidden />} />
        ) : (
          <ul className="space-y-1.5">
            {history.map((d) => <li key={d.id}><ExpectedCard delivery={d} today={today} /></li>)}
          </ul>
        )
      ) : sections.length === 0 ? (
        <EmptyState title={t('grx.empty')} body={t('grx.emptyBody')} icon={<Truck className="h-5 w-5" aria-hidden />} />
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className={`mb-1.5 text-[11.5px] font-semibold uppercase tracking-wider ${section.kind === 'late' ? 'text-late' : 'text-subtle'}`}>
                {heading(section)}
              </h2>
              <ul className="space-y-1.5">
                {section.items.map((d) => (
                  <li key={d.id}>
                    <ExpectedCard
                      delivery={d}
                      today={today}
                      onArrive={canRegister ? () => setArriving(d) : undefined}
                      onEdit={canManage ? () => setEditing(d) : undefined}
                      onCancel={canManage ? () => setCancelling(d) : undefined}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ExpectedForm
          delivery={editing ?? undefined}
          suppliers={suppliers.filter((s) => s.is_active || s.id === editing?.supplier_id)}
          transporters={transporters.filter((tr) => tr.is_active || tr.id === editing?.transporter_id)}
          products={products}
          today={today}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {cancelling && <CancelDialog delivery={cancelling} onClose={() => setCancelling(null)} />}

      {arriving && (
        <ReceptionForm
          suppliers={suppliers.filter((s) => s.is_active || s.id === arriving.supplier_id)}
          transporters={transporters.filter((tr) => tr.is_active || tr.id === arriving.transporter_id)}
          expected={open}
          arrivalOf={arriving}
          onClose={() => setArriving(null)}
        />
      )}
    </>
  );
}

function ExpectedCard({
  delivery: d,
  today,
  onArrive,
  onEdit,
  onCancel,
}: {
  delivery: ExpectedDelivery;
  today: string;
  onArrive?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const labels = useExpectedLabels();
  const late = isLate(d, today);
  const arrivedOn = d.reception
    ? DateTime.fromISO(d.reception.received_at, { zone: 'utc' }).setZone(BUSINESS_TZ).toISODate()!
    : null;
  const verdict = arrivedOn ? arrivalVerdict(d, arrivedOn) : null;

  return (
    <Card className={`p-3 ${late ? 'border-late/40' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[14px] font-semibold">{d.supplier?.name ?? '—'}</span>
        <LoadBadges delivery={d} />
        {late && <Badge tone="late">{t('grx.lateBadge')}</Badge>}
        {d.status === 'arrived' && <Badge tone="done">{t('grx.statusLabel.arrived')}</Badge>}
        {d.status === 'cancelled' && <Badge tone="skipped">{t('grx.statusLabel.cancelled')}</Badge>}
      </div>

      <p className="mt-1 text-[12px] text-muted">
        {(late || d.status !== 'expected') && `${t('grx.expectedFor', { when: labels.when(d) })} · `}
        {d.transporter ? `${d.transporter.name} · ` : ''}
        {d.creator ? t('grx.enteredBy', { name: displayName(d.creator) }) : ''}
        {d.moved_count > 0 ? ` · ${t('grx.moved', { count: d.moved_count })}` : ''}
      </p>

      {d.note && <NoteText className="mt-1.5 text-[13px]" text={d.note} />}

      {d.lines.length > 0 && <div className="mt-2"><ExpectedLines lines={d.lines} /></div>}

      {d.status === 'arrived' && d.reception && (
        <p className="mt-2 text-[12.5px]">
          <Link href={`/goods-reception/${d.reception.id}`} className="font-mono font-semibold text-accent hover:underline">
            {d.reception.reception_number}
          </Link>
          {' · '}
          {t('grx.arrivedOn', { date: formatDate(arrivedOn!, 'short') })}
          {verdict && (
            <span className={verdict.verdict === 'late' ? 'text-late' : 'text-muted'}>
              {' · '}
              {verdict.verdict === 'on_time'
                ? t('grx.verdict.onTime')
                : t(verdict.verdict === 'late' ? 'grx.verdict.late' : 'grx.verdict.early', { days: verdict.days })}
            </span>
          )}
        </p>
      )}

      {d.status === 'cancelled' && d.cancel_reason && (
        <p className="mt-2 text-[12.5px] text-muted">{t('grx.cancelReason')}: {d.cancel_reason}</p>
      )}

      {(onArrive || onEdit || onCancel) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {onArrive && (
            <Button size="sm" variant="primary" onClick={onArrive}>
              <Truck className="h-3.5 w-3.5" aria-hidden />
              {t('grx.registerArrival')}
            </Button>
          )}
          {onEdit && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('common.edit')}
            </Button>
          )}
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              {t('grx.cancel')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function CancelDialog({ delivery, onClose }: { delivery: ExpectedDelivery; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useExpectedLabels();
  const translateError = useExpectedError();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('grx.cancelTitle')}
      description={`${delivery.supplier?.name ?? ''} · ${labels.when(delivery)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await cancelExpectedDelivery(delivery.id, reason);
                if (!res.ok) return setError(translateError(res.error));
                onClose();
                router.refresh();
              })
            }
          >
            {t('grx.cancel')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-muted">{t('grx.cancelBody')}</p>
        <Field label={t('grx.cancelReason')} htmlFor="grx-cancel-reason">
          <NoteTextarea id="grx-cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
