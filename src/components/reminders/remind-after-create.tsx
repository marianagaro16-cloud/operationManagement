'use client';

import { BellPlus } from 'lucide-react';
import { useI18n } from '@/i18n';

/**
 * "Create a reminder for this …" on a form that creates something: once it is
 * saved, the reminder form opens linked to it (the caller renders it).
 */
export function RemindAfterCreate({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { t } = useI18n();
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="h-4 w-4 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <BellPlus className="h-3.5 w-3.5 text-muted" aria-hidden />
      {label || t('reminder.new')}
    </label>
  );
}
