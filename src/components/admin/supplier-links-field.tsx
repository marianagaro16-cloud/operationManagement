'use client';

import { X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/primitives';
import type { Supplier } from '@/types/goods-reception';

export interface SupplierLink {
  supplier_id: string;
  is_main: boolean;
  supplier_code: string | null;
}

/**
 * Who we buy something from: a product, or a raw material / packaging item.
 * Several suppliers, at most one main, each with their article code. The
 * office only — the caller decides whether to show it.
 */
export function SupplierLinksField({
  name,
  options,
  links,
  onChange,
}: {
  /** Radio group name, unique on the page. */
  name: string;
  options: Supplier[];
  links: SupplierLink[];
  onChange: (links: SupplierLink[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={t('productSuppliers.title')} hint={t('productSuppliers.hint')}>
      <div className="space-y-1.5">
        {links.map((link, index) => (
          <div key={link.supplier_id} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input
                type="radio"
                name={name}
                className="h-4 w-4 accent-accent"
                checked={link.is_main}
                onChange={() => onChange(links.map((l, i) => ({ ...l, is_main: i === index })))}
              />
              {t('productSuppliers.main')}
            </label>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {options.find((s) => s.id === link.supplier_id)?.name ?? '—'}
            </span>
            <Input
              aria-label={t('productSuppliers.code')}
              placeholder={t('productSuppliers.code')}
              value={link.supplier_code ?? ''}
              onChange={(e) => onChange(links.map((l, i) => (i === index ? { ...l, supplier_code: e.target.value } : l)))}
              className="max-w-[9rem]"
            />
            <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => onChange(links.filter((_, i) => i !== index))}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}
        <Select
          aria-label={t('productSuppliers.add')}
          value=""
          onChange={(e) =>
            e.target.value &&
            onChange([...links, { supplier_id: e.target.value, is_main: links.length === 0, supplier_code: null }])
          }
        >
          <option value="">{t('productSuppliers.add')}</option>
          {options
            .filter((s) => s.is_active && !links.some((l) => l.supplier_id === s.id))
            .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
    </Field>
  );
}

/** What to send: codes trimmed, empty is null. */
export function cleanLinks(links: SupplierLink[]): SupplierLink[] {
  return links.map((l) => ({ ...l, supplier_code: l.supplier_code?.trim() || null }));
}
