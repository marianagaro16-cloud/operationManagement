'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Paperclip, Pencil, PartyPopper, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { createClient } from '@/lib/supabase/client';
import { shrinkImage } from '@/lib/shrink-image';
import { MARKETING_ALLOWED_MIME, MARKETING_BUCKET, MARKETING_MAX_BYTES, POST_STATUSES, type PostStatus } from '@/lib/marketing';
import { deletePost, recordPostFile, removePostFile, setPostStatus } from '@/server/marketing-actions';
import type { MarketingPostFile, MarketingPostFull } from '@/types/marketing';
import { BrandDot, PostStatusBadge, usePostLabels } from './marketing-parts';
import { PostDialog, type PostChoices } from './post-dialog';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';

/** One post: everything about it, its images and files, and moving it along. */
export function PostView({ post, canEdit, choices, viewerId }: { post: MarketingPostFull; canEdit: boolean; choices: PostChoices; viewerId: string }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = usePostLabels();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState<MarketingPostFile | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const images = post.files.filter((f) => f.mime_type.startsWith('image/') && f.url);
  const others = post.files.filter((f) => !images.includes(f));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setErrors([]);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setErrors([labels.error(res.error ?? '')]);
      after?.();
      router.refresh();
    });
  }

  function upload(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    setErrors([]);
    startTransition(async () => {
      const supabase = createClient();
      const failed: string[] = [];
      for (const original of chosen) {
        if (!MARKETING_ALLOWED_MIME.includes(original.type)) {
          failed.push(t('mkt.errFileType', { name: original.name }));
          continue;
        }
        const file = original.type.startsWith('image/') && original.type !== 'image/gif' ? await shrinkImage(original, 2400, 0.85) : original;
        if (file.size > MARKETING_MAX_BYTES) {
          failed.push(t('mkt.errFileSize', { name: original.name }));
          continue;
        }
        const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
        const path = `${post.id}/${crypto.randomUUID()}.${ext}`;
        const sent = await supabase.storage.from(MARKETING_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        const recorded = sent.error
          ? { ok: false }
          : await recordPostFile({ post_id: post.id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (!recorded.ok) failed.push(t('mkt.errFile', { name: original.name }));
      }
      if (input.current) input.current.value = '';
      setErrors(failed);
      router.refresh();
    });
  }

  const results: [string, number | null][] = [
    [t('mkt.reach'), post.reach],
    [t('mkt.likes'), post.likes],
    [t('mkt.comments'), post.comments],
  ];

  return (
    <>
      <Link href="/marketing" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('mkt.planTitle')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{post.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <BrandDot name={post.brand_name} />
              {labels.brand(post)}
              <PostStatusBadge status={post.status} />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <QuickReminderButton viewerId={viewerId} variant="ghost" compact link={{ type: 'marketing_post', id: post.id, label: post.title }} />
          {canEdit && (
            <div className="flex gap-0.5">
              <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setDeleting(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
          </div>
        </div>

        <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted">{t('mkt.plannedOn')}</dt>
          <dd>{post.planned_on ? formatDate(post.planned_on, 'weekday') : '—'}</dd>
          {post.published_on && (
            <>
              <dt className="text-muted">{t('mkt.publishedOn')}</dt>
              <dd>{formatDate(post.published_on, 'weekday')}</dd>
            </>
          )}
          <dt className="text-muted">{t('mkt.channels')}</dt>
          <dd>{post.channels.length ? post.channels.map(labels.channel).join(', ') : '—'}</dd>
          {post.event_id && (
            <>
              <dt className="text-muted">{t('mkt.event')}</dt>
              <dd>
                <Link href={`/events/${post.event_id}`} className="inline-flex items-center gap-1 hover:text-accent">
                  <PartyPopper className="h-3.5 w-3.5" aria-hidden />
                  {post.event_name}
                </Link>
              </dd>
            </>
          )}
          {post.products.length > 0 && (
            <>
              <dt className="text-muted">{t('mkt.products')}</dt>
              <dd className="flex flex-wrap gap-1">{post.products.map((p) => <Badge key={p.id} tone="neutral">{p.name}</Badge>)}</dd>
            </>
          )}
          {post.author_name && (
            <>
              <dt className="text-muted">{t('mkt.author')}</dt>
              <dd>{post.author_name}</dd>
            </>
          )}
        </dl>

        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[12.5px] text-muted">{t('mkt.moveTo')}</span>
            <Select
              value={post.status}
              disabled={pending}
              onChange={(e) => run(() => setPostStatus(post.id, e.target.value as PostStatus))}
              className="h-8 w-auto text-[13px]"
              aria-label={t('mkt.status')}
            >
              {POST_STATUSES.map((s) => <option key={s} value={s}>{labels.status(s)}</option>)}
            </Select>
          </div>
        )}
      </Card>

      {errors.length > 0 && <div className="mb-3 space-y-1">{errors.map((e) => <ErrorState key={e} message={e} />)}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-3">
            <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mkt.caption')}</h2>
            {post.caption ? <NoteText text={post.caption} className="text-[13.5px]" /> : <p className="text-[12.5px] text-muted">—</p>}
          </Card>
          {post.status === 'published' && (
            <Card className="p-3">
              <h2 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mkt.results')}</h2>
              <div className="grid grid-cols-3 gap-2">
                {results.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[11.5px] text-muted">{label}</p>
                    <p className="text-[18px] font-semibold tabular">{value ?? '—'}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mkt.files')}</h2>
            {canEdit && (
              <>
                <input
                  ref={input}
                  type="file"
                  multiple
                  accept={MARKETING_ALLOWED_MIME.join(',')}
                  className="sr-only"
                  aria-label={t('mkt.addFiles')}
                  onChange={(e) => upload(e.target.files)}
                />
                <Button size="sm" variant="ghost" loading={pending} onClick={() => input.current?.click()}>
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  {t('mkt.addFiles')}
                </Button>
              </>
            )}
          </div>
          {post.files.length === 0 ? (
            <p className="text-[12.5px] text-muted">{t('mkt.noFiles')}</p>
          ) : (
            <>
              {images.length > 0 && (
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {images.map((f) => (
                    <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2">
                      <a href={f.url!} target="_blank" rel="noreferrer" title={f.file_name}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                        <img src={f.url!} alt={f.file_name} loading="lazy" className="h-full w-full object-cover" />
                      </a>
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`${t('common.delete')} · ${f.file_name}`}
                          onClick={() => setRemoving(f)}
                          className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white opacity-80 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {others.length > 0 && (
                <ul className="divide-y divide-border">
                  {others.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                      <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent">{f.file_name}</a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                      )}
                      <span className="shrink-0 text-[11.5px] tabular text-muted">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
                      {canEdit && (
                        <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setRemoving(f)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>

      {editing && <PostDialog post={post} choices={choices} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => run(() => deletePost(post.id), () => router.push('/marketing'))}
        title={t('mkt.deletePost')}
        message={t('mkt.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const f = removing;
          setRemoving(null);
          if (f) run(() => removePostFile(f.id, post.id));
        }}
        title={t('mkt.removeFile')}
        message={removing?.file_name ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={pending}
      />
    </>
  );
}
