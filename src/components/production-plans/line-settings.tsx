'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, Checkbox, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PLAN_SECTIONS, type PlanSection } from '@/domain/production-plan/plan';
import { removeLineProduct, saveLineMaterials, saveLineProduct, saveProductionLine } from '@/server/production-plan-actions';
import type { LineProduct, ProductionLine } from '@/server/production-plans';
import { usePlanError } from './plan-view';

type CatalogueProduct = { id: string; code: string | null; name: string; weight: number | null };

/** The lines: one tab each — its factors, standing notes and products. */
export function LineSettings({
  lines,
  lineProducts,
  products,
  materials,
}: {
  lines: ProductionLine[];
  lineProducts: LineProduct[];
  products: CatalogueProduct[];
  materials: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(lines[0]?.id ?? '');
  const line = lines.find((l) => l.id === active);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/production-plans" className="mb-1 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t('productionPlans.title')}
        </Link>
        <h1 className="text-xl font-semibold leading-tight">{t('productionPlans.settings')}</h1>
        <p className="mt-1 text-[13px] text-muted">{t('productionPlans.settingsSubtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {lines.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setActive(l.id)}
            className={cn('rounded-full border px-3 py-1 text-[13px]', l.id === active ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg')}
          >
            {l.name}
          </button>
        ))}
      </div>
      {line && (
        <div key={line.id} className="space-y-4">
          <FactorsCard line={line} />
          <MaterialsCard line={line} materials={materials} />
          <ProductsCard line={line} lineProducts={lineProducts.filter((p) => p.line_id === line.id)} products={products} />
        </div>
      )}
    </div>
  );
}

const FACTORS = ['pure_share', 'waste', 'masa_per_grain_kg', 'sack_kg', 'totopo_factor', 'evaporation', 'flour_factor', 'water_factor', 'salt_factor'] as const;
type FactorKey = (typeof FACTORS)[number];
const OPTIONAL: FactorKey[] = ['evaporation', 'flour_factor', 'water_factor', 'salt_factor'];

function FactorsCard({ line }: { line: ProductionLine }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [values, setValues] = useState<Record<FactorKey, string>>(
    Object.fromEntries(FACTORS.map((k) => [k, line[k] == null ? '' : String(line[k])])) as Record<FactorKey, string>,
  );
  const [notes, setNotes] = useState(line.standing_notes ?? '');

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{t('productionPlans.factors')}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t('productionPlans.factorsHint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {FACTORS.map((k) => (
          <Field key={k} label={t(`productionPlans.factor.${k}` as MessageKey)} hint={t(`productionPlans.factorHint.${k}` as MessageKey)}>
            <Input
              inputMode="decimal"
              value={values[k]}
              placeholder={OPTIONAL.includes(k) ? '—' : undefined}
              onChange={(e) => { setSaved(false); setValues((v) => ({ ...v, [k]: e.target.value.replace(',', '.') })); }}
            />
          </Field>
        ))}
      </div>
      <Field label={t('productionPlans.standingNotes')} hint={t('productionPlans.standingNotesHint')}>
        <NoteTextarea value={notes} onChange={(e) => { setSaved(false); setNotes(e.target.value); }} rows={3} />
      </Field>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const n = (k: FactorKey) => (values[k].trim() === '' ? null : Number(values[k]));
              const res = await saveProductionLine(line.id, {
                pure_share: n('pure_share') ?? 1,
                waste: n('waste') ?? 0,
                masa_per_grain_kg: n('masa_per_grain_kg') ?? 1,
                sack_kg: n('sack_kg') ?? 22.68,
                totopo_factor: n('totopo_factor') ?? 1,
                evaporation: n('evaporation'),
                flour_factor: n('flour_factor'),
                water_factor: n('water_factor'),
                salt_factor: n('salt_factor'),
                standing_notes: notes.trim() || null,
              });
              if (!res.ok) return setError(translateError(res.error));
              setError(null);
              setSaved(true);
              router.refresh();
            })
          }
        >
          {t('common.save')}
        </Button>
        {saved && <span className="text-[12px] text-done">{t('productionPlans.saved')}</span>}
        {error && <span className="text-[12px] text-late">{error}</span>}
      </div>
    </Card>
  );
}

/** Which raw materials (Materia Prima items) the line's plans carry a lot for. */
function MaterialsCard({ line, materials }: { line: ProductionLine; materials: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [chosen, setChosen] = useState<string[]>(line.material_item_ids);

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{t('productionPlans.lineMaterials')}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t('productionPlans.lineMaterialsHint')}</p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {materials.map((m) => (
          <Checkbox
            key={m.id}
            label={m.name}
            checked={chosen.includes(m.id)}
            onChange={(e) => {
              setSaved(false);
              setChosen((all) => (e.target.checked ? materials.filter((x) => x.id === m.id || all.includes(x.id)).map((x) => x.id) : all.filter((id) => id !== m.id)));
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await saveLineMaterials(line.id, chosen);
              if (!res.ok) return setError(translateError(res.error));
              setError(null);
              setSaved(true);
              router.refresh();
            })
          }
        >
          {t('common.save')}
        </Button>
        {saved && <span className="text-[12px] text-done">{t('productionPlans.saved')}</span>}
        {error && <span className="text-[12px] text-late">{error}</span>}
      </div>
    </Card>
  );
}

function ProductsCard({ line, lineProducts, products }: { line: ProductionLine; lineProducts: LineProduct[]; products: CatalogueProduct[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const translateError = usePlanError();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const sorted = [...lineProducts].sort((a, b) => PLAN_SECTIONS.indexOf(a.section) - PLAN_SECTIONS.indexOf(b.section) || a.sort_order - b.sort_order);

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await task();
      if (!res.ok) setError(translateError(res.error ?? 'unknown'));
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <div>
        <h2 className="text-[15px] font-semibold">{t('productionPlans.lineProducts')}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t('productionPlans.lineProductsHint')}</p>
      </div>
      {error && <p className="text-[12px] text-late">{error}</p>}
      <ul className="divide-y divide-border">
        {sorted.map((p) => (
          <ProductRow key={p.product_id} line={line} item={p} pending={pending} run={run} />
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Combobox
            items={products.filter((p) => !lineProducts.some((lp) => lp.product_id === p.id))}
            value={adding}
            onChange={setAdding}
            getKey={(p) => p.id}
            getLabel={(p) => `${p.code ? `${p.code} · ` : ''}${p.name}`}
            getSearchText={(p) => `${p.code ?? ''} ${p.name}`}
            placeholder={t('productionPlans.addProduct')}
            clearable
          />
        </div>
        <Button
          size="sm"
          disabled={!adding || pending}
          onClick={() =>
            adding &&
            run(async () => {
              const res = await saveLineProduct(line.id, adding, {
                section: 'tortilla',
                group_label: t('productionPlans.newGroup'),
                best_before_days: null,
                sort_order: Math.max(0, ...lineProducts.map((p) => p.sort_order)) + 10,
              });
              if (res.ok) setAdding(null);
              return res;
            })
          }
        >
          {t('productionPlans.add')}
        </Button>
      </div>
    </Card>
  );
}

function ProductRow({
  line,
  item,
  pending,
  run,
}: {
  line: ProductionLine;
  item: LineProduct;
  pending: boolean;
  run: (task: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<PlanSection>(item.section);
  const [group, setGroup] = useState(item.group_label);
  const [days, setDays] = useState(item.best_before_days == null ? '' : String(item.best_before_days));
  const [order, setOrder] = useState(String(item.sort_order));
  const dirty =
    section !== item.section || group !== item.group_label || days !== (item.best_before_days == null ? '' : String(item.best_before_days)) || order !== String(item.sort_order);

  return (
    <li className="py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px]">
          <span className="font-medium tabular-nums">{item.code ?? '—'}</span> · {item.name}
          {item.weight_kg == null && <span className="ml-1.5 text-[11.5px] text-warn">{t('productionPlans.noWeight')}</span>}
        </p>
        <Button size="icon" variant="ghost" aria-label={t('common.delete')} disabled={pending} onClick={() => run(() => removeLineProduct(line.id, item.product_id))}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-[9rem_1fr_7rem_5rem_auto]">
        <Select aria-label={t('productionPlans.sectionLabel')} value={section} onChange={(e) => setSection(e.target.value as PlanSection)}>
          {PLAN_SECTIONS.map((s) => <option key={s} value={s}>{t(`productionPlans.section.${s}` as MessageKey)}</option>)}
        </Select>
        <Input aria-label={t('productionPlans.groupLabel')} value={group} onChange={(e) => setGroup(e.target.value)} />
        <Input aria-label={t('productionPlans.bestBeforeDays')} placeholder={t('productionPlans.bestBeforeDays')} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        <Input aria-label={t('productionPlans.sortOrder')} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
        {dirty && (
          <Button
            size="sm"
            disabled={pending || !group.trim()}
            onClick={() =>
              run(() =>
                saveLineProduct(line.id, item.product_id, {
                  section,
                  group_label: group.trim(),
                  best_before_days: days.trim() === '' ? null : Math.round(Number(days)),
                  sort_order: Math.round(Number(order) || 0),
                }),
              )
            }
          >
            {t('common.save')}
          </Button>
        )}
      </div>
    </li>
  );
}
