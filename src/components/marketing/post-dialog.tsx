'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { Combobox } from '@/components/ui/combobox';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { POST_CHANNELS, POST_STATUSES, type PostChannel, type PostStatus } from '@/lib/marketing';
import { savePost } from '@/server/marketing-actions';
import type { MarketingPostFull } from '@/types/marketing';
import { usePostLabels } from './marketing-parts';

export type PostChoices = {
  brands: { id: string; name: string }[];
  events: { id: string; name: string; start_date: string }[];
  products: { id: string; name: string }[];
};

/** A post: what, for which brand, where, when — and its results once out. */
export function PostDialog({
  post,
  choices,
  initialDate,
  onClose,
}: {
  post?: MarketingPostFull | null;
  choices: PostChoices;
  /** A new one on this day — from the calendar. */
  initialDate?: string;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = usePostLabels();
  const [title, setTitle] = useState(post?.title ?? '');
  const [brandId, setBrandId] = useState(post?.brand_id ?? '');
  const [status, setStatus] = useState<PostStatus>(post?.status ?? 'idea');
  const [plannedOn, setPlannedOn] = useState(post?.planned_on ?? initialDate ?? '');
  const [channels, setChannels] = useState<PostChannel[]>(post?.channels ?? []);
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [eventId, setEventId] = useState<string | null>(post?.event_id ?? null);
  const [productIds, setProductIds] = useState<string[]>(post?.products.map((p) => p.id) ?? []);
  const [results, setResults] = useState({
    reach: post?.reach?.toString() ?? '',
    likes: post?.likes?.toString() ?? '',
    comments: post?.comments?.toString() ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))) || 0);
  const productName = (id: string) => choices.products.find((p) => p.id === id)?.name ?? post?.products.find((p) => p.id === id)?.name ?? '—';

  function submit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await savePost(
        {
          title,
          brand_id: brandId || null,
          status,
          planned_on: plannedOn || null,
          channels,
          caption,
          event_id: eventId,
          product_ids: productIds,
          ...(status === 'published' ? { reach: num(results.reach), likes: num(results.likes), comments: num(results.comments) } : {}),
        },
        post?.id,
      );
      if (!res.ok) return setError(labels.error(res.error));
      onClose();
      if (post) router.refresh();
      else router.push(`/marketing/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={post ? t('mkt.editPost') : t('mkt.newPost')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('mkt.title')} required htmlFor="mkt-title">
          <Input id="mkt-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label={t('mkt.brand')} htmlFor="mkt-brand">
            <Select id="mkt-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">{t('mkt.group')}</option>
              {choices.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label={t('mkt.status')} htmlFor="mkt-status">
            <Select id="mkt-status" value={status} onChange={(e) => setStatus(e.target.value as PostStatus)}>
              {POST_STATUSES.map((s) => <option key={s} value={s}>{labels.status(s)}</option>)}
            </Select>
          </Field>
          <Field label={t('mkt.plannedOn')} htmlFor="mkt-date">
            <Input id="mkt-date" type="date" value={plannedOn} onChange={(e) => setPlannedOn(e.target.value)} />
          </Field>
        </div>
        <Field label={t('mkt.channels')}>
          <div className="flex flex-wrap gap-1.5">
            {POST_CHANNELS.map((c) => {
              const on = channels.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChannels(on ? channels.filter((x) => x !== c) : [...channels, c])}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12.5px]',
                    on ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {labels.channel(c)}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t('mkt.caption')} htmlFor="mkt-caption">
          <NoteTextarea id="mkt-caption" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={5000} />
        </Field>
        <Field label={t('mkt.event')} htmlFor="mkt-event">
          <Combobox
            id="mkt-event"
            items={choices.events}
            value={eventId}
            onChange={setEventId}
            getKey={(e) => e.id}
            getLabel={(e) => `${e.name} · ${formatDate(e.start_date, 'short')}`}
            getSearchText={(e) => e.name}
          />
        </Field>
        <Field label={t('mkt.products')} htmlFor="mkt-products">
          <Combobox
            id="mkt-products"
            items={choices.products.filter((p) => !productIds.includes(p.id))}
            value={null}
            onChange={(id) => id && setProductIds([...productIds, id])}
            getKey={(p) => p.id}
            getLabel={(p) => p.name}
            getSearchText={(p) => p.name}
            placeholder={t('mkt.addProduct')}
          />
          {productIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {productIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12.5px]">
                  {productName(id)}
                  <button type="button" aria-label={t('common.delete')} onClick={() => setProductIds(productIds.filter((x) => x !== id))}>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>
        {status === 'published' && (
          <Field label={t('mkt.results')} hint={t('mkt.resultsHint')}>
            <div className="grid grid-cols-3 gap-2">
              {(['reach', 'likes', 'comments'] as const).map((k) => (
                <Input
                  key={k}
                  inputMode="numeric"
                  placeholder={t(k === 'reach' ? 'mkt.reach' : k === 'likes' ? 'mkt.likes' : 'mkt.comments')}
                  aria-label={t(k === 'reach' ? 'mkt.reach' : k === 'likes' ? 'mkt.likes' : 'mkt.comments')}
                  value={results[k]}
                  onChange={(e) => setResults({ ...results, [k]: e.target.value.replace(/[^0-9]/g, '') })}
                />
              ))}
            </div>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
