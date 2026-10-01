'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card, EmptyState, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { filterByQuery } from '@/lib/search';

type Product = { id: string; name: string; code: string | null; detail: string | null; brand: string | null };
type Customer = { id: string; name: string; addition: string | null; city: string | null; type: { slug: string; name: string } | null };

/** Products by brand and customers by name: read-only, searchable. */
export function CatalogView({ tab, products, customers }: { tab: 'products' | 'customers'; products: Product[]; customers: Customer[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const typeLabel = (type: Customer['type']) => {
    if (!type) return null;
    const key = `master.customerType.${type.slug}` as MessageKey;
    const label = t(key);
    return label === key ? type.name : label;
  };

  const shownProducts = filterByQuery(products, query, (p) => [p.name, p.code ?? '', p.brand ?? '', p.detail ?? ''].join(' '));
  const shownCustomers = filterByQuery(customers, query, (c) => [c.name, c.addition ?? '', c.city ?? ''].join(' '));
  // Products grouped by brand, brands in name order, those without one last.
  const brands = [...new Set(shownProducts.map((p) => p.brand ?? ''))].sort((a, b) => (a ? (b ? a.localeCompare(b) : -1) : 1));

  return (
    <>
      <PageHeader title={t('catalog.navLabel')} subtitle={t('catalog.subtitle')} />
      <div className="-mt-2 mb-3 flex gap-1 border-b border-border">
        {(['products', 'customers'] as const).map((key) => (
          <Link
            key={key}
            href={key === 'products' ? '/catalog' : '/catalog?tab=customers'}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'products' ? t('catalog.products', { count: products.length }) : t('catalog.customers', { count: customers.length })}
          </Link>
        ))}
      </div>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('catalog.search')} aria-label={t('catalog.search')} className="pl-9" />
      </div>

      {tab === 'products' ? (
        shownProducts.length === 0 ? (
          <EmptyState title={t('catalog.none')} />
        ) : (
          <div className="space-y-4">
            {brands.map((brand) => (
              <section key={brand || 'none'}>
                <h2 className="mb-1.5 px-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{brand || t('catalog.noBrand')}</h2>
                <Card className="divide-y divide-border">
                  {shownProducts
                    .filter((p) => (p.brand ?? '') === brand)
                    .map((p) => (
                      <div key={p.id} className="px-3.5 py-2">
                        <p className="text-[13.5px] font-medium">{p.name}</p>
                        {(p.code || p.detail) && <p className="text-[12px] text-muted">{[p.code, p.detail].filter(Boolean).join(' · ')}</p>}
                      </div>
                    ))}
                </Card>
              </section>
            ))}
          </div>
        )
      ) : shownCustomers.length === 0 ? (
        <EmptyState title={t('catalog.none')} />
      ) : (
        <Card className="divide-y divide-border">
          {shownCustomers.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{c.name}</p>
                {(c.addition || c.city) && <p className="text-[12px] text-muted">{[c.addition, c.city].filter(Boolean).join(' · ')}</p>}
              </div>
              {c.type && <Badge tone="neutral">{typeLabel(c.type)}</Badge>}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
