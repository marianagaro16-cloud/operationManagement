import 'server-only';
import { createAdminClient } from '@/lib/supabase/server';
import { standingDeliveryDates, type StandingCadence } from '@/domain/orders/scheduling';
import { addDays, businessToday, type BusinessDate } from '@/lib/datetime';
import type { OrderType } from '@/types/orders';

/**
 * Standing orders, materialised.
 *
 * A template used to become an order only when somebody opened
 * /admin/recurring and pressed Generate, per customer, per week. That is the
 * kind of chore that gets forgotten in a busy week, and a forgotten standing
 * order is a delivery that does not happen.
 *
 * Runs from the nightly cron beside the task generator, and follows the same
 * discipline: it PROPOSES. Every order it creates is a DRAFT, exactly as the
 * manual button produced, so nothing reaches preparation without a person
 * confirming it. The scheduler removes the remembering, not the deciding.
 *
 * Idempotent by construction. The unique index on
 * (recurring_template_id, delivery_date) means a retried, overlapping or
 * replayed run cannot create a second order for a date — the insert simply
 * finds nothing to do. That property is what makes it safe to call from a
 * cron, a button and a test.
 *
 * Runs with the service role because these orders are created by the system
 * rather than by a user, matching how task occurrences are generated.
 */

/**
 * How far ahead to create drafts.
 *
 * Three weeks: far enough that a fortnightly template always has its next
 * delivery in the window even if a run is missed, and near enough that the
 * order book is not filled with speculative drafts nobody has looked at.
 */
export const STANDING_HORIZON_DAYS = 21;

export interface StandingRun {
  today: BusinessDate;
  templates: number;
  /** Dates the cadences called for inside the horizon. */
  due: number;
  created: number;
  /** Already present — the ordinary outcome on any run after the first. */
  existing: number;
}

interface TemplateRow {
  id: string;
  customer_id: string;
  delivery_weekday: number;
  interval_weeks: number;
  anchor_date: string | null;
  preparation_lead_days: number;
  delivery_method_id: string | null;
  order_type: OrderType;
  note: string | null;
  lines: { product_id: string; default_quantity: number | string; position: number }[] | null;
}

export async function ensureStandingOrders(
  horizonDays: number = STANDING_HORIZON_DAYS,
): Promise<StandingRun> {
  const admin = createAdminClient();
  const today = businessToday();
  const until = addDays(today, horizonDays);

  const { data, error } = await admin
    .from('recurring_order_templates')
    .select(`
      id, customer_id, delivery_weekday, interval_weeks, anchor_date,
      preparation_lead_days, delivery_method_id, order_type, note,
      lines:recurring_order_template_lines ( product_id, default_quantity, position )
    `)
    // INACTIVE TEMPLATES PRODUCE NOTHING. Templates seeded from the workbook
    // arrive inactive on purpose — a customer appearing on a Wednesday sheet
    // is evidence of a pattern, not proof the order recurs — and activating
    // one is the deliberate act that turns it into a standing order.
    .eq('is_active', true);

  if (error) throw new Error(error.message);

  const templates = (data ?? []) as unknown as TemplateRow[];
  const run: StandingRun = { today, templates: templates.length, due: 0, created: 0, existing: 0 };

  for (const template of templates) {
    const cadence: StandingCadence = {
      weekday: template.delivery_weekday,
      intervalWeeks: template.interval_weeks,
      anchorDate: template.anchor_date,
    };

    // The SAME function the screen uses to say when the next delivery is, so
    // the date shown and the date created cannot disagree.
    const dates = standingDeliveryDates(cadence, today, until);
    run.due += dates.length;

    for (const deliveryDate of dates) {
      const created = await createDraft(admin, template, deliveryDate);
      if (created) run.created += 1;
      else run.existing += 1;
    }
  }

  return run;
}

/**
 * One draft order, or nothing if it already exists.
 *
 * Insert-and-catch rather than check-then-insert: two runs overlapping would
 * both pass a check and both insert, and the unique index is the only thing
 * that can actually decide. 23505 is unique_violation, which here means
 * another run got there first — an expected outcome, not an error.
 */
async function createDraft(
  admin: ReturnType<typeof createAdminClient>,
  template: TemplateRow,
  deliveryDate: BusinessDate,
): Promise<boolean> {
  const { data, error } = await admin
    .from('orders')
    .insert({
      customer_id: template.customer_id,
      delivery_date: deliveryDate,
      preparation_date: addDays(deliveryDate, -template.preparation_lead_days),
      delivery_method_id: template.delivery_method_id,
      status: 'draft',
      order_type: template.order_type,
      note: template.note,
      recurring_template_id: template.id,
    })
    .select('id')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') return false;
    throw new Error(error.message);
  }

  const orderId = (data as { id: string }).id;
  const lines = template.lines ?? [];

  if (lines.length) {
    const { error: lineError } = await admin.from('order_lines').insert(
      lines
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((line, index) => ({
          order_id: orderId,
          product_id: line.product_id,
          ordered_quantity: Number(line.default_quantity),
          position: index,
        })),
    );

    // An order with no lines is worse than no order: it looks prepared when
    // it is empty. Remove the header so the next run creates it properly.
    if (lineError) {
      await admin.from('orders').delete().eq('id', orderId);
      throw new Error(lineError.message);
    }
  }

  await admin.from('order_audit_log').insert({
    order_id: orderId,
    actor_id: null,
    action: 'generated_from_template',
    detail: { template_id: template.id, scheduled: true },
  });

  return true;
}
