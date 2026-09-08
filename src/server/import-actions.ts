'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getViewer } from './data';
import { readWorkbook } from './workbook';
import { getImportCatalog, getOrderRequestTemplates } from './order-import';
import { buildPreview, type PreviewLine, type SourceRow } from '@/domain/orders/import/pipeline';
import { parseOrderText } from '@/domain/orders/import/email';
import {
  extractRows,
  identifyTemplate,
  parseQuantityCell,
  pickSheet,
  rowUnit,
  type OrderRequestTemplate,
  type Sheet,
} from '@/domain/orders/import/template';
import type { ActionResult } from './actions';

/**
 * Order Request import actions.
 *
 * These actions READ ONLY. They turn a file or a block of pasted text into a
 * proposal the user reviews; nothing they do creates an order, an order line,
 * a product or a customer. Creation stays where it already was — `saveOrder`
 * in order-actions.ts — so an imported order takes exactly the path a
 * hand-entered one takes and cannot diverge from it.
 *
 * Matching runs HERE rather than in the browser: the catalogue stays on the
 * server, and the ids the preview carries are then re-validated by saveOrder
 * anyway. RLS is still the boundary — the capability check below is so the
 * UI fails with a sentence instead of an empty list.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Enough for the largest real order request; past this something is wrong. */
const MAX_PREVIEW_LINES = 500;
const MAX_TEXT_LENGTH = 20000;

export interface PreviewResult {
  lines: PreviewLine[];
  /** The template a file was read through, so the preview can name it. */
  templateId: string | null;
  templateName: string | null;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Technical detail never reaches the user; it reaches the server log, which is
 * where the existing modules put theirs.
 */
function logged(scope: string, err: unknown, code: string): { ok: false; error: string } {
  console.error(`[import:${scope}]`, err);
  return fail(code);
}

async function requireImporter(): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.status !== 'approved') return fail('not_authorized');
  // Importing produces an order, so it needs the capability that creating one
  // needs. Nothing weaker, and no new permission key.
  if (!viewer.can('orders.manage')) return fail('not_authorized');
  return { ok: true };
}

/* ------------------------------ pasted text ----------------------------- */

const textSchema = z.object({
  customer_id: z.string().uuid(),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

/**
 * Method C — paste an email or order text.
 *
 * The customer is chosen by the user, never derived from the message. That is
 * a safety decision, not a missing feature: a forwarded email carries the
 * forwarder's address, a shared mailbox carries nobody's, and an order
 * attributed to the wrong restaurant is discovered at the delivery door.
 */
export async function previewOrderText(
  input: z.infer<typeof textSchema>,
): Promise<ActionResult<PreviewResult>> {
  const gate = await requireImporter();
  if (!gate.ok) return gate;

  const parsed = textSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_input');

  try {
    const { products, aliases } = await getImportCatalog(parsed.data.customer_id);

    const rows: SourceRow[] = parseOrderText(parsed.data.text)
      .slice(0, MAX_PREVIEW_LINES)
      .map((line) => ({
        sourceText: line.raw,
        productText: line.productText,
        quantity: line.quantity,
        unit: line.unit,
        // An email's prose is not a per-line note. Attributing a sentence to
        // one line would put the wrong words on the wrong product.
        note: null,
      }));

    if (rows.length === 0) return fail('no_lines_detected');

    return {
      ok: true,
      data: {
        lines: buildPreview(rows, products, aliases, parsed.data.customer_id),
        templateId: null,
        templateName: null,
      },
    };
  } catch (err) {
    return logged('text', err, 'import_failed');
  }
}

/* ------------------------------ excel file ------------------------------ */

export interface FilePreviewResult extends PreviewResult {
  /**
   * Populated only when several templates fit the file, so the user can pick
   * one instead of the importer guessing.
   */
  choices?: { id: string; name: string }[];
}

/**
 * Method B — import a customer Order Request file.
 *
 * FormData rather than a JSON payload, because that is how a browser sends a
 * file without the application base64-ing it through a server action first.
 *
 * `templateId` is optional. Left out, the file is identified from its sheet
 * and headers; supplied, that template is used, which is how the user answers
 * "could not identify this template" and how they resolve an ambiguity.
 */
export async function previewOrderRequestFile(
  formData: FormData,
): Promise<ActionResult<FilePreviewResult>> {
  const gate = await requireImporter();
  if (!gate.ok) return gate;

  const customerId = String(formData.get('customer_id') ?? '');
  const templateId = String(formData.get('template_id') ?? '') || null;
  const file = formData.get('file');

  if (!z.string().uuid().safeParse(customerId).success) return fail('invalid_input');
  if (!(file instanceof File) || file.size === 0) return fail('invalid_input');
  if (file.size > MAX_FILE_BYTES) return fail('file_too_large');

  try {
    const templates = await getOrderRequestTemplates(customerId);
    if (templates.length === 0) return fail('template_not_identified');

    let sheets: Sheet[];
    try {
      sheets = await readWorkbook(await file.arrayBuffer());
    } catch (err) {
      // A .numbers file, a CSV renamed to .xlsx, a corrupted download.
      return logged('workbook', err, 'unreadable_file');
    }
    if (sheets.length === 0) return fail('unreadable_file');

    // ---- which template ----
    let template: OrderRequestTemplate;
    let sheet: Sheet | null;

    if (templateId) {
      const chosen = templates.find((t) => t.id === templateId);
      if (!chosen) return fail('invalid_input');
      template = chosen;
      sheet = pickSheet(sheets, chosen.sheet_name);
      if (!sheet) return fail('sheet_not_found');
    } else {
      const identified = identifyTemplate(sheets, templates);
      if (identified.status === 'not_found') return fail('template_not_identified');
      if (identified.status === 'ambiguous') {
        return {
          ok: true,
          data: {
            lines: [],
            templateId: null,
            templateName: null,
            choices: identified.templates.map((t) => ({ id: t.id, name: t.name })),
          },
        };
      }
      template = identified.template;
      sheet = identified.sheet;
    }

    // ---- which rows ----
    const extracted = extractRows(sheet, template);
    if (extracted.status === 'column_not_found') {
      return fail(
        extracted.column === 'product' ? 'product_column_not_found' : 'quantity_column_not_found',
      );
    }
    if (extracted.rows.length === 0) return fail('no_lines_detected');

    const { products, aliases } = await getImportCatalog(customerId);

    const rows: SourceRow[] = extracted.rows.slice(0, MAX_PREVIEW_LINES).map((r) => ({
      sourceText: r.productText || `${r.quantityText}`,
      productText: r.productText,
      quantity: parseQuantityCell(r.quantityText),
      unit: rowUnit(r, template),
      rowNumber: r.rowNumber,
      // The customer's own comment column, carried into the existing order
      // line note. No second note system is created for imports.
      note: r.note,
    }));

    return {
      ok: true,
      data: {
        lines: buildPreview(rows, products, aliases, customerId),
        templateId: template.id,
        templateName: template.name,
      },
    };
  } catch (err) {
    return logged('file', err, 'import_failed');
  }
}

/* ------------------------ template administration ----------------------- */

const templateSchema = z.object({
  customer_id: z.string().uuid(),
  name: z.string().trim().min(1),
  sheet_name: z.string().trim().nullable(),
  header_row: z.number().int().min(1).nullable(),
  first_data_row: z.number().int().min(1),
  product_column: z.string().trim().min(1),
  quantity_column: z.string().trim().min(1),
  notes_column: z.string().trim().nullable(),
  unit_column: z.string().trim().nullable(),
  default_unit: z.enum(['unit', 'box']),
  header_signature: z.array(z.string().trim().min(1)),
  is_active: z.boolean(),
});

export async function saveOrderRequestTemplate(
  input: z.infer<typeof templateSchema>,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_template');

  // A column addressed by LABEL needs a header row to look the label up in.
  // Caught here so the template cannot be saved in a shape that would fail on
  // every file it is later pointed at.
  const byLabel = [
    parsed.data.product_column,
    parsed.data.quantity_column,
    parsed.data.notes_column,
    parsed.data.unit_column,
  ].some((c) => c && !/^[A-Za-z]{1,3}$/.test(c.trim()));
  if (byLabel && parsed.data.header_row === null) return fail('header_row_required');

  const supabase = createClient();
  const { error, data } = id
    ? await supabase.from('order_request_templates').update(parsed.data).eq('id', id).select('id').single()
    : await supabase.from('order_request_templates').insert(parsed.data).select('id').single();

  if (error) {
    if (error.message.includes('row-level security')) return fail('not_authorized');
    return logged('template', error, 'save_failed');
  }
  revalidatePath('/admin/order-templates');
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function deleteOrderRequestTemplate(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('order_request_templates').delete().eq('id', id);
  if (error) {
    if (error.message.includes('row-level security')) return fail('not_authorized');
    return logged('template', error, 'save_failed');
  }
  revalidatePath('/admin/order-templates');
  return { ok: true, data: undefined };
}

/* --------------------------- product aliases ---------------------------- */

const aliasSchema = z.object({
  product_id: z.string().uuid(),
  /** NULL = the alias applies to every customer. */
  customer_id: z.string().uuid().nullable(),
  alias: z.string().trim().min(1).max(200),
});

export async function addProductAlias(
  input: z.infer<typeof aliasSchema>,
): Promise<ActionResult> {
  const parsed = aliasSchema.safeParse(input);
  if (!parsed.success) return fail('invalid_alias');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('product_aliases')
    .insert({ ...parsed.data, created_by: user?.id ?? null });

  if (error) {
    // The unique indexes are what guarantee an alias names one product. A
    // collision is a real answer — "that alias already belongs to something" —
    // not a technical failure to hide.
    if (error.message.includes('product_aliases_customer_key')) return fail('alias_in_use');
    if (error.message.includes('product_aliases_global_key')) return fail('alias_in_use');
    if (error.message.includes('row-level security')) return fail('not_authorized');
    return logged('alias', error, 'save_failed');
  }
  revalidatePath('/admin/products');
  return { ok: true, data: undefined };
}

export async function deleteProductAlias(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from('product_aliases').delete().eq('id', id);
  if (error) {
    if (error.message.includes('row-level security')) return fail('not_authorized');
    return logged('alias', error, 'save_failed');
  }
  revalidatePath('/admin/products');
  return { ok: true, data: undefined };
}
