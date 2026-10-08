'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarPlus, FileText, Paperclip, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Card, EmptyState, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { PageHeader } from '@/components/shell/app-shell';
import { createClient } from '@/lib/supabase/client';
import { shrinkImage } from '@/lib/shrink-image';
import { MARKETING_ALLOWED_MIME, MARKETING_MAX_BYTES, REQUESTS_BUCKET, type RequestStatus } from '@/lib/marketing';
import {
  addRequestComment,
  planRequestAsPost,
  recordRequestFile,
  removeRequestFile,
  saveRequest,
  setRequestStatus,
} from '@/server/marketing-request-actions';
import type { MarketingRequest, MarketingRequestFull } from '@/types/marketing';
import { BrandDot } from './marketing-parts';
import { QuickReminderButton } from '@/components/reminders/reminder-actions';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import { RemindAfterCreate } from '@/components/reminders/remind-after-create';

const STATUS_TONE: Record<RequestStatus, 'neutral' | 'accent' | 'done' | 'skipped'> = { new: 'neutral', in_progress: 'accent', done: 'done', cancelled: 'skipped' };
const STATUS_LABEL: Record<RequestStatus, MessageKey> = {
  new: 'mktReq.statusNew',
  in_progress: 'mktReq.statusInProgress',
  done: 'mktReq.statusDone',
  cancelled: 'mktReq.statusCancelled',
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Badge>;
}

type Brands = { id: string; name: string }[];

/** Requests to Marketing: one's own — or, for Marketing, everyone's. */
export function RequestList({
  tab,
  requests,
  brands,
  allRequests,
  today,
  viewerId,
}: {
  /** For a reminder right after sending a request. */
  viewerId?: string;
  tab: 'open' | 'closed';
  requests: MarketingRequest[];
  brands: Brands;
  /** Marketing sees every request (with who asked); anyone else their own. */
  allRequests: boolean;
  today: string;
}) {
  const { t, formatDate } = useI18n();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t('mktReq.title')}
        subtitle={allRequests ? t('mktReq.subtitleMarketing') : t('mktReq.subtitle')}
        action={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('mktReq.new')}
          </Button>
        }
      />
      <div className="-mt-2 mb-3 flex gap-1 border-b border-border">
        {(['open', 'closed'] as const).map((key) => (
          <Link
            key={key}
            href={key === 'open' ? '/marketing/requests' : '/marketing/requests?tab=closed'}
            scroll={false}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {key === 'open' ? t('mktReq.tabOpen') : t('mktReq.tabClosed')}
          </Link>
        ))}
      </div>
      {requests.length === 0 ? (
        <EmptyState title={tab === 'open' ? t('mktReq.noneOpen') : t('mktReq.noneClosed')} />
      ) : (
        <Card className="divide-y divide-border">
          {requests.map((r) => {
            const late = tab === 'open' && !!r.due_on && r.due_on < today;
            return (
              <Link key={r.id} href={`/marketing/requests/${r.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
                    {r.brand_name && <BrandDot name={r.brand_name} />}
                    {r.title}
                  </p>
                  <p className="text-[12px] text-muted">
                    {[allRequests ? r.requester_name : null, r.brand_name].filter(Boolean).join(' · ')}
                    {r.due_on && (
                      <span className={cn(late && 'font-semibold text-late')}>
                        {(allRequests && r.requester_name) || r.brand_name ? ' · ' : ''}
                        {t('mktReq.dueOn', { date: formatDate(r.due_on, 'short') })}
                      </span>
                    )}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            );
          })}
        </Card>
      )}
      {creating && <RequestDialog brands={brands} viewerId={viewerId} onClose={() => setCreating(false)} />}
    </>
  );
}

function RequestDialog({ request, brands, onClose, viewerId }: { request?: MarketingRequestFull; brands: Brands; onClose: () => void; viewerId?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(request?.title ?? '');
  const [description, setDescription] = useState(request?.description ?? '');
  const [brandId, setBrandId] = useState(request?.brand_id ?? '');
  const [due, setDue] = useState(request?.due_on ?? '');
  // A reminder about the new request, offered once it is sent.
  const [remind, setRemind] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveRequest({ title, description, brand_id: brandId || null, due_on: due || null }, request?.id);
      if (!res.ok) return setError(res.error === 'not_authorized' ? t('mktReq.errNotAuthorized') : t('common.error'));
      if (!request && remind && viewerId) return setCreated(res.data.id);
      onClose();
      if (request) router.refresh();
      else router.push(`/marketing/requests/${res.data.id}`);
    });
  }

  // The request is sent; the reminder about it comes next, then its page.
  if (created && viewerId) {
    const done = () => { onClose(); router.push(`/marketing/requests/${created}`); };
    return (
      <ReminderDialog
        open
        viewerId={viewerId}
        link={{ type: 'marketing_request', id: created, label: title }}
        initialTitle={title}
        quickDates={due ? [{ label: t('mktReq.remindDue'), date: due }] : undefined}
        onClose={done}
        onSaved={done}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={request ? t('mktReq.edit') : t('mktReq.new')}
      description={request ? undefined : t('mktReq.newHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>
            {request ? t('common.save') : t('mktReq.send')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label={t('mktReq.what')} required htmlFor="req-title">
          <Input id="req-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t('mktReq.whatPlaceholder')} autoFocus />
        </Field>
        <Field label={t('mktReq.details')} htmlFor="req-desc">
          <NoteTextarea id="req-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('mkt.brand')} htmlFor="req-brand">
            <Select id="req-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">{t('mkt.group')}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label={t('mktReq.due')} htmlFor="req-due">
            <Input id="req-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        {!request && viewerId && <RemindAfterCreate checked={remind} onChange={setRemind} label={t('mktReq.withReminder')} />}
        {!request && <p className="text-[12px] text-muted">{t('mktReq.filesAfter')}</p>}
      </div>
    </Dialog>
  );
}

/** One request: what is asked, the files, the conversation, and moving it along. */
export function RequestView({
  request,
  brands,
  viewerId,
  isMarketing,
}: {
  request: MarketingRequestFull;
  brands: Brands;
  viewerId: string;
  /** Marketing, Admin or Owner: moves it along and plans it. */
  isMarketing: boolean;
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const mine = request.requester_ids.includes(viewerId);
  const open = request.status === 'new' || request.status === 'in_progress';
  const images = request.files.filter((f) => f.mime_type.startsWith('image/') && f.url);
  const others = request.files.filter((f) => !images.includes(f));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setErrors([]);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setErrors([res.error === 'not_authorized' ? t('mktReq.errNotAuthorized') : t('common.error')]);
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
        const path = `${request.id}/${crypto.randomUUID()}.${ext}`;
        const sent = await supabase.storage.from(REQUESTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        const recorded = sent.error
          ? { ok: false }
          : await recordRequestFile({ request_id: request.id, storage_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
        if (!recorded.ok) failed.push(t('mkt.errFile', { name: original.name }));
      }
      if (input.current) input.current.value = '';
      setErrors(failed);
      router.refresh();
    });
  }

  return (
    <>
      <Link href="/marketing/requests" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('mktReq.title')}
      </Link>

      <Card className="mb-4 p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold leading-tight">{request.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              <StatusBadge status={request.status} />
              {request.brand_name && (
                <span className="inline-flex items-center gap-1">
                  <BrandDot name={request.brand_name} />
                  {request.brand_name}
                </span>
              )}
              <span>· {t('mktReq.askedBy', { name: request.requester_name ?? '—', date: formatDate(request.created_at.slice(0, 10), 'short') })}</span>
              {request.due_on && <span>· {t('mktReq.dueOn', { date: formatDate(request.due_on, 'weekday') })}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <QuickReminderButton viewerId={viewerId} variant="ghost" compact link={{ type: 'marketing_request', id: request.id, label: request.title }} />
            {mine && request.status === 'new' && (
              <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        </div>
        {request.description && <NoteText text={request.description} className="mt-3 text-[13.5px]" />}

        <div className="mt-3 flex flex-wrap gap-2">
          {isMarketing && request.status === 'new' && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setRequestStatus(request.id, 'in_progress'))}>
              {t('mktReq.start')}
            </Button>
          )}
          {isMarketing && open && (
            <Button size="sm" variant="success" disabled={pending} onClick={() => run(() => setRequestStatus(request.id, 'done'))}>
              {t('mktReq.markDone')}
            </Button>
          )}
          {isMarketing && !request.post_id && open && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await planRequestAsPost(request.id);
                  if (!res.ok) return setErrors([t('common.error')]);
                  router.push(`/marketing/${res.data.postId}`);
                })
              }
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              {t('mktReq.planAsPost')}
            </Button>
          )}
          {request.post_id && (
            <Link href={`/marketing/${request.post_id}`} className="inline-flex items-center gap-1 self-center text-[13px] font-medium text-accent hover:underline">
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
              {t('mktReq.seePost')}
            </Link>
          )}
          {(isMarketing ? !open : false) && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRequestStatus(request.id, 'in_progress'))}>
              {t('mktReq.reopen')}
            </Button>
          )}
          {(mine && request.status === 'new') || (isMarketing && open) ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm(t('mktReq.cancelConfirm')) && run(() => setRequestStatus(request.id, 'cancelled'))}>
              {t('mktReq.cancel')}
            </Button>
          ) : null}
        </div>
      </Card>

      {errors.length > 0 && <div className="mb-3 space-y-1">{errors.map((e) => <ErrorState key={e} message={e} />)}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-3">
          <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mktReq.conversation')}</h2>
          {request.comments.length === 0 ? (
            <p className="mb-2 text-[12.5px] text-muted">{t('mktReq.noComments')}</p>
          ) : (
            <ul className="mb-3 space-y-2">
              {request.comments.map((c) => (
                <li key={c.id} className={cn('rounded-lg px-3 py-2 text-[13px]', c.author_id === viewerId ? 'ml-6 bg-accent/10' : 'mr-6 bg-surface-2')}>
                  <p className="mb-0.5 text-[11.5px] text-muted">
                    {c.author_name ?? '—'} · {formatDate(c.created_at.slice(0, 10), 'short')} {c.created_at.slice(11, 16)}
                  </p>
                  <NoteText text={c.body} />
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (comment.trim()) run(() => addRequestComment(request.id, comment), () => setComment(''));
            }}
          >
            <NoteTextarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('mktReq.commentPlaceholder')} aria-label={t('mktReq.commentPlaceholder')} />
            <Button type="submit" size="icon" variant="primary" aria-label={t('mktReq.sendComment')} disabled={!comment.trim() || pending}>
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </Card>

        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mkt.files')}</h2>
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
          </div>
          {request.files.length === 0 ? (
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
                      {(f.uploaded_by === viewerId || isMarketing) && (
                        <button
                          type="button"
                          aria-label={`${t('common.delete')} · ${f.file_name}`}
                          onClick={() => window.confirm(t('mkt.removeFile')) && run(() => removeRequestFile(f.id, request.id))}
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
                      {(f.uploaded_by === viewerId || isMarketing) && (
                        <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => window.confirm(t('mkt.removeFile')) && run(() => removeRequestFile(f.id, request.id))}>
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

      {editing && <RequestDialog request={request} brands={brands} onClose={() => setEditing(false)} />}
    </>
  );
}
