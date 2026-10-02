'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { DateTime } from 'luxon';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/primitives';

type Kind = 'workers' | 'arrivals' | 'evaluations';

/**
 * Human resources to Excel: the worker list, or the arrivals or evaluations
 * of a period. The file is built under the viewer's own access.
 */
export function HrExport() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const today = DateTime.now().setZone('Europe/Zurich');
  const [kind, setKind] = useState<Kind>('arrivals');
  const [from, setFrom] = useState(today.startOf('month').toISODate()!);
  const [to, setTo] = useState(today.toISODate()!);

  const choose = (k: Kind) => {
    setKind(k);
    // The usual periods: a month of arrivals, a year of evaluations.
    setFrom((k === 'evaluations' ? today.startOf('year') : today.startOf('month')).toISODate()!);
    setTo(today.toISODate()!);
  };
  const href = `/hr/export?kind=${kind}${kind === 'workers' ? '' : `&from=${from}&to=${to}`}`;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Download className="h-3.5 w-3.5" aria-hidden />
        {t('hrExport.export')}
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={t('hrExport.title')}
          description={t('hrExport.hint')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <a
                href={href}
                download
                onClick={() => setTimeout(() => setOpen(false), 300)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-accent-fg hover:opacity-90"
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
                {t('hrExport.download')}
              </a>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-1.5">
              {(['arrivals', 'evaluations', 'workers'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-[13.5px]">
                  <input type="radio" name="hr-export" className="h-4 w-4 accent-accent" checked={kind === k} onChange={() => choose(k)} />
                  {t(k === 'arrivals' ? 'hrExport.arrivals' : k === 'evaluations' ? 'hrExport.evaluations' : 'hrExport.workers')}
                </label>
              ))}
            </div>
            {kind !== 'workers' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('hrExport.from')} htmlFor="hr-exp-from">
                  <Input id="hr-exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label={t('hrExport.to')} htmlFor="hr-exp-to">
                  <Input id="hr-exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
