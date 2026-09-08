'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import type { Customer, Product } from '@/types/orders';
import type { IncidentCategory, IncidentType } from '@/types/incidents';
import { IncidentDialog, type OrderContext } from './incident-dialog';

/**
 * "Report incident", on the order's own header.
 *
 * It lived at the foot of the page next to the list of existing incidents,
 * which put the ACTION next to the RECORD — tidy, and wrong: on an order with
 * no incidents there was nothing to draw the eye down there, so the one moment
 * somebody needs this button is exactly the moment they cannot find it.
 *
 * It sits beside Edit now. Both are things you do TO this order, and that is
 * where a person looks for them.
 *
 * A component of its own because the dialog needs state and the order page is
 * a Server Component. The page passes this element down as the header action.
 */
export function ReportIncidentButton({
  order,
  customers,
  products,
  categories,
  types,
}: {
  order: OrderContext;
  customers: Customer[];
  products: Product[];
  categories: IncidentCategory[];
  types: IncidentType[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {t('incident.reportForOrder')}
      </Button>

      {open && (
        <IncidentDialog
          customers={customers}
          products={products}
          categories={categories}
          types={types}
          order={order}
          onClose={() => setOpen(false)}
          onSaved={(id) => { setOpen(false); router.push(`/incidents/${id}`); }}
        />
      )}
    </>
  );
}
