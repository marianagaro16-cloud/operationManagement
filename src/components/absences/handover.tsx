'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Link2, MessageSquare, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Badge, Card, ErrorState, Field, Input, Select } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import {
  progressHandoverItem,
  removeHandoverItem,
  saveHandoverItem,
  searchLinkables,
  sendHandover,
} from '@/server/handover-actions';
import { HANDOVER_LINK_TYPES, type HandoverItem, type HandoverLinkType, type HandoverSuggestion } from '@/types/absences';

const STATUS_TONE = { open: 'neutral', in_progress: 'warn', done: 'done' } as const;

/** Where a linked record opens, when it has a page of its own. */
function hrefOf(type: HandoverLinkType, id: string): string | null {
  switch (type) {
    case 'order': return `/orders/${id}`;
    case 'incident': return `/incidents/${id}`;
    case 'goods_reception': return `/goods-reception/${id}`;
    case 'inventory': return `/inventory/${id}`;
    case 'reminder': return `/reminders/${id}`;
    default: return null;
  }
}

function useHandoverLabels() {
  const { t } = useI18n();
  return {
    status: (s: HandoverItem['status']) =>
      ({ open: t('handover.statusOpen'), in_progress: t('handover.statusInProgress'), done: t('handover.statusDone') })[s],
    type: (x: HandoverLinkType) => t(`handover.link_${x}` as MessageKey),
  };
}

/**
 * The handover: what the people covering should know. Written by the absent
 * person (and approvers), sent to the people covering with one button; they
 * move items on and write a note back.
 */
export function Handover({
  absenceId,
  items,
  lastSent,
  canWrite,
  suggestions,
}: {
  absenceId: string;
  items: HandoverItem[];
  lastSent: string | null;
  canWrite: boolean;
  /** For the absent person: their own work during the absence, to add in one tap. */
  suggestions: HandoverSuggestion[];
}) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const labels = useHandoverLabels();
  const [editing, setEditing] = useState<{ row: HandoverItem | null; preset?: HandoverSuggestion } | null>(null);
  const [progress, setProgress] = useState<HandoverItem | null>(null);
  const [removing, setRemoving] = useState<HandoverItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const linked = new Set(items.map((i) => `${i.link_type}:${i.link_id}`));
  const offered = suggestions.filter((s) => !linked.has(`${s.type}:${s.id}`));

  return (
    <section id="handover" className="mt-6 scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">{t('handover.title')}</h2>
          <p className="text-[12px] text-muted">
            {lastSent ? t('handover.lastSent', { date: formatDate(lastSent.slice(0, 10), 'short') }) : canWrite ? t('handover.notSent') : ''}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setEditing({ row: null })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('handover.add')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || items.length === 0}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await sendHandover(absenceId);
                  if (!res.ok) return setError(res.error);
                  setSent(res.data.recipients);
                  router.refresh();
                });
              }}
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {t('handover.send')}
            </Button>
          </div>
        )}
      </div>
      {error && <div className="mb-2"><ErrorState message={error} /></div>}
      {sent !== null && (
        <p className="mb-2 text-[12.5px] font-medium text-done">
          {sent > 0 ? t('handover.sentTo', { count: sent }) : t('handover.sentNobody')}
        </p>
      )}

      {items.length === 0 ? (
        <Card className="p-3 text-[12.5px] text-muted">{canWrite ? t('handover.emptyWriter') : t('handover.empty')}</Card>
      ) : (
        <Card className="divide-y divide-border">
          {items.map((i) => {
            const href = i.link_type && i.link_id ? hrefOf(i.link_type, i.link_id) : null;
            return (
              <div key={i.id} className="px-3.5 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13.5px] font-medium', i.status === 'done' && 'text-muted line-through')}>{i.title}</p>
                    {i.body && <NoteText text={i.body} className="text-[13px]" />}
                    {i.link_type && i.link_label && (
                      <p className="mt-0.5 flex items-center gap-1 text-[12.5px]">
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                        <span className="text-muted">{labels.type(i.link_type)}:</span>
                        {href ? <Link href={href} className="text-accent hover:underline">{i.link_label}</Link> : <span>{i.link_label}</span>}
                      </p>
                    )}
                    {i.coverer_note && (
                      <p className="mt-1 rounded-md bg-surface-2 px-2 py-1 text-[12.5px]">
                        <MessageSquare className="mr-1 inline h-3.5 w-3.5 text-muted" aria-hidden />
                        {i.coverer_note}
                        {i.updater_name && <span className="text-muted"> — {i.updater_name}</span>}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => setProgress(i)} className="shrink-0" title={t('handover.progress')}>
                    <Badge tone={STATUS_TONE[i.status]}>{labels.status(i.status)}</Badge>
                  </button>
                  {canWrite && (
                    <>
                      <Button size="icon" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing({ row: i })}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={t('common.delete')} onClick={() => setRemoving(i)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {canWrite && offered.length > 0 && (
        <Card className="mt-3 p-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('handover.suggestions')}</p>
          <p className="mb-1.5 text-[12px] text-muted">{t('handover.suggestionsHint')}</p>
          <ul className="space-y-1">
            {offered.map((s) => (
              <li key={`${s.type}:${s.id}`} className="flex items-center gap-2 text-[13px]">
                <Badge tone="neutral">{labels.type(s.type)}</Badge>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ row: null, preset: s })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('handover.addThis')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && <ItemDialog absenceId={absenceId} row={editing.row} preset={editing.preset} onClose={() => setEditing(null)} />}
      {progress && <ProgressDialog item={progress} onClose={() => setProgress(null)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const i = removing;
          if (!i) return;
          startTransition(async () => {
            const res = await removeHandoverItem(i.id, absenceId);
            setRemoving(null);
            if (!res.ok) return setError(res.error);
            router.refresh();
          });
        }}
        title={t('handover.remove')}
        message={removing?.title ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={pending}
      />
    </section>
  );
}

function ItemDialog({
  absenceId,
  row,
  preset,
  onClose,
}: {
  absenceId: string;
  row: HandoverItem | null;
  preset?: HandoverSuggestion;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useHandoverLabels();
  const [title, setTitle] = useState(row?.title ?? preset?.label.split(' · ')[0] ?? '');
  const [body, setBody] = useState(row?.body ?? '');
  const [link, setLink] = useState<{ type: HandoverLinkType; id: string; label: string } | null>(
    row?.link_type && row.link_id ? { type: row.link_type, id: row.link_id, label: row.link_label ?? '' } : preset ? { ...preset } : null,
  );
  const [linkType, setLinkType] = useState<HandoverLinkType>(row?.link_type ?? preset?.type ?? 'customer');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Search as they type, a moment after they stop.
  useEffect(() => {
    if (link || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await searchLinkables(linkType, query);
      if (res.ok) setResults(res.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, linkType, link]);

  function submit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await saveHandoverItem(absenceId, { title, body, link: link ? { type: link.type, id: link.id } : null }, row?.id);
      if (!res.ok) return setError(res.error === 'link_not_found' ? t('handover.errLink') : res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? t('handover.edit') : t('handover.add')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('handover.itemTitle')} required htmlFor="handover-title">
          <Input id="handover-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={t('handover.itemBody')} htmlFor="handover-body">
          <NoteTextarea id="handover-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label={t('handover.linkTo')} hint={t('handover.linkHint')}>
          {link ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[13px]">
              <Badge tone="neutral">{labels.type(link.type)}</Badge>
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              <Button size="icon" variant="ghost" aria-label={t('handover.unlink')} onClick={() => setLink(null)}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <Select aria-label={t('handover.linkType')} value={linkType} onChange={(e) => { setLinkType(e.target.value as HandoverLinkType); setResults([]); }} className="w-auto">
                  {HANDOVER_LINK_TYPES.map((x) => <option key={x} value={x}>{labels.type(x)}</option>)}
                </Select>
                <Input aria-label={t('handover.search')} placeholder={t('handover.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {results.length > 0 && (
                <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setLink({ type: linkType, id: r.id, label: r.label }); setQuery(''); }} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-2">
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(linkType === 'reminder' || linkType === 'personal_task') && <p className="text-[11.5px] text-muted">{t('handover.privateHint')}</p>}
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function ProgressDialog({ item, onClose }: { item: HandoverItem; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const labels = useHandoverLabels();
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.coverer_note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await progressHandoverItem(item.id, item.absence_id, status, note);
                if (!res.ok) return setError(res.error === 'not_authorized' ? t('absence.errNotAuthorized') : res.error);
                onClose();
                router.refresh();
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <Field label={t('handover.progress')} htmlFor="handover-status">
          <Select id="handover-status" value={status} onChange={(e) => setStatus(e.target.value as HandoverItem['status'])} className="w-auto" autoFocus>
            {(['open', 'in_progress', 'done'] as const).map((s) => <option key={s} value={s}>{labels.status(s)}</option>)}
          </Select>
        </Field>
        <Field label={t('handover.noteBack')} htmlFor="handover-note">
          <NoteTextarea id="handover-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
