'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Camera, ChevronLeft, ExternalLink, FileText, Link2, PackagePlus, Plus, Trash2,
} from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  Badge, Card, CardBody, CardHeader, ErrorState, Field,
  Input, ReadOnlyNotice, Select, Textarea,
} from '@/components/ui/primitives';
import { StatusChip } from '@/components/ui/status-chip';
import { PageHeader } from '@/components/shell/app-shell';
import {
  INCIDENT_CAUSES, INCIDENT_RESPONSIBILITIES, INCIDENT_SEVERITIES, vocabularyKey,
} from '@/domain/incidents/vocabulary';
import { availableTransitions } from '@/domain/incidents/workflow';
import { toQuantity } from '@/domain/orders/progress';
import {
  addEvidence, addReplacement, createCorrectiveAction, deleteEvidence,
  deleteReplacement, updateIncident,
} from '@/server/incident-actions';
import { OrderDialog } from '@/components/orders/order-dialog';
import { productLabel, type Customer, type DeliveryMethod, type Product } from '@/types/orders';
import type { Incident } from '@/types/incidents';
import type { Profile } from '@/types/database';
import { categoryLabel, typeLabel } from './incident-list';
import { errorKey } from './incident-dialog';

/**
 * The incident detail — where the investigation actually happens.
 *
 * Laid out as the specification describes it, in the order somebody works
 * through one: what happened, what it affected, why, what we can show for it,
 * what we sent back, what we are going to change, and how it ended.
 *
 * The sections that record a JUDGEMENT — cause, responsibility — are visually
 * separated from the ones that record a FACT, and each carries the sentence
 * saying which it is. That separation is the module's whole point, and a
 * layout that mixed them would undo it however careful the database was.
 */
export function IncidentDetail({
  incident,
  users,
  customers,
  products,
  deliveryMethods,
  canManage,
  canClose,
}: {
  incident: Incident;
  /** For assigning a corrective action. Approved users only. */
  users: Profile[];
  /** For raising a replacement ORDER, which is an ordinary order. */
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  canManage: boolean;
  canClose: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(t(errorKey(res.error ?? 'save_failed')));
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title={incident.incident_number}
        subtitle={typeLabel(t, incident.type.slug, incident.type.name)}
        action={
          <Link href="/incidents">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {t('incident.backToList')}
            </Button>
          </Link>
        }
      />

      {!canManage && (
        <ReadOnlyNotice title={t('incident.readOnly')} reason={t('incident.readOnlyBody')} />
      )}
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="space-y-4">
        {/* ---------- header: severity, status, and where it stands ---------- */}
        <Card>
          <CardBody className="pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip domain="severity" status={incident.severity} />
              <StatusChip domain="incident" status={incident.status} />
              <span className="text-[12.5px] text-muted">
                {t('incident.detected')} {formatDate(incident.detected_at.slice(0, 10))}
              </span>
            </div>

            {canManage && (
              <StatusControls
                incident={incident}
                canClose={canClose}
                pending={pending}
                onRun={run}
              />
            )}
          </CardBody>
        </Card>

        {/* ---------- customer and order ---------- */}
        <Section title={t('incident.customer')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
            <Detail label={t('incident.customer')}>{incident.customer?.name ?? '—'}</Detail>
            <Detail label={t('incident.order')}>
              {incident.order ? (
                <Link href={`/orders/${incident.order.id}`} className="text-accent hover:underline">
                  #{incident.order.reference}
                </Link>
              ) : (
                // §7: says so plainly, and offers no way to invent one.
                <span className="italic text-subtle">{t('incident.orderUnknown')}</span>
              )}
            </Detail>
            <Detail label={t('incident.deliveryMethod')}>
              {incident.delivery_method?.name ?? '—'}
            </Detail>
            {incident.order && (
              <>
                <Detail label={t('incident.orderDate')}>
                  {formatDate(incident.order.order_date, 'short')}
                </Detail>
                <Detail label={t('incident.preparationDate')}>
                  {formatDate(incident.order.preparation_date, 'short')}
                </Detail>
                <Detail label={t('incident.deliveryDate')}>
                  {formatDate(incident.order.delivery_date, 'short')}
                </Detail>
              </>
            )}
          </dl>
        </Section>

        {/* ---------- what happened ---------- */}
        <Section title={t('incident.whatHappened')}>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">
              {categoryLabel(
                t,
                incident.type.category?.slug ?? 'other',
                incident.type.category?.name,
              )}
            </Badge>
            <Badge tone="accent">{typeLabel(t, incident.type.slug, incident.type.name)}</Badge>
          </div>
          <p className="mt-2.5 whitespace-pre-wrap text-[13px]">{incident.description}</p>
        </Section>

        {/* ---------- affected products ---------- */}
        <Section title={t('incident.affectedProducts')}>
          {incident.items.length === 0 ? (
            <p className="text-[13px] text-muted">{t('incident.noProducts')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {incident.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
                  <span className="w-12 shrink-0 tabular text-[11.5px] text-subtle">
                    {item.product.code ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {productLabel(item.product)}
                  </span>
                  {item.affected_quantity !== null && (
                    <span className="tabular text-[12.5px]">
                      {toQuantity(item.affected_quantity)}
                    </span>
                  )}
                  {/* The lot, read through the allocation. There is no second
                      lot-number store — this is the Tracker's own row. */}
                  {item.lot_allocation && (
                    <Link
                      href={`/lot-tracker/${encodeURIComponent(item.lot_allocation.lot_number)}`}
                      className="text-[11.5px] text-accent hover:underline"
                    >
                      {t('incident.lot')} {item.lot_allocation.lot_number}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ---------- investigation ---------- */}
        <InvestigationSection
          incident={incident}
          canManage={canManage}
          pending={pending}
          onRun={run}
        />

        {/* ---------- evidence ---------- */}
        <EvidenceSection incident={incident} canManage={canManage} onError={setError} />

        {/* ---------- replacement ---------- */}
        <ReplacementSection
          incident={incident}
          customers={customers}
          products={products}
          deliveryMethods={deliveryMethods}
          canManage={canManage}
          pending={pending}
          onRun={run}
        />

        {/* ---------- corrective actions ---------- */}
        <ActionsSection
          incident={incident}
          users={users}
          canManage={canManage}
          pending={pending}
          onRun={run}
        />

        {/* ---------- resolution ---------- */}
        {(incident.resolution_notes || incident.resolved_at) && (
          <Section title={t('incident.resolution')}>
            {incident.resolution_notes && (
              <p className="whitespace-pre-wrap text-[13px]">{incident.resolution_notes}</p>
            )}
            {/* Who, not just when. Resolving and closing are separate acts by
                potentially different people, and a date with no name answers
                half the question the section exists for. */}
            <div className="mt-2 space-y-0.5 text-[12px] text-muted">
              {incident.resolved_at && (
                <p>
                  {t('incident.resolvedBy', {
                    name: incident.resolver?.name ?? incident.resolver?.email ?? '—',
                  })}
                  {' · '}
                  {formatDate(incident.resolved_at.slice(0, 10))}
                </p>
              )}
              {incident.closed_at && (
                <p>
                  {t('incident.closedBy', {
                    name: incident.closer?.name ?? incident.closer?.email ?? '—',
                  })}
                  {' · '}
                  {formatDate(incident.closed_at.slice(0, 10))}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ---------- history ---------- */}
        <Section title={t('incident.history')}>
          {incident.history.length === 0 ? (
            <p className="text-[13px] text-muted">{t('incident.noHistory')}</p>
          ) : (
            <ol className="space-y-2">
              {incident.history.map((entry) => (
                <li key={entry.id} className="flex gap-2.5 text-[12.5px]">
                  <span className="w-24 shrink-0 text-subtle">
                    {formatDate(entry.created_at.slice(0, 10), 'short')}
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* The from/to values come out of the audit row itself, so
                        a status change reads "Open → Investigating" rather
                        than a bare "Status changed". */}
                    {t(historyKey(entry.action), historyVars(t, entry))}
                    <span className="ml-1.5 text-muted">
                      {entry.actor?.name ?? entry.actor?.email ?? ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}

/* ------------------------------- sections ------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      </CardHeader>
      <CardBody className="pt-2.5">{children}</CardBody>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}

/**
 * Moving the incident along.
 *
 * Only the transitions this viewer may actually make are offered — the domain
 * decides, so a Power User is never shown a Close button that the database
 * will refuse. The database refuses it anyway.
 */
function StatusControls({
  incident,
  canClose,
  pending,
  onRun,
}: {
  incident: Incident;
  canClose: boolean;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { t } = useI18n();
  const [resolution, setResolution] = useState(incident.resolution_notes ?? '');

  const options = availableTransitions(incident.status, {
    canClose,
    hasResolutionNotes: Boolean(resolution.trim()),
  });

  if (options.length === 0) return null;

  return (
    <div className="mt-3 space-y-2.5 border-t border-border pt-3">
      {/* Shown whenever resolving is on the table, because it is what makes
          resolving possible — §18: a status change is not a resolution. */}
      {(options.includes('resolved') || incident.status === 'resolved') && (
        <Field
          label={t('incident.resolutionNotes')}
          hint={t('incident.resolutionNotesHint')}
          htmlFor="i-resolution"
        >
          <Textarea
            id="i-resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={2}
          />
        </Field>
      )}

      <div className="flex flex-wrap gap-1.5">
        {options.map((to) => (
          <Button
            key={to}
            size="sm"
            variant={to === 'closed' ? 'success' : 'secondary'}
            disabled={pending}
            onClick={() =>
              onRun(() =>
                updateIncident(incident.id, {
                  status: to,
                  resolution_notes: resolution.trim() || null,
                }),
              )
            }
          >
            {t(`incident.status.${vocabularyKey(to)}` as MessageKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The investigation.
 *
 * Every field here is a JUDGEMENT somebody made, and the hints say so. The
 * responsibility field in particular carries the sentence that keeps the
 * reports honest: it is only ever what the investigation concluded, never
 * what the joins imply.
 */
function InvestigationSection({
  incident,
  canManage,
  pending,
  onRun,
}: {
  incident: Incident;
  canManage: boolean;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { t } = useI18n();
  const [primary, setPrimary] = useState(incident.primary_cause ?? '');
  const [secondary, setSecondary] = useState<string[]>(incident.secondary_causes);
  const [responsibility, setResponsibility] = useState(incident.responsibility);
  const [notes, setNotes] = useState(incident.investigation_notes ?? '');
  const [severity, setSeverity] = useState(incident.severity);

  if (!canManage) {
    return (
      <Section title={t('incident.investigation')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
          <Detail label={t('incident.primaryCause')}>
            {incident.primary_cause
              ? t(`incident.cause.${vocabularyKey(incident.primary_cause)}` as MessageKey)
              : t('incident.notInvestigated')}
          </Detail>
          <Detail label={t('incident.responsibilityLabel')}>
            {t(`incident.responsibility.${vocabularyKey(incident.responsibility)}` as MessageKey)}
          </Detail>
        </dl>
        {incident.investigation_notes && (
          <p className="mt-2.5 whitespace-pre-wrap text-[13px]">{incident.investigation_notes}</p>
        )}
      </Section>
    );
  }

  const toggle = (cause: string) =>
    setSecondary((s) => (s.includes(cause) ? s.filter((c) => c !== cause) : [...s, cause]));

  return (
    <Section title={t('incident.investigation')}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('incident.primaryCause')} hint={t('incident.primaryCauseHint')} htmlFor="i-cause">
            <Select id="i-cause" value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">{t('incident.notInvestigated')}</option>
              {INCIDENT_CAUSES.map((c) => (
                <option key={c} value={c}>
                  {t(`incident.cause.${vocabularyKey(c)}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t('incident.responsibilityLabel')}
            hint={t('incident.responsibilityHint')}
            htmlFor="i-resp"
          >
            <Select
              id="i-resp"
              value={responsibility}
              onChange={(e) => setResponsibility(e.target.value as typeof responsibility)}
            >
              {INCIDENT_RESPONSIBILITIES.map((r) => (
                <option key={r} value={r}>
                  {t(`incident.responsibility.${vocabularyKey(r)}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('incident.severityLabel')} htmlFor="i-sev2">
            <Select
              id="i-sev2"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`incident.severity.${vocabularyKey(s)}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <p className="text-[13px] font-medium">{t('incident.secondaryCauses')}</p>
          <p className="mb-2 mt-0.5 text-[12px] text-muted">{t('incident.secondaryCausesHint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {INCIDENT_CAUSES.filter((c) => c !== primary).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                aria-pressed={secondary.includes(c)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[12px] transition-colors touch-target',
                  secondary.includes(c)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface text-muted hover:text-fg',
                )}
              >
                {t(`incident.cause.${vocabularyKey(c)}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>

        <Field label={t('incident.investigationNotes')} htmlFor="i-notes">
          <Textarea id="i-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        <Button
          variant="primary"
          size="sm"
          loading={pending}
          onClick={() =>
            onRun(() =>
              updateIncident(incident.id, {
                primary_cause: (primary || null) as never,
                secondary_causes: secondary.filter((c) => c !== primary) as never,
                responsibility,
                severity,
                investigation_notes: notes.trim() || null,
              }),
            )
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </Section>
  );
}

/**
 * Evidence.
 *
 * `capture="environment"` is what makes the button open the rear camera on a
 * phone instead of a file browser — §16 and §38. It degrades to an ordinary
 * file picker everywhere else, so one control serves both.
 */
function EvidenceSection({
  incident,
  canManage,
  onError,
}: {
  incident: Incident;
  canManage: boolean;
  onError: (message: string | null) => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    startTransition(async () => {
      onError(null);
      const form = new FormData();
      form.set('incident_id', incident.id);
      form.set('file', file);
      const res = await addEvidence(form);
      if (!res.ok) return onError(t(errorKey(res.error)));
      router.refresh();
    });
  }

  return (
    <Section title={t('incident.evidence')}>
      {incident.evidence.length === 0 ? (
        <p className="text-[13px] text-muted">{t('incident.noEvidence')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {incident.evidence.map((e) => (
            <li key={e.id} className="overflow-hidden rounded-lg border border-border">
              {e.signed_url ? (
                <a href={e.signed_url} target="_blank" rel="noopener noreferrer" className="block">
                  {e.mime_type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a
                    // signed, short-lived URL on a private bucket cannot go
                    // through the image optimiser.
                    <img
                      src={e.signed_url}
                      alt={e.file_name}
                      className="h-24 w-full bg-surface-2 object-cover"
                    />
                  ) : (
                    <span className="flex h-24 items-center justify-center bg-surface-2">
                      <FileText className="h-6 w-6 text-subtle" aria-hidden />
                    </span>
                  )}
                </a>
              ) : (
                <span className="flex h-24 items-center justify-center bg-surface-2 text-[11px] text-subtle">
                  {t('common.error')}
                </span>
              )}
              <div className="flex items-center gap-1 px-1.5 py-1">
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted" title={e.file_name}>
                  {formatDate(e.created_at.slice(0, 10), 'short')}
                  {e.uploader?.name ? ` · ${e.uploader.name}` : ''}
                </span>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('incident.removeEvidence')}
                    onClick={() => setRemoving(e.id)}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <p className="mt-2.5 text-[12px] text-muted">{t('incident.evidenceHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) upload(file);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            loading={pending}
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
            {t('incident.addEvidence')}
          </Button>
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          startTransition(async () => {
            if (!removing) return;
            const res = await deleteEvidence(removing, incident.id);
            setRemoving(null);
            if (!res.ok) return onError(t(errorKey(res.error)));
            router.refresh();
          })
        }
        title={t('incident.removeEvidence')}
        message={t('incident.removeEvidenceConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </Section>
  );
}

/**
 * Replacements.
 *
 * An incident is not a replacement: recording one here changes nothing about
 * the incident's status, and the hint says so.
 *
 * The preferred shape is a REAL ORDER, so "Create replacement order" opens the
 * ordinary order editor with the customer and the affected products already
 * filled in from the incident. What comes out is a normal order — picked in
 * Lotnummerkontrol, carrying lot numbers, reaching the Lot Nummer Tracker and
 * counted in the order reports — that additionally knows which incident it was
 * raised for.
 *
 * Two lesser shapes exist because not every replacement is a new delivery: an
 * order raised elsewhere can be linked by its number, and a compensation that
 * never became an order at all is recorded as a note rather than by inventing
 * one.
 */
function ReplacementSection({
  incident,
  customers,
  products,
  deliveryMethods,
  canManage,
  pending,
  onRun,
}: {
  incident: Incident;
  customers: Customer[];
  products: Product[];
  deliveryMethods: DeliveryMethod[];
  canManage: boolean;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [orderRef, setOrderRef] = useState('');
  const [note, setNote] = useState('');

  /**
   * What the replacement should contain, taken from the incident.
   *
   * The affected products with their affected quantities — which is the whole
   * point of having recorded them. A line whose quantity was never recorded
   * arrives with an empty box for somebody to fill, rather than a guess.
   */
  const initial = {
    customer_id: incident.customer_id ?? undefined,
    note: t('incident.replacementOrderNote', { number: incident.incident_number }),
    // Free, to make good. Filing it as a sale would overstate the month's
    // trade by every box we sent to apologise.
    order_type: 'replacement' as const,
    lines: incident.items.map((item) => ({
      product_id: item.product_id,
      ordered_quantity:
        item.affected_quantity === null ? '' : String(toQuantity(item.affected_quantity)),
    })),
  };

  return (
    <Section title={t('incident.replacements')}>
      <p className="mb-2 text-[12px] text-muted">{t('incident.replacementsHint')}</p>

      {incident.replacements.length === 0 ? (
        <p className="text-[13px] text-muted">{t('incident.noReplacements')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {incident.replacements.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2 first:pt-0">
              <div className="min-w-0 flex-1">
                {r.order ? (
                  <Link
                    href={`/orders/${r.order.id}`}
                    className="text-[13px] text-accent hover:underline"
                  >
                    #{r.order.reference} · {formatDate(r.order.delivery_date, 'short')}
                  </Link>
                ) : (
                  <p className="text-[13px]">{r.note}</p>
                )}
                {r.order && r.note && <p className="text-[12px] text-muted">{r.note}</p>}
              </div>
              {canManage && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('incident.removeReplacement')}
                  disabled={pending}
                  onClick={() => onRun(() => deleteReplacement(r.id, incident.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* The primary path. An order cannot exist without a customer, and
                §7 allows an incident that does not know one yet. */}
            <Button
              size="sm"
              variant="primary"
              onClick={() => setCreating(true)}
              disabled={!incident.customer_id}
            >
              <PackagePlus className="h-3.5 w-3.5" aria-hidden />
              {t('incident.createReplacementOrder')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setLinking(true)}>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {t('incident.linkReplacement')}
            </Button>
          </div>
          {!incident.customer_id && (
            <p className="mt-1.5 text-[11.5px] text-subtle">
              {t('incident.replacementNeedsCustomer')}
            </p>
          )}
        </>
      )}

      {/* The ordinary order editor. Nothing in it is special-cased for
          incidents — it is the same dialog Order Control opens, which is
          exactly what makes the result an ordinary order. */}
      {creating && (
        <OrderDialog
          order={null}
          customers={customers}
          products={products}
          deliveryMethods={deliveryMethods}
          initial={initial}
          onClose={() => setCreating(false)}
          onSaved={(orderId) => {
            setCreating(false);
            // Linking it back also stamps replaces_incident_id on the order.
            onRun(() => addReplacement(incident.id, { order_id: orderId }));
          }}
        />
      )}

      {linking && (
        <Dialog
          open
          onClose={() => setLinking(false)}
          title={t('incident.linkReplacement')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setLinking(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={!orderRef.trim() && !note.trim()}
                onClick={() =>
                  onRun(async () => {
                    const res = await addReplacement(incident.id, {
                      order_reference: orderRef.trim() ? Number(orderRef.trim()) : null,
                      note: note.trim() || null,
                    });
                    if (res.ok) {
                      setLinking(false);
                      setOrderRef('');
                      setNote('');
                    }
                    return res;
                  })
                }
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field
              label={t('incident.replacementOrder')}
              hint={t('incident.replacementOrderHint')}
              htmlFor="r-order"
            >
              <Input
                id="r-order"
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="1042"
              />
            </Field>
            <Field label={t('incident.replacementNote')} htmlFor="r-note">
              <Textarea
                id="r-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('incident.replacementNotePlaceholder')}
              />
            </Field>
          </div>
        </Dialog>
      )}
    </Section>
  );
}

/**
 * Corrective actions.
 *
 * Each one is a REAL task with a real occurrence — it appears on the
 * calendar, on the assignee's dashboard and in the task audit trail, because
 * it is the same row those screens read. Completing it there shows as
 * completed here with no synchronisation.
 */
function ActionsSection({
  incident,
  users,
  canManage,
  pending,
  onRun,
}: {
  incident: Incident;
  users: Profile[];
  canManage: boolean;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');

  return (
    <Section title={t('incident.correctiveActions')}>
      <p className="mb-2 text-[12px] text-muted">{t('incident.correctiveActionsHint')}</p>

      {incident.actions.length === 0 ? (
        <p className="text-[13px] text-muted">{t('incident.noActions')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {incident.actions.map((a) => (
            <li key={a.occurrence_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{a.title}</p>
                <p className="text-[11.5px] text-muted">
                  {a.assignee?.name ?? a.assignee?.email ?? t('incident.actionUnassigned')} ·{' '}
                  {formatDate(a.due_date, 'short')}
                </p>
              </div>
              <StatusChip domain="task" status={a.status} />
              <Link href="/calendar" aria-label={t('ireport.openReport')} className="text-subtle hover:text-fg">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('incident.addAction')}
        </Button>
      )}

      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t('incident.addAction')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={!title.trim() || !due}
                onClick={() =>
                  onRun(async () => {
                    const res = await createCorrectiveAction(incident.id, {
                      title: title.trim(),
                      description: description.trim() || null,
                      assignee_id: assignee || null,
                      due_date: due,
                    });
                    if (res.ok) { setOpen(false); setTitle(''); setDescription(''); setDue(''); }
                    return res;
                  })
                }
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <Field label={t('incident.actionTitle')} required htmlFor="a-title">
              <Input
                id="a-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('incident.actionTitlePlaceholder')}
                autoFocus
              />
            </Field>
            <Field label={t('incident.actionDescription')} htmlFor="a-desc">
              <Textarea
                id="a-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('incident.actionAssignee')} htmlFor="a-who">
                <Select id="a-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{t('incident.actionUnassigned')}</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('incident.actionDue')} required htmlFor="a-due">
                <Input id="a-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            </div>
          </div>
        </Dialog>
      )}
    </Section>
  );
}

/**
 * The values a history sentence interpolates.
 *
 * Translated through the same vocabulary keys the rest of the page uses, so
 * the trail reads in the viewer's language rather than showing the raw enum
 * labels stored in the audit row.
 */
function historyVars(
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  entry: Incident['history'][number],
): Record<string, string> {
  const before = (entry.previous_value ?? {}) as Record<string, unknown>;
  const after = (entry.new_value ?? {}) as Record<string, unknown>;

  const label = (group: 'status' | 'severity', value: unknown) =>
    typeof value === 'string' && value
      ? t(`incident.${group}.${vocabularyKey(value)}` as MessageKey)
      : '—';

  if (entry.action === 'incident_severity_changed') {
    return { from: label('severity', before.severity), to: label('severity', after.severity) };
  }
  return { from: label('status', before.status), to: label('status', after.status) };
}

function historyKey(action: string): MessageKey {
  const map: Record<string, MessageKey> = {
    incident_created: 'incident.histCreated',
    incident_status_changed: 'incident.histStatus',
    incident_severity_changed: 'incident.histSeverity',
    incident_investigation_changed: 'incident.histInvestigation',
    incident_links_changed: 'incident.histLinks',
    incident_notes_changed: 'incident.histNotes',
  };
  return map[action] ?? 'incident.histNotes';
}
