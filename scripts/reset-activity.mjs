/**
 * Clear everything the app has RECORDED, keep everything it was CONFIGURED with.
 *
 * Written for the end of a testing round: the orders, counts, incidents and
 * completions that were entered to try the app out go, and the products,
 * customers, brands, templates, task definitions and accounts they were
 * entered against stay exactly as they are.
 *
 * Committed rather than run once and thrown away, because a testing round
 * ends more than once, and the next person to need this should not have to
 * re-derive which tables are activity and which are configuration — getting
 * that line wrong deletes the master data.
 *
 * DRY RUN BY DEFAULT. It prints what it would remove and changes nothing
 * unless invoked with --yes.
 *
 *   node scripts/reset-activity.mjs          # show me
 *   node scripts/reset-activity.mjs --yes    # do it
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env' });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const APPLY = process.argv.includes('--yes');
const ALL = '00000000-0000-0000-0000-000000000000';

const n = async (table) => {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  return error ? null : count;
};

/**
 * Activity, in dependency order.
 *
 * Most of these disappear on their own — order_lines, lot_allocations,
 * incident items and inventory entries all cascade from their parent — so the
 * list is short on purpose. Deleting a child explicitly that its parent would
 * take anyway is a second place to get the order wrong.
 */
const ACTIVITY = [
  // INCIDENTS BEFORE ORDERS, and the order is load-bearing.
  //
  // incident_replacements.order_id is ON DELETE SET NULL with a check
  // constraint requiring the row to still say something substantive, so
  // deleting an order out from under a replacement nulls the column and
  // the check rejects it. Removing the incident first takes its
  // replacements with it, and nothing is left pointing at the order.
  'incidents',
  'orders',
  'inventory_instances',
  'task_occurrences',
  'inventory_audit_log',
];

/** Configuration, which must come out the other side untouched. */
const CONFIGURATION = [
  'products', 'customers', 'brands', 'delivery_methods',
  'inventory_templates', 'inventory_template_items', 'inventory_locations',
  'incident_types', 'incident_categories',
  'recurring_order_templates', 'order_request_templates', 'profiles',
];

async function main() {
  console.log(APPLY ? 'RESETTING ACTIVITY\n' : 'DRY RUN — nothing will be changed. Add --yes to apply.\n');

  const before = {};
  for (const t of [...ACTIVITY, ...CONFIGURATION]) before[t] = await n(t);

  // Counted before anything is deleted: tasks.incident_id is ON DELETE SET
  // NULL, so once the incidents are gone these two are indistinguishable from
  // the 50 real definitions and could never be found again.
  const { data: corrective } = await db.from('tasks').select('id, title').not('incident_id', 'is', null);
  const { count: realTasks } = await db.from('tasks')
    .select('*', { count: 'exact', head: true }).is('incident_id', null);

  console.log('ACTIVITY — to be removed');
  for (const t of ACTIVITY) console.log(`  ${t.padEnd(24)} ${before[t]}`);
  console.log(`  ${'corrective-action tasks'.padEnd(24)} ${corrective?.length ?? 0}`);

  console.log('\nCONFIGURATION — must be untouched');
  for (const t of CONFIGURATION) console.log(`  ${t.padEnd(24)} ${before[t]}`);
  console.log(`  ${'task definitions'.padEnd(24)} ${realTasks}`);

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --yes to apply.');
    return;
  }

  console.log('\nDeleting…');

  // FIRST, while they can still be identified. Their occurrences cascade.
  for (const task of corrective ?? []) {
    const { error } = await db.from('tasks').delete().eq('id', task.id);
    if (error) throw new Error(`corrective task ${task.id}: ${error.message}`);
  }
  console.log(`  corrective-action tasks   ${corrective?.length ?? 0} removed`);

  for (const table of ACTIVITY) {
    const { error } = await db.from(table).delete().neq('id', ALL);
    if (error) throw new Error(`${table}: ${error.message}`);
    console.log(`  ${table.padEnd(24)} ${(await n(table)) === 0 ? 'empty' : 'STILL HAS ROWS'}`);
  }

  console.log('\nVerifying configuration survived…');
  let intact = true;
  for (const t of CONFIGURATION) {
    const after = await n(t);
    const ok = after === before[t];
    if (!ok) intact = false;
    console.log(`  ${ok ? 'OK  ' : 'LOST'} ${t.padEnd(24)} ${before[t]} -> ${after}`);
  }
  const { count: tasksAfter } = await db.from('tasks').select('*', { count: 'exact', head: true });
  const tasksOk = tasksAfter === realTasks;
  if (!tasksOk) intact = false;
  console.log(`  ${tasksOk ? 'OK  ' : 'LOST'} ${'task definitions'.padEnd(24)} ${realTasks} kept`);

  console.log(
    intact
      ? '\nDone. Activity cleared, configuration intact.'
      : '\nDONE, BUT CONFIGURATION CHANGED — read the LOST lines above.',
  );
  console.log('Order and incident numbering restarts via the accompanying migration.');
  if (!intact) process.exit(1);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
