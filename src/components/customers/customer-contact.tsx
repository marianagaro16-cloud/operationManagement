'use client';

import { Globe, Mail, Phone, Smartphone } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import type { CustomerDetails } from '@/types/orders';

/** "www.x.ch" opens as a link too. */
const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;

/**
 * How to reach a customer, where to bill them, and their tax numbers — the
 * details first brought over from bexio. Read-only; Gestión → Clientes edits.
 */
export function CustomerContact({ details, website }: { details: CustomerDetails | null; website?: string | null }) {
  const { t } = useI18n();
  if (!details && !website) return null;
  const d = details;

  const reach = [
    ...[d?.email, d?.email2].filter(Boolean).map((v) => ({ icon: Mail, text: v!, link: `mailto:${v}` })),
    ...[d?.phone, d?.phone2].filter(Boolean).map((v) => ({ icon: Phone, text: v!, link: tel(v!) })),
    ...(d?.mobile ? [{ icon: Smartphone, text: d.mobile, link: tel(d.mobile) }] : []),
    ...(website ? [{ icon: Globe, text: website.replace(/^https?:\/\//i, ''), link: href(website) }] : []),
  ];
  const billing = d?.billing_address
    ? [d.billing_address.split(/\r?\n/).join(', '), [d.billing_postal_code, d.billing_city].filter(Boolean).join(' '), d.billing_country]
        .filter(Boolean)
        .join(', ')
    : null;
  const facts = [
    d?.language ? `${t('customerContact.language')}: ${t(`customerContact.lang.${d.language}` as MessageKey)}` : null,
    d?.uid_no ? `${t('customerContact.uid')}: ${d.uid_no}` : null,
    d?.vat_no ? `${t('customerContact.vat')}: ${d.vat_no}` : null,
    d?.bexio_no ? `bexio ${d.bexio_no}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-1.5 text-[12.5px]">
      {reach.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {reach.map(({ icon: Icon, text, link }) => (
            <li key={link}>
              <a href={link} target={link.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                <Icon className="h-3 w-3 shrink-0" aria-hidden />
                <span className="break-all">{text}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {billing && (
        <p className="text-muted">
          <span className="font-medium text-fg">{t('customerContact.billing')}:</span> {billing}
        </p>
      )}
      {facts.length > 0 && <p className="text-subtle">{facts.join(' · ')}</p>}
      {d?.bexio_remarks && (
        <p className="whitespace-pre-line text-muted">
          <span className="font-medium text-fg">{t('customerContact.remarks')}:</span> {d.bexio_remarks}
        </p>
      )}
    </div>
  );
}
