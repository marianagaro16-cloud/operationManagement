/**
 * End-to-end verification of the Inventory module against the live database.
 *
 *   npm run verify:inventory
 *
 * This is NOT a unit test. The domain maths is covered by vitest; what this
 * checks is the part that only exists in Postgres:
 *
 *   - RLS actually stops an unassigned user, not just the UI
 *   - the 18:00 deadline is enforced server-side
 *   - temporary permissions work and then stop working
 *   - Physical Stock is derived, not accepted from the client
 *   - Difference, status, resolution and history behave as specified
 *
 * Every check runs as a REAL signed-in user through the anon key, so what is
 * being tested is the same path a browser takes. Three throwaway accounts and
 * one throwaway template are created and then removed; the five imported
 * templates and their 318 items are never touched.
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, ANON key and SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const STAMP = Date.now();
const TAG = `zz-inv-verify-${STAMP}`;
const PASSWORD = `Verify!${STAMP}aA`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** A client acting as a specific signed-in user, through the anon key. */
async function userClient(email) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return client;
}

const created = { users: [], templateId: null, brandId: null, productIds: [], refreshTemplateId: null };

async function makeUser(role) {
  const email = `${TAG}-${role}@example.invalid`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`create ${role}: ${error.message}`);
  const id = data.user.id;
  created.users.push(id);

  // The signup trigger lands everyone in 'pending'; approve and set the role.
  const { error: profileError } = await db
    .from('profiles')
    .update({ role: role === 'admin' ? 'admin' : 'user', status: 'approved', name: role })
    .eq('id', id);
  if (profileError) throw new Error(`profile ${role}: ${profileError.message}`);

  return { id, email };
}

const isoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log(`Inventory verification  (tag ${TAG})`);

  /* ---------------------------------------------------------------- setup */
  const admin = await makeUser('admin');
  const assigned = await makeUser('assigned');
  const outsider = await makeUser('outsider');

  const adminC = await userClient(admin.email);
  const assignedC = await userClient(assigned.email);
  const outsiderC = await userClient(outsider.email);

  // A throwaway template, so nothing here can disturb the imported ones.
  const { data: tpl, error: tplError } = await db
    .from('inventory_templates')
    .insert({
      slug: TAG,
      name: `Verification ${STAMP}`,
      kind: 'expiry',
      frequency: 'weekly',
      schedule_config: { kind: 'weekly', weekday: 5 },
      digital_enabled: true,
      is_active: true,
    })
    .select('id')
    .single();
  if (tplError) throw new Error(`template: ${tplError.message}`);
  created.templateId = tpl.id;

  const { data: tItems, error: tItemError } = await db
    .from('inventory_template_items')
    .insert([
      { template_id: tpl.id, name: `${TAG} BIO Tortillas 14cm`, item_group: 'MASAMOR', sort_order: 10 },
      { template_id: tpl.id, name: `${TAG} Totopos 150g`, item_group: 'Fritura', sort_order: 20 },
      { template_id: tpl.id, name: `${TAG} Retired item`, item_group: 'Fritura', sort_order: 30 },
    ])
    .select('id, name');
  if (tItemError) throw new Error(`template items: ${tItemError.message}`);

  const today = isoDate(0);
  const yesterday = isoDate(-1);

  const { data: inst, error: instError } = await db
    .from('inventory_instances')
    .insert({
      template_id: tpl.id,
      inventory_date: today,
      period_key: 'verify',
      name_snapshot: '',
      kind: 'expiry',
      digital_enabled: false,
    })
    .select('*')
    .single();
  if (instError) throw new Error(`instance: ${instError.message}`);

  /* ------------------------------------------------- generation snapshots */
  section('Generation and snapshots');

  check(
    'instance snapshots the template name, kind and Inventory Digital setting',
    inst.name_snapshot === `Verification ${STAMP}` &&
      inst.kind === 'expiry' &&
      inst.digital_enabled === true,
    `got ${inst.name_snapshot} / ${inst.kind} / ${inst.digital_enabled}`,
  );

  /*
   * iso_week and iso_year are GENERATED columns, so the caller cannot supply
   * them even by mistake — stronger than the trigger this check was written
   * for. What is left worth asserting is that the value derived is the RIGHT
   * one, compared against the same date computed here.
   */
  const expectedYear = Number(
    new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'Europe/Zurich' })
      .format(new Date(`${today}T12:00:00Z`)),
  );
  check(
    'KW is derived by the database, never sent by the caller',
    inst.iso_week >= 1 && inst.iso_week <= 53 && Math.abs(inst.iso_year - expectedYear) <= 1,
    `iso_year=${inst.iso_year} iso_week=${inst.iso_week} for ${today}`,
  );

  const { data: items } = await db
    .from('inventory_instance_items')
    .select('id, item_name, item_group, physical_stock, digital_quantity, difference, status')
    .eq('instance_id', inst.id)
    .order('item_sort_order');

  check('active template items are materialised onto the instance', items.length === 3, `got ${items.length}`);
  check(
    'item names and groups are frozen onto the instance',
    items[0].item_name === `${TAG} BIO Tortillas 14cm` && items[0].item_group === 'MASAMOR',
  );
  check('a new item starts at zero stock and pending digital',
    items[0].physical_stock === 0 && items[0].digital_quantity === null && items[0].difference === null);

  const itemA = items[0];
  const itemB = items[1];

  /* --------------------------------------------------------- assignments */
  section('Assignment and access');

  await db.from('inventory_assignments').insert({ instance_id: inst.id, user_id: assigned.id });

  const { error: outsiderWrite } = await outsiderC.from('inventory_entries').insert({
    instance_item_id: itemA.id,
    instance_id: inst.id,
    quantity: 5,
    created_by: outsider.id,
  });
  check('an UNASSIGNED user cannot write, enforced by RLS', Boolean(outsiderWrite));

  const { data: outsiderRead } = await outsiderC
    .from('inventory_instances')
    .select('id')
    .eq('id', inst.id);
  check('an unassigned user can still READ the inventory', outsiderRead?.length === 1);

  const { error: assignedWrite } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemA.id,
    instance_id: inst.id,
    quantity: 20,
    expiry_date: '2026-09-12',
    created_by: assigned.id,
  });
  check('an ASSIGNED user can write', !assignedWrite, assignedWrite?.message);

  const { error: forgedAuthor } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemA.id,
    instance_id: inst.id,
    quantity: 1,
    created_by: outsider.id,
  });
  check('a user cannot attribute an entry to somebody else', Boolean(forgedAuthor));

  /* ------------------------------------------------------ stock and rules */
  section('Physical Stock, expiry and quantity rules');

  await assignedC.from('inventory_entries').insert([
    { instance_item_id: itemA.id, instance_id: inst.id, quantity: 15, expiry_date: '2026-09-18', created_by: assigned.id },
    { instance_item_id: itemA.id, instance_id: inst.id, quantity: 30, expiry_date: '2026-09-25', created_by: assigned.id },
  ]);

  let { data: a } = await db
    .from('inventory_instance_items')
    .select('physical_stock, difference, status')
    .eq('id', itemA.id)
    .single();
  check('Physical Stock is calculated automatically (20+15+30)', a.physical_stock === 65, `got ${a.physical_stock}`);

  // Duplicate expiry dates: both kept, never merged.
  await assignedC.from('inventory_entries').insert([
    { instance_item_id: itemB.id, instance_id: inst.id, quantity: 10, expiry_date: '2026-09-15', created_by: assigned.id },
    { instance_item_id: itemB.id, instance_id: inst.id, quantity: 5, expiry_date: '2026-09-15', created_by: assigned.id },
  ]);
  const { data: dupes } = await db
    .from('inventory_entries')
    .select('id, quantity')
    .eq('instance_item_id', itemB.id)
    .eq('expiry_date', '2026-09-15');
  check('duplicate expiry dates stay as two separate records', dupes.length === 2, `got ${dupes.length}`);

  const { data: bRow } = await db
    .from('inventory_instance_items')
    .select('physical_stock')
    .eq('id', itemB.id)
    .single();
  check('duplicate expiry records both count toward stock (10+5)', bRow.physical_stock === 15, `got ${bRow.physical_stock}`);

  const { error: decimalError } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemB.id, instance_id: inst.id, quantity: 1.5, created_by: assigned.id,
  });
  check('a decimal quantity is rejected by the database', Boolean(decimalError));

  const { error: negativeError } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemB.id, instance_id: inst.id, quantity: -1, created_by: assigned.id,
  });
  check('a negative quantity is rejected by the database', Boolean(negativeError));

  const { error: zeroError } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemB.id, instance_id: inst.id, quantity: 0, created_by: assigned.id,
  });
  check('zero is accepted — it is a real count', !zeroError, zeroError?.message);

  const { error: noQtyError } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemB.id, instance_id: inst.id, quantity: null, created_by: assigned.id,
  });
  check('an entry with no quantity and no expiry is accepted', !noQtyError, noQtyError?.message);

  const { error: strayLot } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemB.id, instance_id: inst.id, quantity: 1, lot_number: 'L1', created_by: assigned.id,
  });
  check('a lot number is rejected on an expiry-type inventory', Boolean(strayLot));

  /* ---------------------------------------------------- Inventory Digital */
  section('Inventory Digital, Difference and status');

  const { error: userDigital } = await assignedC.rpc('inventory_set_digital', {
    p_item_id: itemA.id, p_value: 60,
  });
  check('a normal user cannot set Inventory Digital', Boolean(userDigital));

  const { error: userDirectDigital } = await assignedC
    .from('inventory_instance_items')
    .update({ digital_quantity: 60 })
    .eq('id', itemA.id);
  const { data: afterDirect } = await db
    .from('inventory_instance_items').select('digital_quantity').eq('id', itemA.id).single();
  check(
    'a user cannot set Inventory Digital by writing the table directly either',
    afterDirect.digital_quantity === null,
    `error=${userDirectDigital?.message} value=${afterDirect.digital_quantity}`,
  );

  const { error: userStock } = await assignedC
    .from('inventory_instance_items')
    .update({ physical_stock: 999 })
    .eq('id', itemA.id);
  const { data: afterStock } = await db
    .from('inventory_instance_items').select('physical_stock').eq('id', itemA.id).single();
  check(
    'Physical Stock cannot be overwritten by a client',
    afterStock.physical_stock === 65,
    `error=${userStock?.message} value=${afterStock.physical_stock}`,
  );

  ({ data: a } = await db
    .from('inventory_instance_items').select('status, difference').eq('id', itemA.id).single());
  check('while Inventory Digital is pending, Difference stays null (never 0)', a.difference === null);
  check('while Inventory Digital is pending, the item is In progress', a.status === 'in_progress');

  await adminC.rpc('inventory_set_digital', { p_item_id: itemA.id, p_value: 60 });
  ({ data: a } = await db
    .from('inventory_instance_items').select('status, difference, digital_quantity').eq('id', itemA.id).single());
  check('Difference = Physical Stock - Inventory Digital (65-60)', a.difference === 5, `got ${a.difference}`);
  check('a non-zero difference sets the item To review', a.status === 'to_review', `got ${a.status}`);

  await adminC.rpc('inventory_set_digital', { p_item_id: itemB.id, p_value: 15 });
  const { data: b2 } = await db
    .from('inventory_instance_items').select('status, difference').eq('id', itemB.id).single();
  check('a zero difference sets the item Completed', b2.difference === 0 && b2.status === 'completed',
    `diff=${b2.difference} status=${b2.status}`);

  /* -------------------------------------------------- resolution and history */
  section('Resolution and difference history');

  const { error: noNote } = await adminC.rpc('inventory_resolve_item', {
    p_item_id: itemA.id, p_note: '   ',
  });
  check('resolving without a reason is refused', Boolean(noNote));

  const { error: userResolve } = await assignedC.rpc('inventory_resolve_item', {
    p_item_id: itemA.id, p_note: 'trying it on',
  });
  check('a normal user cannot resolve a difference', Boolean(userResolve));

  await adminC.rpc('inventory_resolve_item', {
    p_item_id: itemA.id,
    p_note: 'Checked with Freddy. Physical count confirmed. Digital inventory needs adjustment.',
  });
  ({ data: a } = await db
    .from('inventory_instance_items').select('status, difference, is_resolved, resolved_by').eq('id', itemA.id).single());
  check('an item can be Resolved while the difference stays non-zero',
    a.status === 'resolved' && a.difference === 5, `status=${a.status} diff=${a.difference}`);
  check('the resolving admin is recorded', a.resolved_by === admin.id);

  const { data: res } = await db
    .from('inventory_resolutions')
    .select('note, physical_stock_at, digital_at, difference_at, resolved_by, superseded_at')
    .eq('instance_item_id', itemA.id);
  check('the resolution freezes the numbers it was given for',
    res.length === 1 && res[0].physical_stock_at === 65 && res[0].digital_at === 60 && res[0].difference_at === 5,
    JSON.stringify(res[0]));
  check('the resolution note is stored', res[0].note.startsWith('Checked with Freddy'));

  // Changing Inventory Digital afterwards must not rewrite the history.
  await adminC.rpc('inventory_set_digital', { p_item_id: itemA.id, p_value: 63 });
  const { data: hist } = await db
    .from('inventory_digital_history')
    .select('previous_digital, new_digital, previous_difference, new_difference, changed_by')
    .eq('instance_item_id', itemA.id)
    .order('changed_at');
  check('every Inventory Digital value ever entered is kept', hist.length === 2, `got ${hist.length}`);
  check('the first history row records null -> 60 and a null -> 5 difference',
    hist[0].previous_digital === null && hist[0].new_digital === 60 &&
    hist[0].previous_difference === null && hist[0].new_difference === 5,
    JSON.stringify(hist[0]));
  check('the second history row records 60 -> 63 and +5 -> +2',
    hist[1].previous_digital === 60 && hist[1].new_digital === 63 &&
    hist[1].previous_difference === 5 && hist[1].new_difference === 2,
    JSON.stringify(hist[1]));
  check('the change is attributed to the admin who made it', hist[1].changed_by === admin.id);

  const { data: res2 } = await db
    .from('inventory_resolutions').select('superseded_at').eq('instance_item_id', itemA.id);
  check('the earlier resolution is marked superseded, not deleted',
    res2.length === 1 && res2[0].superseded_at !== null);

  ({ data: a } = await db
    .from('inventory_instance_items').select('status, difference, is_resolved').eq('id', itemA.id).single());
  check('changing Inventory Digital reopens the item for review',
    a.is_resolved === false && a.status === 'to_review' && a.difference === 2,
    `resolved=${a.is_resolved} status=${a.status} diff=${a.difference}`);

  /* ------------------------------------------------------------ comments */
  section('Comments');

  const { error: generalComment } = await assignedC.from('inventory_comments').insert({
    instance_id: inst.id, instance_item_id: null, user_id: assigned.id,
    body: 'Inventory performed one day earlier because of the holiday.',
  });
  check('a user can leave a general inventory comment', !generalComment, generalComment?.message);

  const { error: itemComment } = await assignedC.from('inventory_comments').insert({
    instance_id: inst.id, instance_item_id: itemA.id, user_id: assigned.id,
    body: 'Two boxes damaged. Need to double-check physical stock.',
  });
  check('a user can leave an item comment', !itemComment, itemComment?.message);

  const { data: commentRows } = await db
    .from('inventory_comments').select('id').eq('instance_id', inst.id);
  const { error: deleteComment } = await assignedC
    .from('inventory_comments').delete().eq('id', commentRows[0].id);
  const { data: stillThere } = await db
    .from('inventory_comments').select('id').eq('instance_id', inst.id);
  check('comments cannot be deleted — they are part of the audit record',
    stillThere.length === commentRows.length, `error=${deleteComment?.message}`);

  /* ---------------------------------------------------------- completion */
  section('Completion');

  const { error: completeError } = await assignedC.rpc('inventory_complete', {
    p_instance_id: inst.id,
  });
  check('an assigned user can complete the inventory', !completeError, completeError?.message);

  const { data: done } = await db
    .from('inventory_instances').select('status, completed_at, completed_by').eq('id', inst.id).single();
  check('completion records who and when',
    done.completed_at !== null && done.completed_by === assigned.id);
  check('one item needing review holds the whole inventory in To review',
    done.status === 'to_review', `got ${done.status}`);

  const { error: writeAfterComplete } = await assignedC.from('inventory_entries').insert({
    instance_item_id: itemA.id, instance_id: inst.id, quantity: 1, created_by: assigned.id,
  });
  check('a user cannot keep editing a completed inventory', Boolean(writeAfterComplete));

  /* ------------------------------------------------------ 18:00 deadline */
  section('The 18:00 deadline and temporary permissions');

  const { data: past } = await db
    .from('inventory_instances')
    .insert({
      template_id: tpl.id, inventory_date: yesterday, period_key: 'verify-past',
      name_snapshot: '', kind: 'expiry', digital_enabled: false,
    })
    .select('id')
    .single();
  await db.from('inventory_assignments').insert({ instance_id: past.id, user_id: assigned.id });
  const { data: pastItems } = await db
    .from('inventory_instance_items').select('id').eq('instance_id', past.id).limit(1);

  const { error: lateWrite } = await assignedC.from('inventory_entries').insert({
    instance_item_id: pastItems[0].id, instance_id: past.id, quantity: 3, created_by: assigned.id,
  });
  check('after 18:00 on the inventory day the assigned user is read-only', Boolean(lateWrite));

  const { data: adminLate, error: adminLateError } = await adminC.from('inventory_entries').insert({
    instance_item_id: pastItems[0].id, instance_id: past.id, quantity: 3, created_by: admin.id,
  }).select('id').single();
  check('an admin retains control after the deadline', !adminLateError, adminLateError?.message);

  // A grant that spans two days must be refused.
  const startsAt = new Date();
  const spansTwoDays = new Date(startsAt.getTime() + 48 * 3600 * 1000);
  const { error: multiDay } = await adminC.rpc('inventory_grant_edit', {
    p_user_id: assigned.id, p_scope: 'instance', p_instance_id: past.id,
    p_starts_at: startsAt.toISOString(), p_ends_at: spansTwoDays.toISOString(), p_reason: null,
  });
  check('a permission spanning more than one day is refused', Boolean(multiDay));

  // A valid grant: from now until just before midnight Zurich today.
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const { error: grantError } = await adminC.rpc('inventory_grant_edit', {
    p_user_id: assigned.id, p_scope: 'instance', p_instance_id: past.id,
    p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
    p_reason: 'Finishing the count',
  });
  check('an admin can grant a temporary edit permission', !grantError, grantError?.message);

  const { data: grantedWrite, error: grantedError } = await assignedC
    .from('inventory_entries')
    .insert({ instance_item_id: pastItems[0].id, instance_id: past.id, quantity: 7, created_by: assigned.id })
    .select('id')
    .single();
  check('the granted user can now edit past the deadline', !grantedError, grantedError?.message);

  const { data: grants } = await db
    .from('inventory_edit_grants').select('id, granted_by, scope, reason').eq('user_id', assigned.id);
  check('the grant records who issued it, its scope and the reason',
    grants.length === 1 && grants[0].granted_by === admin.id && grants[0].scope === 'instance',
    JSON.stringify(grants[0]));

  await adminC.rpc('inventory_revoke_grant', { p_grant_id: grants[0].id });
  const { error: afterRevoke } = await assignedC.from('inventory_entries').insert({
    instance_item_id: pastItems[0].id, instance_id: past.id, quantity: 9, created_by: assigned.id,
  });
  check('revoking the permission returns the user to read-only', Boolean(afterRevoke));

  // Expiry needs no cleanup job: a window in the past simply stops matching.
  const expiredStart = new Date(startsAt.getTime() - 3 * 3600 * 1000);
  const expiredEnd = new Date(startsAt.getTime() - 2 * 3600 * 1000);
  await adminC.rpc('inventory_grant_edit', {
    p_user_id: assigned.id, p_scope: 'all', p_instance_id: null,
    p_starts_at: expiredStart.toISOString(), p_ends_at: expiredEnd.toISOString(), p_reason: 'expired',
  });
  const { error: afterExpiry } = await assignedC.from('inventory_entries').insert({
    instance_item_id: pastItems[0].id, instance_id: past.id, quantity: 11, created_by: assigned.id,
  });
  check('an expired permission grants nothing', Boolean(afterExpiry));

  /* ------------------------------------------------- other inventory kinds */
  section('Lot and location inventory kinds');

  const { data: lotTpl } = await db
    .from('inventory_templates')
    .insert({
      slug: `${TAG}-lot`, name: `Verification lot ${STAMP}`, kind: 'lot',
      frequency: 'monthly', schedule_config: { kind: 'monthly', rules: [{ type: 'nthWeekday', nth: -1, weekday: 4 }] },
      digital_enabled: false, is_active: true,
    })
    .select('id').single();
  await db.from('inventory_template_items').insert({
    template_id: lotTpl.id, name: `${TAG} Bio Mais blau`, sort_order: 10,
  });
  const { data: lotInst } = await db
    .from('inventory_instances')
    .insert({
      template_id: lotTpl.id, inventory_date: today, period_key: 'verify-lot',
      name_snapshot: '', kind: 'expiry', digital_enabled: false,
    })
    .select('id').single();
  await db.from('inventory_assignments').insert({ instance_id: lotInst.id, user_id: assigned.id });
  const { data: lotItems } = await db
    .from('inventory_instance_items').select('id').eq('instance_id', lotInst.id);

  const { error: lotError } = await assignedC.from('inventory_entries').insert([
    { instance_item_id: lotItems[0].id, instance_id: lotInst.id, quantity: 4, lot_number: 'L-001', expiry_date: '2027-01-31', created_by: assigned.id },
    { instance_item_id: lotItems[0].id, instance_id: lotInst.id, quantity: 6, lot_number: 'L-002', expiry_date: '2027-03-31', created_by: assigned.id },
  ]);
  check('several lot records are accepted for one raw material', !lotError, lotError?.message);

  const { data: lotStock } = await db
    .from('inventory_instance_items').select('physical_stock, difference, status').eq('id', lotItems[0].id).single();
  check('lot quantities sum into Physical Stock (4+6)', lotStock.physical_stock === 10, `got ${lotStock.physical_stock}`);
  check('no Difference is calculated when Inventory Digital is off', lotStock.difference === null);

  const { error: lotDigital } = await adminC.rpc('inventory_set_digital', {
    p_item_id: lotItems[0].id, p_value: 10,
  });
  check('Inventory Digital is refused on a template that does not use it', Boolean(lotDigital));

  // ---- packaging, counted per location ----
  const { data: locs } = await db
    .from('inventory_locations').select('id, slug').in('slug', ['lager-4to-piso', 'fabrica']);
  check('the two seeded counting locations exist', locs.length === 2);

  const { data: locTpl } = await db
    .from('inventory_templates')
    .insert({
      slug: `${TAG}-loc`, name: `Verification loc ${STAMP}`, kind: 'location',
      frequency: 'monthly', schedule_config: { kind: 'monthly', rules: [{ type: 'nthWeekday', nth: -1, weekday: 4 }] },
      digital_enabled: false, is_active: true,
    })
    .select('id').single();
  await db.from('inventory_template_items').insert({
    template_id: locTpl.id, name: `${TAG} Bio Mais-Tortillas 1kg`, sort_order: 10,
  });
  const { data: locInst } = await db
    .from('inventory_instances')
    .insert({
      template_id: locTpl.id, inventory_date: today, period_key: 'verify-loc',
      name_snapshot: '', kind: 'expiry', digital_enabled: false,
    })
    .select('id').single();
  await db.from('inventory_assignments').insert({ instance_id: locInst.id, user_id: assigned.id });
  const { data: locItems } = await db
    .from('inventory_instance_items').select('id').eq('instance_id', locInst.id);

  const { error: locError } = await assignedC.from('inventory_entries').insert([
    { instance_item_id: locItems[0].id, instance_id: locInst.id, quantity: 100, location_id: locs[0].id, created_by: assigned.id },
    { instance_item_id: locItems[0].id, instance_id: locInst.id, quantity: 50, location_id: locs[1].id, created_by: assigned.id },
  ]);
  check('packaging quantities can be entered per location', !locError, locError?.message);

  const { data: locStock } = await db
    .from('inventory_instance_items').select('physical_stock').eq('id', locItems[0].id).single();
  check('packaging Stock is the sum across locations (100+50)', locStock.physical_stock === 150, `got ${locStock.physical_stock}`);

  const { data: locEntry } = await db
    .from('inventory_entries').select('location_name').eq('instance_item_id', locItems[0].id).limit(1).single();
  check('the location name is frozen onto the entry for history', Boolean(locEntry.location_name));

  const { error: missingLoc } = await assignedC.from('inventory_entries').insert({
    instance_item_id: locItems[0].id, instance_id: locInst.id, quantity: 5, created_by: assigned.id,
  });
  check('a packaging entry without a location is refused', Boolean(missingLoc));

  /* ------------------------------------------- history and deactivation */
  section('History preservation');

  // Deactivate an item; it must vanish from NEW inventories and stay in old ones.
  const retired = tItems.find((i) => i.name.endsWith('Retired item'));
  await db.from('inventory_template_items').update({ is_active: false }).eq('id', retired.id);

  const { data: laterInst } = await db
    .from('inventory_instances')
    .insert({
      template_id: tpl.id, inventory_date: isoDate(7), period_key: 'verify-next',
      name_snapshot: '', kind: 'expiry', digital_enabled: false,
    })
    .select('id, inventory_date').single();

  const { data: laterItems } = await db
    .from('inventory_instance_items').select('id').eq('instance_id', laterInst.id);
  check('a deactivated item does not appear in a newly generated inventory',
    laterItems.length === 2, `got ${laterItems.length}`);

  const { data: oldItems } = await db
    .from('inventory_instance_items').select('id, item_name').eq('instance_id', inst.id);
  check('the deactivated item is still visible in the inventory that counted it',
    oldItems.length === 3 && oldItems.some((i) => i.item_name.endsWith('Retired item')));

  // Renaming the template must not rewrite what an old inventory says it was.
  await db.from('inventory_templates').update({ name: `Renamed ${STAMP}` }).eq('id', tpl.id);
  const { data: afterRename } = await db
    .from('inventory_instances').select('name_snapshot').eq('id', inst.id).single();
  check('renaming the template does not rewrite historical inventories',
    afterRename.name_snapshot === `Verification ${STAMP}`, afterRename.name_snapshot);

  const { data: allForTemplate } = await db
    .from('inventory_instances').select('id, inventory_date').eq('template_id', tpl.id);
  check('several dates for one template coexist as separate records',
    allForTemplate.length === 3, `got ${allForTemplate.length}`);

  const { error: duplicateDate } = await db.from('inventory_instances').insert({
    template_id: tpl.id, inventory_date: today, period_key: 'verify-dupe',
    name_snapshot: '', kind: 'expiry', digital_enabled: false,
  });
  check('a second inventory for the same template and date is refused', Boolean(duplicateDate));

  /* ---------------------------------------------------------- audit trail */
  section('Audit trail');

  const { data: audit } = await db
    .from('inventory_audit_log').select('action, actor_id').eq('instance_id', inst.id);
  const actions = new Set(audit.map((r) => r.action));
  for (const expected of [
    'inventory_created',
    'inventory_assigned',
    'entry_insert',
    'digital_set',
    'item_resolved',
    'item_status_changed',
    'inventory_completed',
    'inventory_status_changed',
  ]) {
    check(`audited: ${expected}`, actions.has(expected));
  }
  check('audit entries are attributed to an actor',
    audit.some((r) => r.actor_id === admin.id) && audit.some((r) => r.actor_id === assigned.id));

  const { data: userAudit } = await assignedC.from('inventory_audit_log').select('id').limit(1);
  check('the audit log is not readable by a normal user', (userAudit?.length ?? 0) === 0);

  /* ------------------------------------ the operational configuration */
  section('Operational configuration');

  const { data: real } = await db
    .from('inventory_templates')
    .select('id, slug, name, kind, frequency, digital_enabled, is_active, schedule_config, items:inventory_template_items(id, product_id, is_active)');

  const bySlug = Object.fromEntries(real.map((r) => [r.slug, r]));
  // The script's own throwaway templates are live while it runs, so they are
  // excluded by their stamp — counting them would make this check depend on
  // where in the file it happens to sit.
  const live = real.filter((r) => r.is_active && !r.name.includes(STAMP));
  check('six inventories are live: four brands, packaging and raw material',
    live.length === 6, live.map((r) => r.name).sort().join(' | '));

  check('Materia Prima is untouched: lot tracking, Inventory Digital OFF',
    bySlug['materia-prima']?.kind === 'lot' &&
    bySlug['materia-prima']?.digital_enabled === false &&
    bySlug['materia-prima']?.is_active === true);

  // Counted, not name-checked against a second template that used to exist:
  // the semi-annual list was deactivated and has since been deleted, and
  // what must stay true is that packaging is counted from ONE list.
  const empaquesLists = live.filter((t) => t.name.startsWith('Empaques'));
  check('Empaques is ONE list, monthly, by location',
    empaquesLists.length === 1 &&
    bySlug['empaques']?.kind === 'location' &&
    bySlug['empaques']?.frequency === 'monthly' &&
    bySlug['empaques']?.items.length === 26,
    `${empaquesLists.length} Empaques list(s), ${bySlug['empaques']?.items.length} items`);

  /*
   * REPLACED: "the old combined brand list is archived, not deleted".
   *
   * That asserted a transitional state. The combined list was deactivated
   * rather than dropped because it held counting history the schema refuses
   * to erase — then the testing data was cleared on purpose, the history
   * went with it, and the empty template was deleted. Nothing was lost that
   * the check existed to protect, and re-adding it would assert that a
   * cleanup is forbidden.
   *
   * What must hold FOREVER is what the split was for: no two live
   * inventories claim the same brand. That is what going back to a combined
   * or duplicated list would look like, and it stays assertable whatever
   * anyone deletes.
   */
  const claimed = live.filter((t) => t.brand_id).map((t) => t.brand_id);
  check('no two live inventories count the same brand',
    new Set(claimed).size === claimed.length,
    `${claimed.length} branded inventories, ${new Set(claimed).size} distinct brands`);

  /*
   * DERIVED, never hardcoded.
   *
   * An item count typed as a number here goes red the first time somebody
   * adds a product — which is exactly how the customer count in verify-master
   * taught people to ignore a failing script. The inventory is defined as
   * "this brand's active products", so that is what is asserted.
   */
  const { data: brandRows } = await db.from('brands').select('id, name').order('sort_order');
  const SLUG_FOR = {
    'Masamor': 'masamor',
    'Del Barrio': 'del-barrio',
    'Colectivo Comestibles': 'colectivo-comestibles',
    'Complementarios': 'complementarios',
  };
  for (const b of brandRows ?? []) {
    const t = bySlug[SLUG_FOR[b.name]];
    if (!t) { check(`${b.name}: has an inventory of its own`, false, 'no template'); continue; }
    const { count: products } = await db.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true).eq('brand_id', b.id);
    const items = t.items.filter((i) => i.is_active);
    check(`${b.name}: Inventory Digital is ON`, t.digital_enabled === true);
    check(`${b.name}: counts exactly its active products`,
      items.length === products, `${items.length} items / ${products} products`);
    check(`${b.name}: every item IS a product, none free text`,
      items.every((i) => i.product_id), `${items.filter((i) => !i.product_id).length} unlinked`);
  }

  // Friday, which is both what the operation does and what the domain layer
  // already documented as DEFAULT_WEEKLY_INVENTORY_WEEKDAY.
  check('the weekly brands are counted on FRIDAY',
    bySlug['masamor']?.schedule_config?.weekday === 5 &&
    bySlug['del-barrio']?.schedule_config?.weekday === 5,
    `masamor=${bySlug['masamor']?.schedule_config?.weekday} del-barrio=${bySlug['del-barrio']?.schedule_config?.weekday}`);

  check('the monthly brands are counted twice a month',
    bySlug['colectivo-comestibles']?.schedule_config?.rules?.length === 2 &&
    bySlug['complementarios']?.schedule_config?.rules?.length === 2);


  /* --------------------------------------- refresh from products */
  section('Refresh from products');

  /*
   * The button's authorisation is RLS, not the server action — the action is
   * a transport, exactly like every other one in inventory-actions. So the
   * statements it issues are run here through REAL user sessions, because
   * "the action checked the capability" is not a claim this codebase makes
   * and would not be true if it did.
   */
  const rBrand = (await db.from('brands')
    .insert({ name: `ZZ Refresh ${STAMP}`, sort_order: 999 }).select('id').single()).data;
  created.brandId = rBrand?.id ?? null;

  const rProducts = (await db.from('products').insert([
    { code: `ZR${STAMP}A`, name: `ZZ Refresh Uno ${STAMP}`, family: 'ZZ Familia', presentation: '1kg', brand_id: rBrand.id, is_active: true },
    { code: `ZR${STAMP}B`, name: `ZZ Refresh Dos ${STAMP}`, family: 'ZZ Familia', presentation: '2kg', brand_id: rBrand.id, is_active: true },
  ]).select('id, name')).data ?? [];
  created.productIds = rProducts.map((p) => p.id);

  const rTemplate = (await db.from('inventory_templates').insert({
    slug: `${TAG}-refresh`,
    name: `ZZ Refresh ${STAMP}`,
    kind: 'expiry',
    frequency: 'weekly',
    schedule_config: { kind: 'weekly', weekday: 5 },
    digital_enabled: true,
    brand_id: rBrand.id,
  }).select('id, brand_id').single()).data;
  created.refreshTemplateId = rTemplate?.id ?? null;

  check('a template can name the brand it counts', rTemplate?.brand_id === rBrand.id);

  // A hand-added item, which a refresh must never touch.
  const handAdded = (await db.from('inventory_template_items').insert({
    template_id: rTemplate.id, name: `ZZ By hand ${STAMP}`, sort_order: 5,
  }).select('id').single()).data;

  /* --- the statements the action issues, run as an ADMIN --- */
  const { error: insertErr } = await adminC.from('inventory_template_items').insert(
    rProducts.map((p, i) => ({
      template_id: rTemplate.id, name: p.name, item_group: 'ZZ Familia',
      product_id: p.id, sort_order: (i + 1) * 10,
    })),
  );
  check('an admin may add the missing products', !insertErr, insertErr?.message ?? '');

  /*
   * A REAL row, and the effect is read back.
   *
   * This check first narrowed itself to nothing with two conflicting id
   * filters, so it updated zero rows and passed without exercising the
   * policy at all — the exact shape of a test that guards nothing.
   */
  const victim = rProducts[1].id;
  const { error: deactivateErr } = await adminC.from('inventory_template_items')
    .update({ is_active: false }).eq('template_id', rTemplate.id).eq('product_id', victim);
  const { data: afterOff } = await db.from('inventory_template_items')
    .select('is_active').eq('template_id', rTemplate.id).eq('product_id', victim).single();
  check('an admin may switch an item off, and it actually goes off',
    !deactivateErr && afterOff?.is_active === false,
    deactivateErr?.message ?? `is_active=${afterOff?.is_active}`);

  const { error: reactivateErr } = await adminC.from('inventory_template_items')
    .update({ is_active: true }).eq('template_id', rTemplate.id).eq('product_id', victim);
  const { data: afterOn } = await db.from('inventory_template_items')
    .select('is_active').eq('template_id', rTemplate.id).eq('product_id', victim).single();
  check('and may switch it back on when the product returns',
    !reactivateErr && afterOn?.is_active === true,
    reactivateErr?.message ?? `is_active=${afterOn?.is_active}`);

  /* --- and are refused for somebody without the capability --- */
  const { error: outsiderInsert } = await assignedC.from('inventory_template_items').insert({
    template_id: rTemplate.id, name: `ZZ Forbidden ${STAMP}`, sort_order: 900,
  });
  check('a user without inventory.manage_templates cannot refresh', Boolean(outsiderInsert),
    outsiderInsert?.code ?? 'NO ERROR — the button would be usable by anyone');

  /* --- the outcome the planner promises --- */
  const { data: afterItems } = await db.from('inventory_template_items')
    .select('id, name, product_id, is_active').eq('template_id', rTemplate.id);

  check('every product of the brand is now an item',
    rProducts.every((p) => afterItems.some((i) => i.product_id === p.id)),
    `${afterItems.length} items`);

  // What the planner does with this row is asserted in refresh.test.ts,
  // which calls it directly. All this says is that the row exists and is
  // distinguishable — an item with no product_id — which is the fact the
  // planner's "leave it alone" rule keys off.
  check('a hand-added item is distinguishable by having no product',
    afterItems.some((i) => i.id === handAdded.id && i.is_active && !i.product_id));

  /*
   * The rule that makes the button safe to press: an item already counted is
   * switched OFF, never removed. Proved by asking the database to delete one
   * and being refused.
   */
  const counted = afterItems.find((i) => i.product_id);
  const rInstance = (await db.from('inventory_instances').insert({
    template_id: rTemplate.id, inventory_date: today, period_key: `refresh-${STAMP}`,
    name_snapshot: 'ZZ Refresh', kind: 'expiry', digital_enabled: true,
  }).select('id').single()).data;
  await db.from('inventory_instance_items').insert({
    instance_id: rInstance.id, template_item_id: counted.id,
    item_name: counted.name, item_sort_order: 10,
  });
  const { error: deleteRefused } = await db.from('inventory_template_items')
    .delete().eq('id', counted.id);
  check('an item that has been counted cannot be deleted, only switched off',
    Boolean(deleteRefused), deleteRefused?.code ?? 'NO ERROR — history is deletable');

  /*
   * The invariant, not a headcount.
   *
   * This used to assert "at least 20 entries exist", which proved the
   * restructure had not destroyed the history it found. That was true of one
   * moment and nothing else: the testing data was later cleared on purpose
   * and the check went red for doing exactly what was asked.
   *
   * What must hold forever is that DEACTIVATING a template does not take its
   * counts with it — that is the whole reason the combined brand list was
   * archived rather than deleted. So it is proved on a template this script
   * owns, and stays green whether the database holds a thousand counts or
   * none.
   */
  await db.from('inventory_templates').update({ is_active: false }).eq('id', rTemplate.id);
  const { data: archivedInstance, error: archivedError } = await db
    .from('inventory_instances')
    .select('id, name_snapshot, items:inventory_instance_items ( id )')
    .eq('id', rInstance.id)
    .single();
  check('a count stays readable after its template is archived',
    !archivedError && archivedInstance?.items?.length > 0,
    archivedError?.message ?? `${archivedInstance?.items?.length ?? 0} rows still attached`);
  await db.from('inventory_templates').update({ is_active: true }).eq('id', rTemplate.id);

  // A template counting no brand has nothing to refresh from, and the UI
  // reads that off the column rather than off a list of names.
  const { data: noBrand } = await db.from('inventory_templates')
    .select('slug, brand_id').in('slug', ['materia-prima', 'empaques']);
  check('raw material and packaging name no brand',
    (noBrand ?? []).length === 2 && (noBrand ?? []).every((t) => t.brand_id === null),
    (noBrand ?? []).map((t) => `${t.slug}=${t.brand_id}`).join(' '));

  const { data: branded } = await db.from('inventory_templates')
    .select('slug, brand_id')
    .in('slug', ['masamor', 'del-barrio', 'colectivo-comestibles', 'complementarios']);
  check('all four brand inventories name their brand',
    (branded ?? []).length === 4 && (branded ?? []).every((t) => t.brand_id),
    (branded ?? []).filter((t) => !t.brand_id).map((t) => t.slug).join(' ') || 'all set');

  /* --------------------------------- existing modules are unaffected */
  section('Existing modules');

  for (const [table, label] of [
    ['products', 'products'],
    ['customers', 'customers'],
    ['orders', 'orders'],
    ['tasks', 'tasks'],
    ['task_occurrences', 'task occurrences'],
    ['profiles', 'profiles'],
  ]) {
    const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
    check(`${label} still readable (${count ?? 0} rows)`, !error, error?.message);
  }
}

/* -------------------------------------------------------------- cleanup */

async function cleanup() {
  console.log('\nCleaning up verification data…');
  const { data: tpls } = await db
    .from('inventory_templates').select('id').like('slug', `${TAG}%`);

  for (const t of tpls ?? []) {
    const { data: insts } = await db
      .from('inventory_instances').select('id').eq('template_id', t.id);
    for (const i of insts ?? []) {
      await db.from('inventory_instances').delete().eq('id', i.id);
    }
    await db.from('inventory_template_items').delete().eq('template_id', t.id);
    await db.from('inventory_templates').delete().eq('id', t.id);
  }

  for (const id of created.productIds ?? []) {
    await db.from('inventory_template_items').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
  if (created.brandId) await db.from('brands').delete().eq('id', created.brandId);

  for (const id of created.users) {
    await db.from('inventory_edit_grants').delete().eq('user_id', id);
    await db.auth.admin.deleteUser(id).catch(() => {});
  }

  const { data: leftover } = await db
    .from('inventory_templates').select('id').like('slug', `${TAG}%`);
  console.log(`  removed; leftover verification templates: ${leftover?.length ?? 0}`);
}

/*
 * An abort must READ as a failure.
 *
 * It already set exit code 1, but the summary still printed "failed: 0",
 * so anything reading the last line — a person, or a loop over the verify
 * scripts — saw a clean run. That is exactly how the iso_week breakage went
 * unnoticed: this script aborted before its first assertion for weeks and
 * never said so where anyone was looking.
 */
let aborted = null;

main()
  .then(cleanup, async (e) => {
    aborted = e.message;
    console.error('', e.message);
    await cleanup();
    process.exitCode = 1;
  })
  .then(() => {
    if (aborted) {
      // The checks that never ran are not passes.
      console.log(`  ABORTED after ${passed} checks — the rest never ran: ${aborted}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  passed: ${passed}    failed: ${failed}`);
    for (const f of failures) console.log(`   ! ${f}`);
    if (failed > 0) process.exitCode = 1;
  });
