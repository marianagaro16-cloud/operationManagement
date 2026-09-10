'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { displayName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/primitives';
import { reportIncidentFromReception } from '@/server/goods-reception-actions';
import type { ReceptionDetail } from '@/types/goods-reception';
import type { IncidentType } from '@/types/incidents';
import { useReceptionError, useReceptionTime } from './reception-bits';

/**
 * Raise an incident from a delivery — §24.
 *
 * DELIBERATELY SHORT. Type, severity, description, and nothing else.
 *
 * The person filling this in is standing at the pallet and is very often a
 * plain user with no incident capability at all; asking them for a primary
 * cause and a responsibility would be asking them to conduct the
 * investigation they are not authorised to conduct. Those fields belong to
 * whoever picks the incident up in the existing Incidents module, which is
 * where the rest of the workflow already lives and stays.
 *
 * Everything the reception already knows — supplier, transporter, delivery
 * note, arrival time, receiver — is attached server-side rather than copied
 * into the description, so it stays queryable instead of becoming prose.
 *
 * One reception may carry many of these. §23: three problems on one delivery
 * are three incidents, each independently analysable, and the dialog reopens
 * for the next one rather than encouraging a single merged paragraph.
 */
export function ReportIncidentDialog({
  reception,
  incidentTypes,
  onClose,
}: {
  reception: ReceptionDetail;
  incidentTypes: IncidentType[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = useReceptionError();
  const { date, time } = useReceptionTime();

  const [typeId, setTypeId] = useState(incidentTypes[0]?.id ?? '');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = typeId !== '' && description.trim().length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('gr.reportIncident')}
      description={reception.reception_number}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!ready}
            onClick={() =>
              startTransition(async () => {
                const res = await reportIncidentFromReception({
                  reception_id: reception.id,
                  incident_type_id: typeId,
                  description: description.trim(),
                  severity,
                  // The products already named as exceptions, so the incident
                  // starts out pointing at the same articles the receiver
                  // wrote down rather than at nothing.
                  product_ids: [
                    ...new Set(reception.exceptions.map((e) => e.product_id)),
                  ].slice(0, 20),
                });
                if (!res.ok) setError(translateError(res.error));
                else {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t('gr.reportIncident')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* What is being carried over, shown rather than assumed. The reader
            should not have to trust that the link was made. */}
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[12.5px]">
          <dl className="grid gap-1 sm:grid-cols-2">
            <Prefill label={t('gr.supplier')} value={reception.supplier?.name} />
            <Prefill label={t('gr.transporter')} value={reception.transporter?.name} />
            <Prefill label={t('gr.deliveryNote')} value={reception.delivery_note} />
            <Prefill
              label={t('gr.receivedBy')}
              value={reception.receiver ? displayName(reception.receiver) : null}
            />
            <Prefill
              label={t('gr.receivedAt')}
              value={`${date(reception.received_at)} ${time(reception.received_at)}`}
            />
          </dl>
        </div>

        <Field label={t('incident.typeLabel')} required>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {incidentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('incident.severityLabel')} required>
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
          >
            <option value="low">{t('incident.severity.low')}</option>
            <option value="medium">{t('incident.severity.medium')}</option>
            <option value="high">{t('incident.severity.high')}</option>
            <option value="critical">{t('incident.severity.critical')}</option>
          </Select>
        </Field>

        <Field label={t('gr.description')} required>
          <Textarea
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}

function Prefill({ label, value }: { label: string; value: string | null | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1.5">
      <dt className="text-subtle">{label}:</dt>
      <dd className={value ? '' : 'text-subtle'}>{value || t('gr.notRecorded')}</dd>
    </div>
  );
}
