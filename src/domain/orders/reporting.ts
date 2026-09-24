import { DateTime } from 'luxon';
import { BUSINESS_TZ, parseBusinessDate, toBusinessDate, type BusinessDate } from '@/lib/datetime';
import { lineProgress, toQuantity } from './progress';
import { roundKg } from './weight';
import { productLabel, type Order, type ProductCategory, type ProductSubcategory } from '@/types/orders';

/**
 * Order reporting.
 *
 * Pure and free of I/O, like the recurrence engine, so the numbers the
 * business will act on are unit-tested rather than assembled inside a
 * component.
 *
 * Reports are keyed on DELIVERY date: this answers "what did we sell and
 * ship", which is a commercial question. Lotnummerkontrol remains the
 * preparation-date view.
 *
 * Quantities stay counts of packages in each product's own presentation and
 * are never converted or summed across different presentations — 3 boxes and
 * 2 kilos are not 5 of anything.
 */

export type ReportPeriod = 'day' | 'week' | 'month' | 'year' | 'custom';

/** Longest custom range accepted, so a typo cannot ask for a decade. */
export const MAX_CUSTOM_DAYS = 731;

export interface PeriodRange {
  kind: ReportPeriod;
  start: BusinessDate;
  end: BusinessDate;
  /** Stable identifier: 2026-09-03 | 2026-W36 | 2026-09 | 2026 | a range. */
  key: string;
  /** Set when a custom range was clamped to MAX_CUSTOM_DAYS. */
  clamped?: boolean;
}

/**
 * Inclusive Europe/Zurich bounds of the period containing `date`.
 *
 * 'custom' is not a period around a date, so it is built by customRange()
 * and passing it here falls back to the month — the caller should not be
 * asking this question.
 */
export function periodRange(kind: ReportPeriod, date: BusinessDate): PeriodRange {
  const dt = parseBusinessDate(date);
  switch (kind) {
    case 'day':
      return { kind, start: date, end: date, key: date };
    case 'week':
      return {
        kind,
        start: toBusinessDate(dt.startOf('week')),
        end: toBusinessDate(dt.endOf('week')),
        key: `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, '0')}`,
      };
    case 'month':
      return {
        kind,
        start: toBusinessDate(dt.startOf('month')),
        end: toBusinessDate(dt.endOf('month')),
        key: dt.toFormat('yyyy-MM'),
      };
    case 'year':
      return {
        kind,
        start: toBusinessDate(dt.startOf('year')),
        end: toBusinessDate(dt.endOf('year')),
        key: dt.toFormat('yyyy'),
      };
    case 'custom':
      // A custom range needs two dates; treat a single one as that month.
      return {
        ...periodRange('month', date),
        kind: 'custom',
      };
  }
}

/**
 * An explicit from–to range.
 *
 * Reversed dates are swapped rather than rejected: someone picking the end
 * date first is expressing a range, not an error. Over-long ranges are
 * clamped and flagged so the report says so instead of silently truncating.
 */
export function customRange(from: BusinessDate, to: BusinessDate): PeriodRange {
  let a = parseBusinessDate(from);
  let b = parseBusinessDate(to);
  if (b < a) [a, b] = [b, a];

  let clamped = false;
  const days = Math.round(b.diff(a, 'days').days) + 1;
  if (days > MAX_CUSTOM_DAYS) {
    b = a.plus({ days: MAX_CUSTOM_DAYS - 1 });
    clamped = true;
  }

  const start = toBusinessDate(a);
  const end = toBusinessDate(b);
  return { kind: 'custom', start, end, key: `${start}_${end}`, clamped };
}

/** Move a whole period forward or back, for previous/next navigation. */
export function shiftPeriod(kind: ReportPeriod, date: BusinessDate, delta: number): BusinessDate {
  const dt = parseBusinessDate(date);
  const unit =
    kind === 'day' ? 'days'
      : kind === 'week' ? 'weeks'
        : kind === 'year' ? 'years'
          : 'months';
  return toBusinessDate(dt.plus({ [unit]: delta }));
}

/** Slide a custom range by its own length, keeping the span identical. */
export function shiftCustomRange(range: PeriodRange, delta: number): PeriodRange {
  const a = parseBusinessDate(range.start);
  const b = parseBusinessDate(range.end);
  const days = Math.round(b.diff(a, 'days').days) + 1;
  return customRange(
    toBusinessDate(a.plus({ days: days * delta })),
    toBusinessDate(b.plus({ days: days * delta })),
  );
}

export interface BrandLine {
  /** The brand id, or null for products nobody has classified yet. */
  brandId: string | null;
  name: string | null;
  ordered: number;
  prepared: number;
  /** How many distinct products of this brand were ordered. */
  products: number;
  lines: number;
}

export interface ProductLine {
  productId: string;
  code: string | null;
  name: string;
  /** The brand this product sells under, or null if nobody classified it. */
  brand: string | null;
  /** Category and subcategory, ids and names; null while unclassified. */
  categoryId: string | null;
  category: string | null;
  subcategoryId: string | null;
  subcategory: string | null;
  /** Units customers asked for. */
  ordered: number;
  /** Units actually allocated to lots. */
  prepared: number;
  /** ordered - prepared, floored at zero. */
  missing: number;
  /** How many order lines this product appeared on. */
  lines: number;
  /** How many distinct customers bought it. */
  customers: number;
}

/**
 * How the product table is grouped: not at all, by category (all tortillas),
 * or by subcategory within its category (Ø14 Gelb tortillas).
 */
export type ProductGrouping = 'none' | 'category' | 'subcategory';

export const PRODUCT_GROUPINGS: ProductGrouping[] = ['none', 'category', 'subcategory'];

/**
 * Several products added up.
 *
 * In units, as the business chose — a 0.5 kg and a 1 kg pack of Ø14
 * tortillas are two units. Products nobody has classified form their own
 * group rather than being dropped, so the groups still add up to the
 * period's total.
 */
export interface ProductGroup {
  /** Stable React/CSV key. */
  key: string;
  categoryId: string | null;
  /** Null for the unclassified group. */
  category: string | null;
  subcategoryId: string | null;
  /** Null when grouping by category, or for products with no subcategory. */
  subcategory: string | null;
  ordered: number;
  prepared: number;
  /** Sum of each product's missing units: one product over-prepared does not cover another's shortage. */
  missing: number;
  lines: number;
  /** Distinct customers across the group, not the sum of each product's. */
  customers: number;
  products: ProductLine[];
}

/** The category and subcategory lists, so the report can name and order groups. */
export interface ProductTaxonomy {
  categories: ProductCategory[];
  subcategories: ProductSubcategory[];
}

export interface CustomerLine {
  customerId: string;
  name: string;
  orders: number;
  lines: number;
  ordered: number;
}

export interface BoxTypeLine {
  boxTypeId: string;
  name: string;
  boxes: number;
}

export interface CountLine {
  key: string;
  label: string;
  orders: number;
}

export interface DayLine {
  date: BusinessDate;
  orders: number;
  ordered: number;
}

export interface MonthLine {
  /** YYYY-MM */
  month: string;
  orders: number;
  ordered: number;
}

/** Beyond this many days a per-day list is unreadable, so months are used. */
export const DAY_BREAKDOWN_LIMIT = 62;

export interface OrderReport {
  range: PeriodRange;

  /** Orders that count as real business: everything except cancelled. */
  orders: number;
  cancelled: number;
  draft: number;
  samples: number;
  /** Free deliveries sent to make good. Counted apart from sales. */
  replacements: number;
  /**
   * Free deliveries given in exchange for visibility — an event, a team, a
   * fair. Counted apart from sales for the same reason as the two above, and
   * apart from samples because nobody is expected to buy afterwards.
   */
  sponsorships: number;
  /**
   * Deliveries that left but are not sold yet — the goods sit on the
   * customer's shelf as ours until they sell them, and what does not sell
   * comes back. Counted apart from sales because booking them as trade
   * would count revenue nobody has earned, and apart from the free types
   * because nothing was given away.
   */
  consignments: number;
  customersServed: number;
  lines: number;

  /** Units ordered and prepared across every counted line. */
  totalOrdered: number;
  totalPrepared: number;
  /**
   * Net kg of the units ordered, on exactly the lines totalOrdered counts.
   * Partial while some products have no weight: see productsWithoutWeight.
   */
  totalWeightKg: number;
  /** Distinct products on counted lines that have no weight yet, so are left out of totalWeightKg. */
  productsWithoutWeight: number;
  /** Boxes the counted orders were packed in, all types together. */
  totalBoxes: number;
  /** Boxes per box type, most used first. */
  byBoxType: BoxTypeLine[];
  /** Lines where less was prepared than ordered, including products left out with a reason. */
  shortLines: number;
  /** Of those, the ones with no explanation recorded. */
  unexplainedShortLines: number;
  /** Percentage of ordered units actually prepared. */
  fulfilmentRate: number;

  byProduct: ProductLine[];
  /** byProduct grouped by category. */
  byCategory: ProductGroup[];
  /** byProduct grouped by subcategory, within its category. */
  bySubcategory: ProductGroup[];
  /**
   * Units and orders per brand.
   *
   * The question the brand field exists to answer: how did Del Barrio do this
   * month. Products with no brand recorded are counted under a single
   * unclassified row rather than dropped, so the totals still reconcile — a
   * breakdown that quietly loses volume is worse than one that shows a gap.
   */
  byBrand: BrandLine[];
  byCustomer: CustomerLine[];
  byDeliveryMethod: CountLine[];
  /** Empty for ranges longer than DAY_BREAKDOWN_LIMIT; use byMonth instead. */
  byDay: DayLine[];
  /** Populated only for ranges too long for a per-day list. */
  byMonth: MonthLine[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Keep only the lines of one product, and only the orders that carry it.
 *
 * Unlike the Orders screen's brand filter, a REPORT filtered by product must
 * trim the lines: "units ordered" of a product cannot include the other seven
 * things on the same order, and 3 boxes of one product and 2 kilos of another
 * are not 5 of anything.
 */
export function narrowToProduct<T extends Order>(orders: T[], productId: string): T[] {
  return orders.flatMap((o) => {
    const lines = (o.lines ?? []).filter((l) => l.product_id === productId);
    return lines.length > 0 ? [{ ...o, lines }] : [];
  });
}

/**
 * Keep only the lines of one brand, and only the orders that carry it.
 *
 * Trims lines for the same reason narrowToProduct does. 'none' keeps the
 * products nobody has classified — the Lot Tracker's convention — so the
 * brand filters together still cover every line.
 */
export function narrowToBrand<T extends Order>(orders: T[], brand: string): T[] {
  return orders.flatMap((o) => {
    const lines = (o.lines ?? []).filter((l) =>
      brand === 'none' ? !l.product?.brand_id : l.product?.brand_id === brand,
    );
    return lines.length > 0 ? [{ ...o, lines }] : [];
  });
}

/**
 * Aggregate a set of orders into a report.
 *
 * Cancelled orders are excluded from every quantity and from the product and
 * customer breakdowns — they were not sold — but are still counted, because
 * "we cancelled six orders this month" is itself worth seeing.
 */
export function computeOrderReport(
  orders: Order[],
  range: PeriodRange,
  taxonomy: ProductTaxonomy = { categories: [], subcategories: [] },
): OrderReport {
  const categoryById = new Map(taxonomy.categories.map((c) => [c.id, c]));
  const subcategoryById = new Map(taxonomy.subcategories.map((s) => [s.id, s]));
  const counted = orders.filter((o) => o.status !== 'cancelled');

  const products = new Map<string, ProductLine & { customerIds: Set<string> }>();
  const brands = new Map<string, BrandLine & { productIds: Set<string> }>();
  const customers = new Map<string, CustomerLine>();
  const methods = new Map<string, CountLine>();
  const days = new Map<BusinessDate, DayLine>();

  let lines = 0;
  let totalOrdered = 0;
  let totalPrepared = 0;
  let shortLines = 0;
  let unexplainedShortLines = 0;
  let totalWeightKg = 0;
  let totalBoxes = 0;
  const boxTypes = new Map<string, BoxTypeLine>();
  const unweighed = new Set<string>();

  for (const order of counted) {
    // --- per order ---
    const cust = customers.get(order.customer_id) ?? {
      customerId: order.customer_id,
      name: order.customer?.name ?? '—',
      orders: 0,
      lines: 0,
      ordered: 0,
    };
    cust.orders++;
    customers.set(order.customer_id, cust);

    const methodKey = order.delivery_method_id ?? '__none__';
    const method = methods.get(methodKey) ?? {
      key: methodKey,
      label: order.delivery_method?.name ?? '',
      orders: 0,
    };
    method.orders++;
    methods.set(methodKey, method);

    const day = days.get(order.delivery_date) ?? {
      date: order.delivery_date,
      orders: 0,
      ordered: 0,
    };
    day.orders++;

    for (const box of order.boxes ?? []) {
      totalBoxes += box.quantity;
      const line = boxTypes.get(box.box_type_id) ?? { boxTypeId: box.box_type_id, name: box.box_type?.name ?? '—', boxes: 0 };
      line.boxes += box.quantity;
      boxTypes.set(box.box_type_id, line);
    }

    // --- per line ---
    for (const line of order.lines ?? []) {
      lines++;
      cust.lines++;

      // The SAME rule the dashboard, the preparation screen and the notifier
      // use. This used to re-derive "prepared" and "short" independently,
      // which agreed with lineProgress() only by coincidence.
      const progress = lineProgress(
        line.ordered_quantity,
        line.allocations ?? [],
        line,
      );
      const ordered = progress.ordered;
      const prepared = progress.allocated;
      totalOrdered += ordered;
      totalPrepared += prepared;
      const kg = line.product?.net_weight_kg;
      if (kg === null || kg === undefined || kg === '') {
        if (ordered > 0) unweighed.add(line.product_id);
      } else {
        totalWeightKg += ordered * Number(kg);
      }
      cust.ordered += ordered;
      day.ordered += ordered;

      if (progress.status === 'partial' || progress.notSent) {
        shortLines++;
        if (progress.needsReason) unexplainedShortLines++;
      }

      const p = products.get(line.product_id) ?? {
        productId: line.product_id,
        code: line.product?.code ?? null,
        // productLabel() is the one implementation of "what is this product
        // called". This used to inline a shortened copy of it that dropped the
        // presentation, so the report named a product differently from every
        // screen that showed it.
        name: line.product ? productLabel(line.product) : '—',
        brand: line.product?.brand?.name ?? null,
        // An id the taxonomy does not know reads as unclassified rather than
        // as a group with no name.
        ...classification(line.product?.category_id, line.product?.subcategory_id, categoryById, subcategoryById),
        ordered: 0,
        prepared: 0,
        missing: 0,
        lines: 0,
        customers: 0,
        customerIds: new Set<string>(),
      };
      p.ordered += ordered;
      p.prepared += prepared;
      p.lines++;
      p.customerIds.add(order.customer_id);
      products.set(line.product_id, p);

      // Unclassified products share one bucket rather than being dropped, so
      // the brand rows still add up to the period's total.
      const brandKey = line.product?.brand_id ?? '__none__';
      const b = brands.get(brandKey) ?? {
        brandId: line.product?.brand_id ?? null,
        name: line.product?.brand?.name ?? null,
        ordered: 0,
        prepared: 0,
        products: 0,
        lines: 0,
        productIds: new Set<string>(),
      };
      b.ordered += ordered;
      b.prepared += prepared;
      b.lines++;
      b.productIds.add(line.product_id);
      brands.set(brandKey, b);
    }

    days.set(order.delivery_date, day);
  }

  const withCustomers = [...products.values()]
    .map(({ customerIds, ...p }) => ({
      line: {
        ...p,
        ordered: round3(p.ordered),
        prepared: round3(p.prepared),
        missing: round3(Math.max(0, p.ordered - p.prepared)),
        customers: customerIds.size,
      },
      customerIds,
    }))
    // Most sold first: that is the question this table exists to answer.
    .sort((a, b) => b.line.ordered - a.line.ordered || a.line.name.localeCompare(b.line.name));
  const byProduct: ProductLine[] = withCustomers.map((p) => p.line);

  const byCustomer = [...customers.values()]
    .map((c) => ({ ...c, ordered: round3(c.ordered) }))
    .sort((a, b) => b.ordered - a.ordered || a.name.localeCompare(b.name));

  const byDeliveryMethod = [...methods.values()].sort((a, b) => b.orders - a.orders);

  // A per-day list is unreadable past a couple of months, so a long range
  // (a year, or a wide custom span) is bucketed by month instead. Exactly
  // one of the two is populated.
  const rangeStart = parseBusinessDate(range.start);
  const rangeEnd = parseBusinessDate(range.end);
  const spanDays = Math.round(rangeEnd.diff(rangeStart, 'days').days) + 1;
  const useDays = spanDays <= DAY_BREAKDOWN_LIMIT;

  const byDay: DayLine[] = [];
  const byMonth: MonthLine[] = [];

  if (useDays) {
    // Every day in the range, so a gap reads as a genuine zero rather than a
    // missing row.
    for (let d = rangeStart; d <= rangeEnd; d = d.plus({ days: 1 })) {
      const key = toBusinessDate(d);
      byDay.push(days.get(key) ?? { date: key, orders: 0, ordered: 0 });
    }
  } else {
    const monthly = new Map<string, MonthLine>();
    for (const line of days.values()) {
      const month = line.date.slice(0, 7);
      const bucket = monthly.get(month) ?? { month, orders: 0, ordered: 0 };
      bucket.orders += line.orders;
      bucket.ordered = round3(bucket.ordered + line.ordered);
      monthly.set(month, bucket);
    }
    // Every month in the range, empty ones included, for the same reason.
    for (let d = rangeStart.startOf('month'); d <= rangeEnd; d = d.plus({ months: 1 })) {
      const month = d.toFormat('yyyy-MM');
      byMonth.push(monthly.get(month) ?? { month, orders: 0, ordered: 0 });
    }
  }

  return {
    range,
    orders: counted.length,
    cancelled: orders.length - counted.length,
    draft: counted.filter((o) => o.status === 'draft').length,
    samples: counted.filter((o) => o.order_type === 'sample').length,
    replacements: counted.filter((o) => o.order_type === 'replacement').length,
    sponsorships: counted.filter((o) => o.order_type === 'sponsorship').length,
    consignments: counted.filter((o) => o.order_type === 'consignment').length,
    customersServed: customers.size,
    lines,
    totalOrdered: round3(totalOrdered),
    totalPrepared: round3(totalPrepared),
    totalWeightKg: roundKg(totalWeightKg),
    productsWithoutWeight: unweighed.size,
    totalBoxes,
    byBoxType: [...boxTypes.values()].sort((a, b) => b.boxes - a.boxes || a.name.localeCompare(b.name)),
    shortLines,
    unexplainedShortLines,
    fulfilmentRate:
      totalOrdered === 0 ? 0 : Math.round((totalPrepared / totalOrdered) * 100),
    byProduct,
    byCategory: groupProducts(withCustomers, 'category', categoryById, subcategoryById),
    bySubcategory: groupProducts(withCustomers, 'subcategory', categoryById, subcategoryById),
    byBrand: [...brands.values()]
      .map(({ productIds, ...b }) => ({ ...b, products: productIds.size }))
      // Most volume first; the unclassified row sorts with the rest rather
      // than being pinned, because how much is unclassified IS the finding.
      .sort((a, b) => b.ordered - a.ordered || (a.name ?? '').localeCompare(b.name ?? '')),
    byCustomer,
    byDeliveryMethod,
    byDay,
    byMonth,
  };
}

/**
 * The same report with category and subcategory names swapped for another
 * language's.
 *
 * The report is computed on the server, which does not follow a language
 * switch made in the browser, so the screen renames by id instead of
 * recomputing. Order is untouched: groups sort by sort_order first.
 */
export function renameClassification(
  report: OrderReport,
  name: { category: (id: string) => string | undefined; subcategory: (id: string) => string | undefined },
): OrderReport {
  const rename = <T extends Pick<ProductLine, 'categoryId' | 'category' | 'subcategoryId' | 'subcategory'>>(x: T): T => ({
    ...x,
    category: x.categoryId ? name.category(x.categoryId) ?? x.category : x.category,
    subcategory: x.subcategoryId ? name.subcategory(x.subcategoryId) ?? x.subcategory : x.subcategory,
  });
  const renameGroup = (g: ProductGroup): ProductGroup => ({ ...rename(g), products: g.products.map(rename) });
  return {
    ...report,
    byProduct: report.byProduct.map(rename),
    byCategory: report.byCategory.map(renameGroup),
    bySubcategory: report.bySubcategory.map(renameGroup),
  };
}

/** A product's category and subcategory, by id and name. */
function classification(
  categoryId: string | null | undefined,
  subcategoryId: string | null | undefined,
  categoryById: Map<string, ProductCategory>,
  subcategoryById: Map<string, ProductSubcategory>,
): Pick<ProductLine, 'categoryId' | 'category' | 'subcategoryId' | 'subcategory'> {
  const category = categoryId ? categoryById.get(categoryId) : undefined;
  const sub = subcategoryId ? subcategoryById.get(subcategoryId) : undefined;
  // A subcategory only counts under its own category.
  const subcategory = category && sub?.category_id === category.id ? sub : undefined;
  return {
    categoryId: category?.id ?? null,
    category: category?.name ?? null,
    subcategoryId: subcategory?.id ?? null,
    subcategory: subcategory?.name ?? null,
  };
}

/** Numeric-aware, so "Ø6" sorts before "Ø14". */
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Add products up into groups, in the taxonomy's own order (sort_order, then
 * name) rather than by volume, so Ø10 always sits next to Ø12. Products keep
 * their most-sold-first order inside a group. Unclassified comes last, and
 * so does "no subcategory" within a category.
 */
function groupProducts(
  entries: { line: ProductLine; customerIds: Set<string> }[],
  level: 'category' | 'subcategory',
  categoryById: Map<string, ProductCategory>,
  subcategoryById: Map<string, ProductSubcategory>,
): ProductGroup[] {
  const groups = new Map<string, ProductGroup & { customerIds: Set<string> }>();
  for (const { line, customerIds } of entries) {
    const subcategoryId = level === 'subcategory' ? line.subcategoryId : null;
    const key = `${line.categoryId ?? 'none'}/${subcategoryId ?? 'none'}`;
    const g = groups.get(key) ?? {
      key,
      categoryId: line.categoryId,
      category: line.category,
      subcategoryId,
      subcategory: level === 'subcategory' ? line.subcategory : null,
      ordered: 0,
      prepared: 0,
      missing: 0,
      lines: 0,
      customers: 0,
      products: [],
      customerIds: new Set<string>(),
    };
    g.ordered += line.ordered;
    g.prepared += line.prepared;
    g.missing += line.missing;
    g.lines += line.lines;
    for (const c of customerIds) g.customerIds.add(c);
    g.products.push(line);
    groups.set(key, g);
  }

  // A missing category or subcategory sorts after every real one.
  type Rank = { absent: number; order: number; name: string };
  const rank = (item: { sort_order: number; name: string } | undefined): Rank =>
    item ? { absent: 0, order: item.sort_order, name: item.name } : { absent: 1, order: 0, name: '' };
  const compare = (a: Rank, b: Rank) => a.absent - b.absent || a.order - b.order || byName(a.name, b.name);

  return [...groups.values()]
    .sort((a, b) =>
      compare(rank(categoryById.get(a.categoryId ?? '')), rank(categoryById.get(b.categoryId ?? '')))
      || compare(rank(subcategoryById.get(a.subcategoryId ?? '')), rank(subcategoryById.get(b.subcategoryId ?? ''))))
    .map(({ customerIds, ...g }) => ({
      ...g,
      ordered: round3(g.ordered),
      prepared: round3(g.prepared),
      missing: round3(g.missing),
      customers: customerIds.size,
    }));
}

/** Human label for a period, e.g. "31 Aug – 6 Sep 2026". */
export function periodLabel(range: PeriodRange, locale: string): string {
  const start = DateTime.fromISO(range.start, { zone: BUSINESS_TZ }).setLocale(locale);
  const end = DateTime.fromISO(range.end, { zone: BUSINESS_TZ }).setLocale(locale);
  switch (range.kind) {
    case 'day':
      return start.toFormat('cccc d LLLL yyyy');
    case 'week':
      return `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`;
    case 'month':
      return start.toFormat('LLLL yyyy');
    case 'year':
      return start.toFormat('yyyy');
    case 'custom':
      // Drop the repeated year when both ends share one.
      return start.year === end.year
        ? `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`
        : `${start.toFormat('d LLL yyyy')} – ${end.toFormat('d LLL yyyy')}`;
  }
}

/**
 * Rows for a CSV export, so the numbers can leave the app.
 *
 * Ungrouped, one row per product. Grouped, the file follows the screen: each
 * group's total row (code and product empty) followed by its products, so it
 * reads as the report does and still filters in Excel.
 */
export function productReportToCsv(report: OrderReport, grouping: ProductGrouping = 'none'): string {
  // Brand and classification sit next to the name because this file is
  // opened in Excel and pivoted: a column there is worth more than another
  // table on the screen.
  const header = ['category', 'subcategory', 'code', 'product', 'brand', 'ordered', 'prepared', 'missing', 'lines', 'customers'];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (cells: (string | number)[]) => cells.map(escape).join(';');
  const productRow = (p: ProductLine) =>
    row([p.category ?? '', p.subcategory ?? '', p.code ?? '', p.name, p.brand ?? '',
      p.ordered, p.prepared, p.missing, p.lines, p.customers]);

  const rows =
    grouping === 'none'
      ? report.byProduct.map(productRow)
      : (grouping === 'category' ? report.byCategory : report.bySubcategory).flatMap((g) => [
        row([g.category ?? '', g.subcategory ?? '', '', '', '', g.ordered, g.prepared, g.missing, g.lines, g.customers]),
        ...g.products.map(productRow),
      ]);
  return [header.join(';'), ...rows].join('\n');
}
