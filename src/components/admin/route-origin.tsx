'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardBody, ErrorState, Field, Input } from '@/components/ui/primitives';
import { saveRouteOrigin } from '@/server/route-actions';
import type { RouteOrigin } from '@/server/route';

/**
 * Where the delivery round starts and ends.
 *
 * Saving geocodes the address, and the screen says whether it was found:
 * without coordinates the round can still be driven and ordered by hand, but
 * "order automatically" has nowhere to start from, and silently proposing a
 * worse round would be the wrong kind of quiet.
 */
export function RouteOriginCard({ origin }: { origin: RouteOrigin | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [label, setLabel] = useState(origin?.label ?? '');
  const [street, setStreet] = useState(origin?.street ?? '');
  const [postalCode, setPostalCode] = useState(origin?.postal_code ?? '');
  const [city, setCity] = useState(origin?.city ?? '');
  const [country, setCountry] = useState(origin?.country ?? 'CH');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await saveRouteOrigin({
        label: label.trim() || null,
        street: street.trim() || null,
        postal_code: postalCode.trim() || null,
        city: city.trim() || null,
        country: (country.trim() || 'CH').toUpperCase(),
      });
      if (!res.ok) return setError(res.error);
      setResult(res.data.located ? t('route.originSaved') : t('route.originNotFound'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">{t('route.originTitle')}</p>
            <p className="mt-0.5 text-[12.5px] text-muted">{t('route.originHint')}</p>

            <div className="mt-3 space-y-3">
              <Field label={t('route.originLabel')} htmlFor="origin-label">
                <Input id="origin-label" value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label={t('master.street')} htmlFor="origin-street">
                <Input id="origin-street" value={street} onChange={(e) => setStreet(e.target.value)} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label={t('master.postalCode')} htmlFor="origin-zip">
                  <Input id="origin-zip" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} inputMode="numeric" />
                </Field>
                <div className="col-span-2">
                  <Field label={t('master.city')} htmlFor="origin-city">
                    <Input id="origin-city" value={city} onChange={(e) => setCity(e.target.value)} />
                  </Field>
                </div>
              </div>
              <Field label={t('master.country')} htmlFor="origin-country">
                <Input
                  id="origin-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                  className="max-w-24"
                />
              </Field>
            </div>

            <Button className="mt-3" variant="secondary" onClick={submit} loading={pending}>
              {t('common.save')}
            </Button>

            {result && <p className="mt-2 text-[12.5px] text-muted">{result}</p>}
            {error && <div className="mt-2"><ErrorState message={error} /></div>}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
