/**
 * Draft German and English titles for the logistics activities.
 *
 *   npm run tasks:translate          apply the drafts (idempotent)
 *   npm run tasks:translate -- --dry show what would change
 *
 * These are DRAFTS written from the Spanish originals, not verified
 * translations. Product and place names are deliberately left verbatim —
 * "Jamaica", "Chapulines", "Chile Guajillo", "Nopales", "Tomatillo
 * Tatemado", "Masamor", "Del Barrio", "Palomo", "Emmi", "europallets" and
 * "Gastro/Retail" are catalogue terms, not words to translate.
 *
 * Existing translations are never overwritten: whatever an admin has edited
 * in the app wins, so re-running this only fills gaps.
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

interface Draft { de: string; en: string }

/** Keyed by the exact Spanish title. Repeated titles across frequencies
 *  (the inventories, "Limpieza Palomo") intentionally share one entry. */
const DRAFTS: Record<string, Draft> = {
  // ---------- daily ----------
  'Mantener el orden en el área de trabajo durante la jornada': {
    de: 'Arbeitsbereich während der Schicht in Ordnung halten',
    en: 'Keep the work area tidy throughout the shift',
  },
  'Preparar pedidos para entrega o despacho.': {
    de: 'Bestellungen für Lieferung oder Versand vorbereiten',
    en: 'Prepare orders for delivery or dispatch',
  },
  'Recibir y revisar la mercancía que llega al almacén': {
    de: 'Eingehende Ware im Lager annehmen und prüfen',
    en: 'Receive and check goods arriving at the warehouse',
  },
  'Registrar entradas en el sistema (Operaciones)': {
    de: 'Wareneingänge im System erfassen (Operaciones)',
    en: 'Record incoming goods in the system (Operaciones)',
  },

  // ---------- weekly: housekeeping ----------
  'Acomodar el producto en su lugar correspondiente.': {
    de: 'Produkte an ihren richtigen Platz einordnen',
    en: 'Put products in their correct place',
  },
  'Acomodar los europallets.': {
    de: 'Europalletten aufräumen',
    en: 'Arrange the europallets',
  },
  'Aplastar cartón': { de: 'Karton zusammendrücken', en: 'Flatten cardboard' },
  'Aspirar el almacén': { de: 'Lager saugen', en: 'Vacuum the warehouse' },
  'Mopear el almacén (si es necesario)': {
    de: 'Lager wischen (falls nötig)',
    en: 'Mop the warehouse (if necessary)',
  },
  'Reacomodar los productos según su rotación.': {
    de: 'Produkte nach ihrer Rotation neu einordnen',
    en: 'Rearrange products according to their rotation',
  },
  'Recolección de tanques de gas': {
    de: 'Gasflaschen einsammeln',
    en: 'Collection of gas tanks',
  },
  'Tirar la basura de los botes negros': {
    de: 'Müll aus den schwarzen Tonnen entsorgen',
    en: 'Take out the rubbish from the black bins',
  },
  'Tirar plástico': { de: 'Plastik entsorgen', en: 'Dispose of plastic' },

  // ---------- weekly: labelling ----------
  'Etiquetado tortillas trigo Gastro 30 cm + rotación de producto': {
    de: 'Etikettierung Weizen-Tortillas Gastro 30 cm + Produktrotation',
    en: 'Labelling wheat tortillas Gastro 30 cm + product rotation',
  },
  'Etiquetar Chile Jalapeño 1kg': {
    de: 'Chile Jalapeño 1kg etikettieren',
    en: 'Label Chile Jalapeño 1kg',
  },
  'Etiquetar Chile Poblano en rajas 1kg': {
    de: 'Chile Poblano en rajas 1kg etikettieren',
    en: 'Label Chile Poblano en rajas 1kg',
  },
  'Etiquetar chile poblano entero 1kg': {
    de: 'Chile Poblano ganz 1kg etikettieren',
    en: 'Label whole Chile Poblano 1kg',
  },
  'Etiquetar Chile Serrano 1kg': {
    de: 'Chile Serrano 1kg etikettieren',
    en: 'Label Chile Serrano 1kg',
  },
  'Etiquetar chorizo retail': {
    de: 'Chorizo Retail etikettieren',
    en: 'Label chorizo retail',
  },
  'Etiquetar Nopales en rajas 1kg': {
    de: 'Nopales en rajas 1kg etikettieren',
    en: 'Label Nopales en rajas 1kg',
  },
  'Etiquetar Tomatillo Tatemado 1kg': {
    de: 'Tomatillo Tatemado 1kg etikettieren',
    en: 'Label Tomatillo Tatemado 1kg',
  },
  'Etiquetar tortillas de trigo retail 12 cm (1 caja).': {
    de: 'Weizen-Tortillas Retail 12 cm etikettieren (1 Karton)',
    en: 'Label wheat tortillas retail 12 cm (1 box)',
  },
  'Etiquetar tortillas de trigo retail 15 cm (2 caja).': {
    de: 'Weizen-Tortillas Retail 15 cm etikettieren (2 Kartons)',
    en: 'Label wheat tortillas retail 15 cm (2 boxes)',
  },
  'Etiquetar tortillas de trigo retail 30 cm (3 unidades).': {
    de: 'Weizen-Tortillas Retail 30 cm etikettieren (3 Stück)',
    en: 'Label wheat tortillas retail 30 cm (3 units)',
  },

  // ---------- weekly: stock levels ----------
  'Mantener un stock de 10 unidades de Jamaica 1Kg Gastro': {
    de: 'Bestand von 10 Stück Jamaica 1Kg Gastro halten',
    en: 'Keep a stock of 10 units of Jamaica 1Kg Gastro',
  },
  'Mantener un stock de 10 unidades de Jamaica 250g retail': {
    de: 'Bestand von 10 Stück Jamaica 250g Retail halten',
    en: 'Keep a stock of 10 units of Jamaica 250g retail',
  },
  'Mantener un stock de 15 unidades de Harina 1kg': {
    de: 'Bestand von 15 Stück Harina 1kg halten',
    en: 'Keep a stock of 15 units of Harina 1kg',
  },
  'Mantener un stock de 20 unidades de Cal 50g': {
    de: 'Bestand von 20 Stück Cal 50g halten',
    en: 'Keep a stock of 20 units of Cal 50g',
  },
  'Mantener un stock de 20 unidades de Chapulines 100 g gastro.': {
    de: 'Bestand von 20 Stück Chapulines 100 g Gastro halten',
    en: 'Keep a stock of 20 units of Chapulines 100 g gastro',
  },
  'Mantener un stock de 20 unidades de Chile Ancho 100g Retail.': {
    de: 'Bestand von 20 Stück Chile Ancho 100g Retail halten',
    en: 'Keep a stock of 20 units of Chile Ancho 100g Retail',
  },
  'Mantener un stock de 20 unidades de Chile Árbol 100g Retail.': {
    de: 'Bestand von 20 Stück Chile Árbol 100g Retail halten',
    en: 'Keep a stock of 20 units of Chile Árbol 100g Retail',
  },
  'Mantener un stock de 20 unidades de Chile Chipotle (Morita) 100g Retail.': {
    de: 'Bestand von 20 Stück Chile Chipotle (Morita) 100g Retail halten',
    en: 'Keep a stock of 20 units of Chile Chipotle (Morita) 100g Retail',
  },
  'Mantener un stock de 20 unidades de Chile Guajillo 100g Retail.': {
    de: 'Bestand von 20 Stück Chile Guajillo 100g Retail halten',
    en: 'Keep a stock of 20 units of Chile Guajillo 100g Retail',
  },
  'Mantener un stock de 20 unidades de Chile Pasilla 100g Retail.': {
    de: 'Bestand von 20 Stück Chile Pasilla 100g Retail halten',
    en: 'Keep a stock of 20 units of Chile Pasilla 100g Retail',
  },
  'Mantener un stock de 50 unidades de Chapulines 15g Retail.': {
    de: 'Bestand von 50 Stück Chapulines 15g Retail halten',
    en: 'Keep a stock of 50 units of Chapulines 15g Retail',
  },
  'Mantener un stock de 50 unidades de Chile Poblano 500g': {
    de: 'Bestand von 50 Stück Chile Poblano 500g halten',
    en: 'Keep a stock of 50 units of Chile Poblano 500g',
  },
  'Mantener un stock de 50 unidades de Chile Serrano 250g': {
    de: 'Bestand von 50 Stück Chile Serrano 250g halten',
    en: 'Keep a stock of 50 units of Chile Serrano 250g',
  },

  // ---------- inventories (shared across frequencies) ----------
  'Realizar el inventario de productos Masamor y Del Barrio.': {
    de: 'Inventur der Produkte Masamor und Del Barrio durchführen',
    en: 'Carry out the inventory of Masamor and Del Barrio products',
  },
  'Realizar el inventario de los productos de Colectivo Comestibles, La Güera del Barrio y Tatemados': {
    de: 'Inventur der Produkte von Colectivo Comestibles, La Güera del Barrio und Tatemados durchführen',
    en: 'Carry out the inventory of Colectivo Comestibles, La Güera del Barrio and Tatemados products',
  },
  'Realizar el inventario de cajas Emmi': {
    de: 'Inventur der Emmi-Kartons durchführen',
    en: 'Carry out the inventory of Emmi boxes',
  },
  'Realizar el inventario de cartón de caja Masamor tortilla': {
    de: 'Inventur der Kartonage Masamor Tortilla durchführen',
    en: 'Carry out the inventory of Masamor tortilla box cardboard',
  },
  'Realizar el inventario de cartón de caja Masamor totopo': {
    de: 'Inventur der Kartonage Masamor Totopo durchführen',
    en: 'Carry out the inventory of Masamor totopo box cardboard',
  },
  'Realizar el inventario de Empaques Mensuales (bolsas, cartones quesos, etc)': {
    de: 'Monatliche Inventur der Verpackungen durchführen (Beutel, Käsekartons usw.)',
    en: 'Carry out the monthly packaging inventory (bags, cheese boxes, etc.)',
  },
  'Realizar el inventario de Empaques Semestral (bolsas, cartones, etc)': {
    de: 'Halbjährliche Inventur der Verpackungen durchführen (Beutel, Kartons usw.)',
    en: 'Carry out the half-yearly packaging inventory (bags, boxes, etc.)',
  },
  'Realizar el inventario de Materia prima (maíz, harina Bio, harina No Bio, sal, cal y aceite, etc.)': {
    de: 'Inventur der Rohstoffe durchführen (Mais, Bio-Mehl, Nicht-Bio-Mehl, Salz, Kalk und Öl usw.)',
    en: 'Carry out the raw-material inventory (maize, organic flour, non-organic flour, salt, lime and oil, etc.)',
  },

  // ---------- cleaning / waste ----------
  'Limpieza Palomo': { de: 'Reinigung Palomo', en: 'Palomo cleaning' },
  'Realizar el reciclaje': { de: 'Recycling durchführen', en: 'Do the recycling' },
};

async function main() {
  const dry = process.argv.includes('--dry');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: tasks, error } = await db.from('tasks').select('id, title, translations');
  if (error) throw new Error(error.message);

  let filled = 0;
  let kept = 0;
  const missing: string[] = [];

  for (const task of tasks ?? []) {
    const draft = DRAFTS[task.title.trim()];
    if (!draft) { missing.push(task.title); continue; }

    const current = (task.translations ?? {}) as Record<string, { title?: string | null }>;
    // Never clobber a human edit — only fill an empty slot.
    const next = { ...current };
    let changed = false;
    for (const locale of ['de', 'en'] as const) {
      const existing = current[locale]?.title;
      if (existing && existing.trim()) { kept++; continue; }
      next[locale] = { ...current[locale], title: draft[locale] };
      changed = true;
    }
    if (!changed) continue;

    if (!dry) {
      const { error: upErr } = await db.from('tasks').update({ translations: next }).eq('id', task.id);
      if (upErr) { console.error(`  ! ${task.title}: ${upErr.message}`); continue; }
    }
    filled++;
  }

  console.log('');
  console.log(`  tasks in database        : ${tasks?.length ?? 0}`);
  console.log(`  drafts available         : ${Object.keys(DRAFTS).length}`);
  console.log(`  ${dry ? 'would fill' : 'filled'}              : ${filled}`);
  console.log(`  existing kept untouched : ${kept}`);
  if (missing.length) {
    console.log(`  NO draft for ${missing.length}:`);
    for (const m of missing) console.log(`     - ${m}`);
  }
  if (dry) console.log('\n  (dry run — nothing written)');
}

main().catch((e) => {
  console.error(`\nERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
