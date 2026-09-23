/**
 * Orders module types. Mirrors the SQL in 20260902120000_orders_module.sql.
 * Regenerate the authoritative version with `npm run db:types`.
 */

export type OrderStatus = 'draft' | 'confirmed' | 'cancelled';
/**
 * The commercial nature of a delivery, not its provenance.
 *
 * 'sale' is billed, 'sample' is free for evaluation, 'replacement' is free to
 * make good, 'sponsorship' is free in exchange for visibility — an event, a
 * team, a fair, where no future order is expected of the recipient and none
 * is the point. Independent of `replaces_incident_id`, which records WHICH
 * incident prompted the delivery — a redelivery the customer still pays for
 * is a sale with an incident attached.
 */
export type OrderType = 'sale' | 'sample' | 'replacement' | 'sponsorship';

/**
 * Why a product was prepared short, or not sent at all. A fixed list so the
 * reasons can be counted; 'other' needs a note. Mirrors the check constraint
 * in 20261002090000_shortfall_reasons_and_preparation_incidents.sql.
 */
export const SHORTFALL_CODES = ['no_stock', 'damaged', 'short_shelf_life', 'quality_hold', 'other'] as const;
export type ShortfallCode = (typeof SHORTFALL_CODES)[number];

/**
 * A commercial segment: Gastro, Distribuidor, Reseller.
 *
 * `slug` is the i18n key and `name` the fallback, so a segment added later
 * that no dictionary knows about still renders as something readable.
 */
export interface CustomerType {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Customer {
  id: string;
  /** Legal entity name, e.g. "5 Almas AG". */
  company_name: string;
  /** Trading name, e.g. "La Catedral". Kept separate on purpose. */
  company_name_addition: string | null;
  /**
   * Commercial segment, or NULL while unclassified.
   *
   * Unclassified is a real and permanent state, not a placeholder: guessing a
   * segment from a company name would put invented commercial data into the
   * master file and silently skew everything grouped by it.
   */
  customer_type_id?: string | null;
  customer_type?: CustomerType | null;
  /** Where the van delivers. Empty until somebody fills it in. */
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  /** ISO country code; 'CH' unless stated. */
  country?: string | null;
  /** What the driver needs to know: which door, which hours, who to ask for. */
  delivery_notes?: string | null;
  /** Geocoded from the address when it is saved; null when it could not be placed. */
  latitude?: number | string | null;
  longitude?: number | string | null;
  /**
   * "5 Almas AG — La Catedral", or just the company where there is no
   * addition. A GENERATED column in Postgres, so it can never disagree with
   * the two fields above.
   *
   * This is the customer's display name everywhere. There used to be a
   * customerLabel() here that rebuilt the same string in TypeScript, and both
   * shipped — the combobox rendered the TypeScript version while the list
   * underneath rendered the column, so one separator change would have given
   * one customer two spellings on one screen.
   */
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryMethod {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** We drive it ourselves, so its orders form a delivery round. */
  own_vehicle?: boolean;
}

/**
 * A kind of box the warehouse packs orders in. Its empty weight is added to
 * an order's gross weight. Sizes are the outside measurements in cm, and may
 * be unknown. numeric columns can arrive from Postgres as strings.
 */
export interface BoxType {
  id: string;
  name: string;
  empty_weight_kg: number | string;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  sort_order: number;
  is_active: boolean;
}

/** How many boxes of one type an order uses. Written only by order_set_box_quantity(). */
export interface OrderBox {
  id: string;
  order_id: string;
  box_type_id: string;
  quantity: number;
  box_type: BoxType;
}

/** One of our own brands. Proper nouns, so never translated. */
export interface Brand {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * What kind of product this is — Blue tortilla, Mezcal. Typed by the
 * business, never read from the product name. `name` is English and the
 * fallback; the other two are optional translations.
 */
export interface ProductCategory {
  id: string;
  name: string;
  name_es: string | null;
  name_de: string | null;
  sort_order: number;
  is_active: boolean;
}

/** A group within one category — Ø14. Named in three languages, like its category. */
export interface ProductSubcategory {
  id: string;
  category_id: string;
  name: string;
  name_es: string | null;
  name_de: string | null;
  sort_order: number;
  is_active: boolean;
}

/** A category or subcategory name in the viewer's language, English when untranslated. */
export function localizedName(
  row: { name: string; name_es?: string | null; name_de?: string | null },
  locale: string,
): string {
  if (locale === 'es') return row.name_es || row.name;
  if (locale === 'de') return row.name_de || row.name;
  return row.name;
}

export interface Product {
  id: string;
  code: string | null;
  /** Product name exactly as imported. Never parsed. */
  name: string | null;
  family: string;
  presentation: string;
  category: string | null;
  notes: string | null;
  /**
   * Order units (packages of the presentation) per shipping box.
   *
   * NULL is meaningful and is the default: it says no reliable conversion
   * exists, and the importer must ask for the quantity in units rather than
   * turning "3 boxes" into a number nobody stated. numeric(12,3), so it can
   * arrive from Postgres as a string.
   */
  units_per_box: number | string | null;
  /**
   * Net weight in kg of one unit as ordered (volumes at 1 L = 1 kg). NULL
   * means nobody knows yet. numeric(12,3), so it can arrive as a string.
   */
  net_weight_kg: number | string | null;
  /** True while that weight was read from the name and nobody has confirmed it. */
  net_weight_suggested: boolean;
  /**
   * Weight in kg of one unit as ordered, packaging included. Never below the
   * net weight. This is what order screens total. NULL means unknown.
   */
  gross_weight_kg: number | string | null;
  /** True while that weight is a copy of the net weight nobody has confirmed. */
  gross_weight_suggested: boolean;
  /**
   * Which of our brands this is sold under. NULL means nobody has classified
   * it yet — never inferred from the name, which is stored verbatim.
   */
  brand_id: string | null;
  brand?: Brand | null;
  /**
   * Category and subcategory, which the order report groups by. NULL means
   * not yet classified. The subcategory always belongs to the category.
   */
  category_id: string | null;
  subcategory_id: string | null;
  needs_review: boolean;
  is_active: boolean;
}

/**
 * Display name for a product.
 *
 * Prefers the imported name, which is the source of truth. Falls back to the
 * legacy family/presentation pair so deactivated products from the earlier
 * import still render on historical orders.
 */
export function productLabel(
  p: Pick<Product, 'family' | 'presentation'> & { name?: string | null },
): string {
  if (p.name?.trim()) return p.name;
  if (p.presentation && p.presentation !== '—') return `${p.family} — ${p.presentation}`;
  return p.family;
}

export interface LotAllocation {
  id: string;
  order_line_id: string;
  lot_number: string;
  quantity: number | string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  author?: { name: string | null; email: string } | null;
}

export interface OrderLine {
  id: string;
  order_id: string;
  product_id: string;
  ordered_quantity: number | string;
  /**
   * What the recurring template proposed for this line, frozen at generation.
   * Null on hand-created lines. Never authoritative — ordered_quantity ships.
   */
  generated_quantity: number | string | null;
  note: string | null;
  /**
   * The customer's own text this line was imported from. Null on hand-entered
   * lines. Traceability only — never used for matching or fulfilment.
   */
  source_text: string | null;
  /** Why the line is short or not sent. Null on lines explained in free text before codes existed. */
  shortfall_code: ShortfallCode | null;
  /** The note on the shortfall; on its own, a reason written before codes existed. */
  shortfall_reason: string | null;
  /** The incident raised from preparation about this shortfall. Null when none, or not visible to the viewer. */
  shortfall_incident: { id: string; incident_number: string } | null;
  position: number;
  product: Product;
  allocations: LotAllocation[];
}

export interface Order {
  id: string;
  reference: number;
  customer_id: string;
  order_date: string;
  delivery_date: string;
  /** Wall-clock deadline in Europe/Zurich, "HH:MM:SS". Null = no set hour. */
  delivery_time: string | null;
  preparation_date: string;
  delivery_method_id: string | null;
  status: OrderStatus;
  order_type: OrderType;
  note: string | null;
  /** The recurring template this order was generated from, if any. */
  generated_from_template_id: string | null;
  /** How the order arrived. Null = entered by hand, which is most of them. */
  import_source: 'excel' | 'email' | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Who entered the order. Null for orders the system generated from a
   * standing order, and for any whose author's account was removed.
   */
  creator?: { name: string | null; email: string } | null;
  /** Confirmed as prepared. Set only by order_set_ready(). */
  ready_at?: string | null;
  ready_by?: string | null;
  ready_by_profile?: { name: string | null; email: string } | null;
  /** Left — shipped or picked up. Set only by order_set_shipped(). */
  shipped_at?: string | null;
  shipped_by?: string | null;
  shipped_by_profile?: { name: string | null; email: string } | null;
  customer: Customer;
  delivery_method: DeliveryMethod | null;
  lines: OrderLine[];
  /** Boxes recorded while preparing. Absent where a query did not load them. */
  boxes?: OrderBox[];
}

/**
 * An order with its preparation progress already computed.
 *
 * Progress is still DERIVED from the lot allocations and is still not stored
 * in the database — that decision is deliberate and unchanged. What changed is
 * where the derivation runs: once, in the query layer, instead of at every
 * component that happens to need it.
 *
 * It used to be recomputed five times over the same rows — twice inside
 * OrderWidgets alone, again in UrgentAlert on the same page, again in
 * PreparationView, and again server-side in the notifier — with the report
 * quietly running a sixth, separate implementation. They agreed by
 * coincidence, not by construction.
 */
export interface OrderWithProgress extends Order {
  progress: import('@/domain/orders/progress').OrderProgress;
}

export interface RecurringTemplate {
  id: string;
  customer_id: string;
  name: string | null;
  delivery_weekday: number;
  /** Weeks between deliveries. 1 = weekly. */
  interval_weeks: number;
  /**
   * Which week the interval counts from. Required above interval 1 — "every
   * second Tuesday" is ambiguous until you say which Tuesday starts the count.
   */
  anchor_date: string | null;
  preparation_lead_days: number;
  delivery_method_id: string | null;
  order_type: OrderType;
  note: string | null;
  is_active: boolean;
  customer: Customer;
  lines?: { id: string; product_id: string; default_quantity: number | string; product: Product }[];
}

/* ------------------------ customer specifications ----------------------- */

/**
 * A kind of standing reminder: invoicing, transport, other.
 *
 * `slug` is the i18n key and `name` the fallback, so a kind added later that
 * no dictionary knows about still renders as something readable.
 */
export interface SpecificationType {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Something to remember when working with this customer — "send the invoice
 * at month end", "book transport on Monday".
 *
 * For the office, not the floor: a plain user cannot read these at all, which
 * RLS enforces rather than the UI merely hiding them.
 */
export interface CustomerSpecification {
  id: string;
  customer_id: string;
  type_id: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  type?: SpecificationType;
}
