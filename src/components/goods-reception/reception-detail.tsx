'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/app-shell';
import { StatusChip } from '@/components/ui/status-chip';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  ReadOnlyNotice,
  SectionHeading,
} from '@/components/ui/primitives';
import { canComplete } from '@/domain/goods-reception/workflow';
import {
  addReceptionEvidence,
  completeReception,
  deleteReceptionEvidence,
  reopenReception,
} from '@/server/goods-reception-actions';
import type { ReceptionAuditEntry, ReceptionDetail, Supplier, Transporter } from '@/types/goods-reception';
import type { Product } from '@/types/orders';
import type { IncidentType } from '@/types/incidents';
import { ReceptionForm } from './reception-form';
import { ExceptionEditor } from './exception-editor';
import { ReportIncidentDialog } from './report-incident-dialog';
import {
  useAuditLabel,
  useReceptionError,
  useReceptionLabels,
  useReceptionTime,
} from './reception-bits';

/**
 * One delivery, in full.
 *
 * The section order is §31's, which is also the order a person asks the
 * questions: what is this, who brought it, was anything wrong, what did we
 * photograph, what came of it, and who touched it.
 *
 * Two things this page deliberately does NOT show: a product table, and any
 * hint of stock. The delivery note lists the articles and inventory counts
 * the shelves; a reception is neither of those, and putting either here is
 * what would turn it into both.
 */
export function ReceptionDetailView({
  reception,
  suppliers,
  transporters,
  products,
  incidentTypes,
  history,
  canEdit,
  canManageAll,
  canReportIncident,
  canSeeIncidents,
}: {
  reception: ReceptionDetail;
  suppliers: Supplier[];
  transporters: Transporter[];
  products: Product[];
  incidentTypes: IncidentType[];
  history: ReceptionAuditEntry[];
  canEdit: boolean;
  canManageAll: boolean;
  canReportIncident: boolean;
  /** Whether the linked incidents are readable, or only countable. */
  canSeeIncidents: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useReceptionLabels();
  const { date, time } = useReceptionTime();
  const translateError = useReceptionError();
  const auditLabel = useAuditLabel();

  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const completed = reception.status === 'completed';
  const verdict = canComplete({
    supplier_id: reception.supplier_id,
    condition: reception.condition,
    quantity_check: reception.quantity_check,
    comments: reception.comments,
    incident_count: reception.incidents?.length ?? 0,
  });

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(translateError(res.error ?? 'not_authorized'));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Link
        href="/goods-reception"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('gr.title')}
      </Link>

      <PageHeader
        title={reception.reception_number}
        subtitle={`${date(reception.received_at)} · ${time(reception.received_at)}`}
        action={
          canEdit ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('gr.save')}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusChip domain="reception" status={reception.status} />
        {reception.condition && <StatusChip domain="condition" status={reception.condition} />}
        <StatusChip domain="quantity" status={reception.quantity_check} />
      </div>

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      {/* §35, said rather than merely enforced. A page with the buttons
          quietly missing reads as a missing feature. */}
      {completed && !canManageAll && (
        <ReadOnlyNotice
          title={t('gr.completedNotice')}
          reason={t('gr.completedNoticeBody')}
          icon={<Lock className="h-4 w-4" aria-hidden />}
        />
      )}

      <div className="space-y-4">
        {/* ---------------------------- reception --------------------------- */}
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading title={t('gr.reception')} />
          </CardHeader>
          <CardBody>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={t('gr.supplier')} value={reception.supplier?.name ?? null} />
              <Detail
                label={t('gr.transporter')}
                value={reception.transporter?.name ?? null}
                absent={t('gr.noTransporter')}
              />
              <Detail label={t('gr.deliveryNote')} value={reception.delivery_note} mono />
              <Detail
                label={t('gr.receivedBy')}
                value={reception.receiver ? displayName(reception.receiver) : null}
              />
            </dl>
          </CardBody>
        </Card>

        {/* ------------------------------ checks ---------------------------- */}
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading title={t('gr.quantityCheck')} />
          </CardHeader>
          <CardBody>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={t('gr.condition')} value={labels.condition(reception.condition)} />
              <Detail label={t('gr.quantityCheck')} value={labels.quantity(reception.quantity_check)} />
            </dl>

            {reception.comments && (
              <div className="mt-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
                <p className="text-[11.5px] font-medium uppercase tracking-wide text-subtle">
                  {t('gr.comments')}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px]">{reception.comments}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* ---------------------------- exceptions -------------------------- */}
        <ExceptionEditor
          reception={reception}
          products={products}
          canEdit={canEdit}
        />

        {/* ----------------------------- evidence --------------------------- */}
        <EvidencePanel reception={reception} canEdit={canEdit} onError={setError} />

        {/* ----------------------------- incidents -------------------------- */}
        <Card>
          <CardHeader className="pb-0">
            <SectionHeading
              title={t('gr.incidents')}
              action={
                canReportIncident ? (
                  <Button size="sm" variant="secondary" onClick={() => setReporting(true)}>
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {t('gr.reportIncident')}
                  </Button>
                ) : undefined
              }
            />
          </CardHeader>
          <CardBody>
            {!canSeeIncidents && reception.incidents.length === 0 ? (
              // The rows are hidden by RLS, so a bare empty list would be a
              // lie. Saying so is the honest rendering of "count only".
              <p className="text-[13px] text-muted">{t('gr.incidentsHiddenBody')}</p>
            ) : reception.incidents.length === 0 ? (
              <p className="text-[13px] text-muted">{t('gr.noIncidents')}</p>
            ) : (
              <ul className="space-y-1.5">
                {reception.incidents.map((incident) => (
                  <li key={incident.id}>
                    <Link href={`/incidents/${incident.id}`} className="block">
                      <div className="rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-surface-2/40">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12.5px] font-semibold">
                            {incident.incident_number}
                          </span>
                          <StatusChip domain="severity" status={incident.severity} />
                          <StatusChip domain="incident" status={incident.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-[13px]">{incident.description}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* ------------------------------ actions --------------------------- */}
        {(canEdit || (completed && canManageAll)) && (
          <Card className="p-3.5">
            {completed ? (
              canManageAll && (
                <Button
                  variant="secondary"
                  loading={pending}
                  onClick={() => run(() => reopenReception(reception.id))}
                >
                  {t('gr.reopen')}
                </Button>
              )
            ) : (
              <div className="space-y-2">
                {!verdict.ok && (
                  <ul className="space-y-1">
                    {verdict.reasons.map((reason) => (
                      <li key={reason} className="text-[12.5px] text-late">
                        {translateError(reason)}
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto"
                  loading={pending}
                  disabled={!verdict.ok}
                  onClick={() => run(() => completeReception(reception.id))}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {t('gr.complete')}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* ------------------------------ history --------------------------- */}
        {history.length > 0 && (
          <Card>
            <CardHeader className="pb-0">
              <SectionHeading title={t('gr.history')} />
            </CardHeader>
            <CardBody>
              <ul className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px]">
                      {auditLabel(entry.action)}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-subtle">
                      {date(entry.created_at)} {time(entry.created_at)}
                      {entry.actor ? ` · ${displayName(entry.actor)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>

      {editing && (
        <ReceptionForm
          reception={reception}
          suppliers={suppliers}
          transporters={transporters}
          onClose={() => setEditing(false)}
        />
      )}

      {reporting && (
        <ReportIncidentDialog
          reception={reception}
          incidentTypes={incidentTypes}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}

function Detail({
  label,
  value,
  absent,
  mono,
}: {
  label: string;
  value: string | null;
  absent?: string;
  mono?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className={`mt-0.5 text-[13.5px] ${mono ? 'font-mono' : ''} ${value ? '' : 'text-muted'}`}>
        {value ?? absent ?? t('gr.notRecorded')}
      </dd>
    </div>
  );
}

/**
 * Photos.
 *
 * `capture="environment"` on the file input is what makes a phone open the
 * rear camera directly instead of the photo library — §19 and §50. It is a
 * hint rather than a guarantee: a desktop browser ignores it and shows a file
 * picker, which is the correct behaviour there.
 */
function EvidencePanel({
  reception,
  canEdit,
  onError,
}: {
  reception: ReceptionDetail;
  canEdit: boolean;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function upload(files: FileList | null) {
    if (!files?.length) return;

    startTransition(async () => {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('reception_id', reception.id);
        form.set('file', file);
        const res = await addReceptionEvidence(form);
        if (!res.ok) {
          onError(translateError(res.error));
          return;
        }
      }
      onError(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    });
  }

  // Only the gallery-level photos: one attached to an exception is shown
  // under that exception, beside the description it evidences.
  const loose = reception.evidence.filter((e) => !e.exception_id);

  return (
    <Card>
      <CardHeader className="pb-0">
        <SectionHeading
          title={t('gr.evidence')}
          action={
            canEdit ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => upload(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                  {t('gr.addPhoto')}
                </Button>
              </>
            ) : undefined
          }
        />
      </CardHeader>
      <CardBody>
        {loose.length === 0 ? (
          <p className="text-[13px] text-muted">{t('gr.noEvidence')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {loose.map((photo) => (
              <li key={photo.id} className="group relative">
                {photo.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.signed_url}
                    alt={photo.file_name}
                    loading="lazy"
                    className="aspect-square w-full rounded-lg border border-border object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border text-subtle">
                    <Camera className="h-5 w-5" aria-hidden />
                  </div>
                )}

                {canEdit && (
                  <button
                    type="button"
                    aria-label={t('gr.removePhoto')}
                    className="absolute right-1 top-1 rounded-md bg-bg/80 p-1 text-late opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteReceptionEvidence(photo.id, reception.id);
                        if (!res.ok) onError(translateError(res.error));
                        else router.refresh();
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
