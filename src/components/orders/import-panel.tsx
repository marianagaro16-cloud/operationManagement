'use client';

import { useRef, useState, useTransition } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ErrorState, Field, Select, Spinner, Textarea } from '@/components/ui/primitives';
import { previewOrderRequestFile, previewOrderText } from '@/server/import-actions';
import type { PreviewLine } from '@/domain/orders/import/pipeline';
import type { Product } from '@/types/orders';
import { ImportPreview } from './import-preview';

/**
 * Methods B and C — import an Order Request file, or paste order text.
 *
 * Both end in the SAME preview and both hand their accepted lines back to the
 * order form, which is the only thing that creates an order. Neither writes
 * anything; the actions they call are reads.
 *
 * The customer is whatever the order form has selected. It is never derived
 * from the file or the message — a forwarded email carries the forwarder's
 * address, and an order attributed to the wrong restaurant is discovered at
 * the delivery door.
 */

export type ImportMethod = 'excel' | 'email';

/** Every error the two actions can return, as a translated sentence. */
const ERROR_LABEL: Record<string, MessageKey> = {
  not_authorized: 'import.errNotAuthorized',
  invalid_input: 'import.errInvalidInput',
  file_too_large: 'import.errFileTooLarge',
  unreadable_file: 'import.errUnreadableFile',
  template_not_identified: 'import.errTemplateNotIdentified',
  sheet_not_found: 'import.errSheetNotFound',
  product_column_not_found: 'import.errProductColumn',
  quantity_column_not_found: 'import.errQuantityColumn',
  no_lines_detected: 'import.errNoLines',
  import_failed: 'import.errFailed',
};

export function ImportPanel({
  method,
  customerId,
  products,
  onImported,
  onCancel,
}: {
  method: ImportMethod;
  /** Empty until the user picks a customer, which is required first. */
  customerId: string;
  products: Product[];
  /** Accepted lines, plus how they arrived, for the order's provenance. */
  onImported: (lines: PreviewLine[], source: ImportMethod) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<PreviewLine[] | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  /** Offered when several of the customer's templates fit one file. */
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  const [text, setText] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  const show = (code: string) => setError(t(ERROR_LABEL[code] ?? 'import.errFailed'));

  function runFile(file: File, templateId?: string) {
    lastFile.current = file;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set('customer_id', customerId);
      form.set('file', file);
      if (templateId) form.set('template_id', templateId);

      const res = await previewOrderRequestFile(form);
      if (!res.ok) return show(res.error);

      // Several templates fit. The user picks; the importer does not guess.
      if (res.data.choices?.length) {
        setChoices(res.data.choices);
        setLines(null);
        return;
      }
      setChoices([]);
      setTemplateName(res.data.templateName);
      setLines(res.data.lines);
    });
  }

  function runText() {
    setError(null);
    startTransition(async () => {
      const res = await previewOrderText({ customer_id: customerId, text });
      if (!res.ok) return show(res.error);
      setTemplateName(null);
      setLines(res.data.lines);
    });
  }

  // The customer decides which aliases and which templates apply, so it has
  // to be chosen before there is anything to import against.
  if (!customerId) {
    return (
      <Panel onCancel={onCancel}>
        <p className="text-[13px] text-muted">{t('import.chooseCustomerFirst')}</p>
      </Panel>
    );
  }

  if (lines) {
    return (
      <Panel onCancel={onCancel} showBack={false}>
        <ImportPreview
          lines={lines}
          onLinesChange={setLines}
          products={products}
          templateName={templateName}
          onConfirm={(accepted) => onImported(accepted, method)}
          onCancel={onCancel}
        />
      </Panel>
    );
  }

  return (
    <Panel onCancel={onCancel}>
      {method === 'excel' ? (
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">{t('import.excelHint')}</p>

          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file twice fires again — the
              // second attempt after a correction is a normal thing to do.
              e.target.value = '';
              if (file) runFile(file);
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={pending}>
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {t('import.chooseFile')}
          </Button>

          {choices.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/[0.05] px-3 py-2.5">
              <p className="mb-2 text-[12.5px]">{t('import.templateAmbiguous')}</p>
              <Field label={t('import.template')} htmlFor="i-tpl">
                <Select
                  id="i-tpl"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && lastFile.current) runFile(lastFile.current, id);
                  }}
                >
                  <option value="">—</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">{t('import.emailHint')}</p>
          <Field label={t('import.pasteLabel')} htmlFor="i-text">
            <Textarea
              id="i-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={t('import.pastePlaceholder')}
            />
          </Field>
          <Button variant="secondary" onClick={runText} disabled={pending || !text.trim()}>
            <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
            {t('import.readText')}
          </Button>
        </div>
      )}

      {pending && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner /> {t('import.reading')}
        </p>
      )}
      {error && <div className="mt-3"><ErrorState message={error} /></div>}
    </Panel>
  );
}

function Panel({
  children,
  onCancel,
  showBack = true,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  /** Hidden while the preview is up — it carries its own Cancel. */
  showBack?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      {children}
      {showBack && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('import.backToManual')}
          </Button>
        </div>
      )}
    </div>
  );
}
