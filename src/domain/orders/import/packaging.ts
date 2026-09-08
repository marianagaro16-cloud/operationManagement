/**
 * Packaging expressions to order quantity.
 *
 * The order quantity is, and remains, a COUNT OF PACKAGES OF THE PRODUCT'S
 * PRESENTATION — the definition the orders module has carried since it
 * shipped. Everything here converts INTO that and never away from it.
 *
 * Two distinctions this module exists to hold apart:
 *
 *   ORDER QUANTITY is not BOX COUNT. A customer ordering 14 units of a
 *   product packed six to a box has ordered 14, and the warehouse will open
 *   three boxes. The order says 14. It has never said 3, and turning it into
 *   3 because 3 boxes get picked would under-ship by 78%.
 *
 *   A CONVERSION IS NOT A GUESS. "3 boxes" becomes 36 only when the Product
 *   Master states that this product is 12 to a box. Where it states nothing,
 *   this module returns "ask the user" — not a default, not an average, not
 *   the value from a similar product. Inventing that number ships the wrong
 *   amount of real food, silently, with a preview that looked confident.
 */

/**
 * The kinds of quantity expression the importer recognises.
 *
 * `unit` and `package` are the SAME thing here, and deliberately so: an order
 * quantity already counts packages of the presentation, so "5 packages of
 * Oaxaca 1kg" is 5 — an identity, not a conversion, and nothing is invented
 * by applying it.
 *
 * `box` is a shipping container holding some number of those packages, which
 * is the only figure the Product Master can supply and the only one that can
 * be missing.
 *
 * `weight` is a customer expressing an amount in kilos. The presentation
 * weight is not structured data anywhere in this system, so a weight can
 * never be converted and always becomes a question.
 */
export type DetectedUnit = 'unit' | 'package' | 'box' | 'weight' | 'unknown';

export type QuantityStatus = 'ok' | 'needs_confirmation' | 'invalid';

/** Why a quantity could not be settled. A stable key; the sentence is in i18n. */
export type QuantityIssue =
  | 'no_conversion'   // boxes, but this product has no units_per_box
  | 'weight_unit'     // kilos, which this system cannot turn into packages
  | 'no_product'      // boxes, but no product is chosen yet to look up
  | 'not_positive'    // zero or negative
  | 'not_a_number';

export interface ResolvedQuantity {
  status: QuantityStatus;
  /** In ORDER UNITS. Null whenever the status is not 'ok'. */
  units: number | null;
  issue: QuantityIssue | null;
  /**
   * The conversion applied, for the preview to explain itself:
   * "3 boxes × 12 = 36 units".
   */
  unitsPerBox: number | null;
}

function invalid(issue: QuantityIssue): ResolvedQuantity {
  return { status: 'invalid', units: null, issue, unitsPerBox: null };
}

function ask(issue: QuantityIssue): ResolvedQuantity {
  return { status: 'needs_confirmation', units: null, issue, unitsPerBox: null };
}

/**
 * Turn a detected quantity into order units, or say why it cannot be turned.
 *
 * `unitsPerBox` is the product's value from the master and is `null` when the
 * master does not know. That null is the whole point of the parameter.
 */
export function resolveQuantity(params: {
  quantity: number;
  unit: DetectedUnit;
  unitsPerBox: number | null | undefined;
}): ResolvedQuantity {
  const { quantity, unit } = params;
  const unitsPerBox =
    typeof params.unitsPerBox === 'number' && Number.isFinite(params.unitsPerBox) && params.unitsPerBox > 0
      ? params.unitsPerBox
      : null;

  if (!Number.isFinite(quantity)) return invalid('not_a_number');
  if (quantity <= 0) return invalid('not_positive');

  switch (unit) {
    // An amount with no unit word is what this system means by a quantity.
    case 'unit':
    case 'unknown':
    case 'package':
      return { status: 'ok', units: round3(quantity), issue: null, unitsPerBox: null };

    case 'box':
      if (unitsPerBox === null) return ask('no_conversion');
      return {
        status: 'ok',
        units: round3(quantity * unitsPerBox),
        issue: null,
        unitsPerBox,
      };

    case 'weight':
      // Never convertible. The presentation weight lives inside a product
      // NAME, which this system does not parse and will not start parsing to
      // answer this question.
      return ask('weight_unit');
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Boxes required to fulfil an order quantity — a DISPLAY figure.
 *
 * The inverse of the conversion above and pointedly not stored anywhere: 14
 * units at 6 to a box is "3 boxes required" written next to the order, while
 * the order still says 14. Returns null when the master cannot say, because
 * a blank is honest and a zero is not.
 */
export function boxesRequired(units: number, unitsPerBox: number | null | undefined): number | null {
  if (typeof unitsPerBox !== 'number' || !Number.isFinite(unitsPerBox) || unitsPerBox <= 0) return null;
  if (!Number.isFinite(units) || units <= 0) return null;
  return Math.ceil(units / unitsPerBox);
}
