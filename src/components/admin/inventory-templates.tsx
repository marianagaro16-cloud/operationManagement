'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, Checkbox, EmptyState, ErrorState, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { INVENTORY_FREQUENCIES, INVENTORY_KINDS } from '@/domain/inventory/types';
import {
  saveInventoryTemplate,
  setInventoryTemplateActive,
} from '@/server/inventory-actions';
import { useInventoryError } from '@/components/inventory/inventory-bits';
import { InventoryScheduleEditor } from './inventory-schedule-editor';
import type {
  InventoryFrequency,
  InventoryKind,
  InventorySchedule,
  InventoryTemplate,
} from '@/types/inventory';

type Row = InventoryTemplate & { item_count: number; assignee_ids: string[] };

const KIND_LABEL: Record<InventoryKind, MessageKey> = {
  expiry: 'inventory.kindExpiry',
  lot: 'inventory.kindLot',
  location: 'inventory.kindLocation',
};

const FREQ_LABEL: Record<InventoryFrequency, MessageKey> = {
  weekly: 'inventory.freqWeekly',
  biweekly: 'inventory.freqBiweekly',
  monthly: 'inventory.freqMonthly',
  semiannual: 'inventory.freqSemiannual',
};

/**
 * Admin template management.
 *
 * Everything the specification calls "must not be hard-coded" is edited here:
 * the cadence, the schedule, whether Inventory Digital applies, and whether
 * the template is active at all. Nothing about the five initial inventories is
 * special-cased in code — they are rows created by the import script.
 */
export function InventoryTemplateManager({
  templates,
}: {
  templates: Row[];
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{t('inventory.templates')}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('inventory.templateNew')}
          </Button>
        </div>
      </div>

      {message && <p className="text-[13px] text-done">{message}</p>}
      {error && <ErrorState message={error} />}

      {templates.length === 0 ? (
        <EmptyState title={t('inventory.templates')} />
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => {
            return (
              <li key={tpl.id}>
                <Card className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{tpl.name}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {t(FREQ_LABEL[tpl.frequency])} · {t(KIND_LABEL[tpl.kind])} ·{' '}
                        {t('inventory.itemsCounted', { count: tpl.item_count })}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {tpl.digital_enabled && (
                        <Badge tone="accent">{t('inventory.inventoryDigital')}</Badge>
                      )}
                      {!tpl.is_active && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(tpl)}>
                      {t('common.edit')}
                    </Button>
                    <Link href={`/admin/inventory/${tpl.id}`}>
                      <Button size="sm" variant="ghost">
                        {t('inventory.items')}
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        startTransition(async () => {
                          const res = await setInventoryTemplateActive(tpl.id, !tpl.is_active);
                          if (!res.ok) setError(translateError(res.error));
                        })
                      }
                    >
                      {tpl.is_active ? t('inventory.deactivate') : t('inventory.activate')}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <TemplateDialog
          template={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  template,
  onClose,
}: {
  template: Row | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const translateError = useInventoryError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(template?.name ?? '');
  const [slug, setSlug] = useState(template?.slug ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [nameDe, setNameDe] = useState(template?.translations?.de?.name ?? '');
  const [nameEn, setNameEn] = useState(template?.translations?.en?.name ?? '');
  const [kind, setKind] = useState<InventoryKind>(template?.kind ?? 'expiry');
  const [frequency, setFrequency] = useState<InventoryFrequency>(template?.frequency ?? 'weekly');
  const [schedule, setSchedule] = useState<InventorySchedule | null>(
    template?.schedule_config ?? null,
  );
  const [digitalEnabled, setDigitalEnabled] = useState(template?.digital_enabled ?? false);
  const [isActive, setIsActive] = useState(template?.is_active ?? true);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveInventoryTemplate(
        {
          slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: name.trim(),
          description: description.trim() || null,
          translations: {
            de: { name: nameDe.trim() || null },
            en: { name: nameEn.trim() || null },
          },
          kind,
          frequency,
          schedule_config: schedule,
          digital_enabled: digitalEnabled,
          is_active: isActive,
        },
        template?.id,
      );
      if (res.ok) onClose();
      else setError(translateError(res.error));
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={template ? t('inventory.templateEdit') : t('inventory.templateNew')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('inventory.itemName')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deutsch" hint={t('admin.translationsHint')}>
            <Input value={nameDe} onChange={(e) => setNameDe(e.target.value)} />
          </Field>
          <Field label="English">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>

        <Field label={t('common.filter')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label={t('inventory.kind')} hint={t('inventory.kindHint')}>
          {/* Locked once inventories exist: changing it would make every past
              count mean something different from what was recorded. */}
          <Select
            value={kind}
            disabled={Boolean(template)}
            onChange={(e) => setKind(e.target.value as InventoryKind)}
          >
            {INVENTORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABEL[k])}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('inventory.frequency')}>
          <Select
            value={frequency}
            onChange={(e) => {
              const next = e.target.value as InventoryFrequency;
              setFrequency(next);
              // A schedule belongs to one frequency; keeping the old one would
              // fail validation on save with a confusing message.
              setSchedule(null);
            }}
          >
            {INVENTORY_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(FREQ_LABEL[f])}
              </option>
            ))}
          </Select>
        </Field>

        <InventoryScheduleEditor
          frequency={frequency}
          schedule={schedule}
          onChange={setSchedule}
        />

        <Checkbox
          label={t('inventory.digitalEnabled')}
          hint={t('inventory.digitalEnabledHint')}
          checked={digitalEnabled}
          onChange={(e) => setDigitalEnabled(e.target.checked)}
        />

        <Checkbox
          label={t('status.active')}
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />

        {error && <p className="text-[12px] text-late">{error}</p>}
      </div>
    </Dialog>
  );
}
