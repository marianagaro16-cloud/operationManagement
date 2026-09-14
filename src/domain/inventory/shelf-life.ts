import { DateTime } from 'luxon';
import { BUSINESS_TZ, type BusinessDate } from '@/lib/datetime';

/**
 * Stock close to its expiry date.
 *
 * Pure, so the rule that decides what gets flagged is tested rather than
 * assembled in a component. Used both by the alert sent when a count is
 * completed and by the inventory page, which shows the same list — one
 * definition, so the notification and the screen cannot disagree.
 */

export interface ShelfLifeItem {
  id: string;
  item_name: string;
  entries: { quantity: number | null; expiry_date: string | null }[];
}

export interface ShortShelfLifeLine {
  itemId: string;
  itemName: string;
  expiryDate: BusinessDate;
  /** Units counted with this expiry date, across every entry that has it. */
  quantity: number;
  /** Negative once already expired on the count date. */
  daysLeft: number;
}

/** The first date that is NOT short: the count date plus the window. */
export function shelfLifeThreshold(countDate: BusinessDate, months: number): BusinessDate {
  return DateTime.fromISO(countDate, { zone: BUSINESS_TZ }).plus({ months }).toISODate()!;
}

/**
 * Every counted batch that expires less than `months` after the count date.
 *
 * Measured from the day the count was scheduled, not from whenever somebody
 * looks at the screen: the question is what the count found, and the answer
 * must not change on its own a week later.
 *
 * Entries with no quantity, or a counted zero, are not stock and are never
 * flagged. Two entries for the same product and date — counted in two places
 * — are one batch and are added together. Already-expired stock is included:
 * it is the most urgent case, not an exception.
 */
export function shortShelfLife(
  items: readonly ShelfLifeItem[],
  countDate: BusinessDate,
  months: number,
): ShortShelfLifeLine[] {
  const threshold = shelfLifeThreshold(countDate, months);
  const start = DateTime.fromISO(countDate, { zone: BUSINESS_TZ });
  const batches = new Map<string, ShortShelfLifeLine>();

  for (const item of items) {
    for (const entry of item.entries) {
      if (!entry.expiry_date || !entry.quantity || entry.quantity <= 0) continue;
      if (entry.expiry_date >= threshold) continue;

      const key = `${item.id}:${entry.expiry_date}`;
      const line = batches.get(key) ?? {
        itemId: item.id,
        itemName: item.item_name,
        expiryDate: entry.expiry_date,
        quantity: 0,
        daysLeft: Math.round(DateTime.fromISO(entry.expiry_date, { zone: BUSINESS_TZ }).diff(start, 'days').days),
      };
      line.quantity += entry.quantity;
      batches.set(key, line);
    }
  }

  // Soonest to expire first: that is the order anybody acts in.
  return [...batches.values()].sort(
    (a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.itemName.localeCompare(b.itemName),
  );
}

/**
 * Push text, Spanish like every other inventory alert — the payload is built on
 * the server, where there is no reader's language to use.
 */
export function shortShelfLifeAlert(
  name: string,
  isoWeek: number,
  months: number,
  lines: readonly ShortShelfLifeLine[],
): { title: string; body: string } {
  const products = new Set(lines.map((l) => l.itemId)).size;
  const first = lines.slice(0, 3).map((l) => {
    const date = DateTime.fromISO(l.expiryDate).toFormat('dd.MM.yyyy');
    return `${l.itemName} (${date})`;
  });
  const more = lines.length > 3 ? ` y ${lines.length - 3} más` : '';
  return {
    title: `${name} — caducidad corta`,
    body: `${products} ${products === 1 ? 'producto vence' : 'productos vencen'} en menos de ${months} meses · KW ${isoWeek}: ${first.join(', ')}${more}`,
  };
}
