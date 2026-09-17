/**
 * Suggest a net weight for every product that has none, from its name.
 *
 *   npm run products:prefill-weights            # write
 *   npm run products:prefill-weights -- --dry   # only print what it would do
 *
 * Uses suggestNetWeightKg() — the same rule the product dialog offers — and
 * marks each value net_weight_suggested, so Manage -> Products shows it as
 * "to review" until somebody saves the product.
 *
 * Never overwrites: a product that already has a weight, suggested or
 * confirmed, is left exactly as it is. Safe to run again after new products
 * are imported.
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { suggestNetWeightKg } from '../src/domain/orders/weight';

loadEnv({ path: '.env', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const dry = process.argv.includes('--dry');
const admin = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await admin
    .from('products')
    .select('id, name, family, presentation, is_active')
    .is('net_weight_kg', null);
  if (error) throw new Error(error.message);

  const products = data ?? [];
  let suggested = 0;
  const left: string[] = [];

  for (const p of products) {
    const label = p.name ?? `${p.family} ${p.presentation}`;
    const kg = suggestNetWeightKg(p.name, p.family, p.presentation);
    if (kg === null) {
      left.push(label);
      continue;
    }
    suggested++;
    if (dry) {
      console.log(`${String(kg).padStart(7)} kg  ${label}`);
      continue;
    }
    const { error: upd } = await admin
      .from('products')
      .update({ net_weight_kg: kg, net_weight_suggested: true })
      .eq('id', p.id)
      .is('net_weight_kg', null);
    if (upd) throw new Error(`${label}: ${upd.message}`);
  }

  console.log(`\n${dry ? 'Would suggest' : 'Suggested'} a weight for ${suggested} of ${products.length} products without one.`);
  if (left.length) {
    console.log(`Left empty (${left.length}) — nothing clear in the name:`);
    for (const l of left) console.log(`  - ${l}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
