'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, Heading, ImagePlus, Pencil, Plus, Table, Trash2, Type, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Card, ErrorState, Field, Input } from '@/components/ui/primitives';
import { NoteText } from '@/components/ui/note';
import { NoteTextarea } from '@/components/ui/note-textarea';
import { createClient } from '@/lib/supabase/client';
import { removeGuideArticle, saveGuideArticle } from '@/server/guide-actions';
import type { GuideArticle, GuideBlock } from '@/types/guide';

const BUCKET = 'guide-files';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;

function BackToArticles() {
  const { t } = useI18n();
  return (
    <Link href="/guide?tab=articles" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {t('guide.tabArticles')}
    </Link>
  );
}

/** An article as it is read: headings, text, screenshots and tables in order. */
export function ArticleView({ article, canEdit }: { article: GuideArticle; canEdit: boolean }) {
  const { t, formatDate } = useI18n();
  return (
    <>
      <BackToArticles />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {article.topic && <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{article.topic}</p>}
          <h1 className="break-words text-xl font-semibold leading-tight">{article.title}</h1>
          <p className="mt-1 text-[12px] text-muted">{t('guide.updated', { date: formatDate(article.updated_at.slice(0, 10), 'medium') })}</p>
        </div>
        {canEdit && (
          <Link
            href={`/guide/articles/${article.id}/edit`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('common.edit')}
          </Link>
        )}
      </div>
      <Card className="space-y-3.5 p-3.5 sm:p-5">
        {article.blocks.length === 0 && <p className="text-[13px] text-muted">{t('guide.articleEmpty')}</p>}
        {article.blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </Card>
    </>
  );
}

function BlockView({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="pt-1 text-[15px] font-semibold">{block.text}</h2>;
    case 'text':
      return (
        <div className="text-[13.5px] leading-relaxed">
          <NoteText text={block.text} />
        </div>
      );
    case 'image':
      return (
        <figure>
          {block.url && (
            <a href={block.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
              <img src={block.url} alt={block.caption ?? ''} className="max-h-[70vh] max-w-full rounded-md border border-border" />
            </a>
          )}
          {block.caption && <figcaption className="mt-1 text-[12px] text-muted">{block.caption}</figcaption>}
        </figure>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                {block.rows[0]?.map((cell, c) => (
                  <th key={c} className="px-2 py-1.5 font-medium">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, r) => (
                <tr key={r} className="border-b border-border align-top last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className="whitespace-pre-wrap px-2 py-1.5">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/* --------------------------------- editing -------------------------------- */

/** A block being edited: the image also carries what to show before it is saved. */
type Draft = GuideBlock & { key: string };

/**
 * Writes an article block by block — a heading, a paragraph, a screenshot, a
 * table — the way a how-to is built: say the step, show the screen.
 */
export function ArticleEditor({
  id,
  article,
  topics,
}: {
  /** The article's id; for a new one, made by the page so its images have a folder. */
  id: string;
  article: GuideArticle | null;
  /** Topics already in use, to pick from. */
  topics: string[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? '');
  const [topic, setTopic] = useState(article?.topic ?? '');
  const [blocks, setBlocks] = useState<Draft[]>(() =>
    (article?.blocks ?? [{ type: 'text', text: '' } as GuideBlock]).map((b) => ({ ...b, key: crypto.randomUUID() })),
  );
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const supabase = useMemo(() => createClient(), []);

  const change = (key: string, patch: Partial<GuideBlock>) =>
    setBlocks((list) => list.map((b) => (b.key === key ? ({ ...b, ...patch } as Draft) : b)));
  const move = (index: number, by: -1 | 1) =>
    setBlocks((list) => {
      const next = [...list];
      const [block] = next.splice(index, 1);
      next.splice(index + by, 0, block!);
      return next;
    });
  const add = (block: GuideBlock) => setBlocks((list) => [...list, { ...block, key: crypto.randomUUID() }]);

  /** Straight from the browser to storage, into the article's folder. */
  async function addImages(files: FileList | null) {
    setError(null);
    setUploading(true);
    for (const file of [...(files ?? [])]) {
      if (!IMAGE_TYPES.includes(file.type) || file.size > MAX_BYTES) {
        setError(t('guide.errImage', { name: file.name }));
        continue;
      }
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) setError(t('guide.errImage', { name: file.name }));
      else add({ type: 'image', path, url: URL.createObjectURL(file) });
    }
    setUploading(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveGuideArticle(id, {
        title,
        topic,
        // Without the editor's own fields: the key, and the preview address.
        blocks: blocks.map((b) =>
          b.type === 'image' ? { type: 'image', path: b.path, caption: b.caption } : b.type === 'table' ? { type: 'table', rows: b.rows } : { type: b.type, text: b.text },
        ),
      });
      if (!res.ok) return setError(t(res.error === 'not_authorized' ? 'guide.errNotAuthorized' : res.error === 'title_required' ? 'guide.errTitle' : 'guide.errUnknown'));
      router.push(`/guide/articles/${id}`);
      router.refresh();
    });
  }

  return (
    <>
      <BackToArticles />
      <h1 className="mb-4 text-xl font-semibold leading-tight">{t(article ? 'guide.editArticle' : 'guide.newArticle')}</h1>
      <div className="space-y-3.5">
        {error && <ErrorState message={error} />}
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <Field label={t('guide.articleTitle')} required htmlFor="article-title">
            <Input id="article-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('guide.articleTopic')} htmlFor="article-topic">
            <Input id="article-topic" list="article-topics" value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} />
            <datalist id="article-topics">
              {topics.map((x) => <option key={x} value={x} />)}
            </datalist>
          </Field>
        </div>

        {blocks.map((block, i) => (
          <Card key={block.key} className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {t(block.type === 'heading' ? 'guide.blockHeading' : block.type === 'text' ? 'guide.blockText' : block.type === 'image' ? 'guide.blockImage' : 'guide.blockTable')}
              </span>
              <span className="flex gap-0.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('guide.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('guide.moveDown')} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-late" aria-label={t('common.delete')} onClick={() => setBlocks((list) => list.filter((b) => b.key !== block.key))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </span>
            </div>
            {block.type === 'heading' && (
              <Input aria-label={t('guide.blockHeading')} value={block.text} maxLength={300} onChange={(e) => change(block.key, { text: e.target.value })} />
            )}
            {block.type === 'text' && (
              <NoteTextarea aria-label={t('guide.blockText')} rows={4} value={block.text} onChange={(e) => change(block.key, { text: e.target.value })} />
            )}
            {block.type === 'image' && (
              <div className="space-y-2">
                {block.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed, short-lived URL
                  <img src={block.url} alt="" className="max-h-64 max-w-full rounded-md border border-border" />
                ) : (
                  <p className="text-[12.5px] text-muted">{block.path}</p>
                )}
                <Input aria-label={t('guide.caption')} placeholder={t('guide.caption')} value={block.caption ?? ''} maxLength={500} onChange={(e) => change(block.key, { caption: e.target.value })} />
              </div>
            )}
            {block.type === 'table' && <TableEditor rows={block.rows} onChange={(rows) => change(block.key, { rows })} />}
          </Card>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => add({ type: 'text', text: '' })}>
            <Type className="h-3.5 w-3.5" aria-hidden />
            {t('guide.addText')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => add({ type: 'heading', text: '' })}>
            <Heading className="h-3.5 w-3.5" aria-hidden />
            {t('guide.addHeading')}
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
            <ImagePlus className="h-3.5 w-3.5" aria-hidden />
            {t(uploading ? 'common.loading' : 'guide.addImage')}
            <input type="file" multiple accept={IMAGE_TYPES.join(',')} className="sr-only" disabled={uploading} onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} />
          </label>
          <Button size="sm" variant="secondary" onClick={() => add({ type: 'table', rows: [['', ''], ['', '']] })}>
            <Table className="h-3.5 w-3.5" aria-hidden />
            {t('guide.addTable')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
          {article ? (
            <Button variant="ghost" className="text-late" onClick={() => setRemoving(true)} disabled={pending}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('guide.removeArticle')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={() => router.back()} disabled={pending}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim() || uploading}>{t('common.save')}</Button>
          </span>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          open
          title={t('guide.removeArticle')}
          message={title}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          destructive
          onClose={() => setRemoving(false)}
          onConfirm={() =>
            startTransition(async () => {
              const res = await removeGuideArticle(id);
              setRemoving(false);
              if (!res.ok) return setError(t('guide.errUnknown'));
              router.push('/guide?tab=articles');
              router.refresh();
            })
          }
        />
      )}
    </>
  );
}

/** A small grid: the first row is the header. */
function TableEditor({ rows, onChange }: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const { t } = useI18n();
  const width = Math.max(1, ...rows.map((r) => r.length));
  const setCell = (r: number, c: number, value: string) =>
    onChange(rows.map((row, ri) => (ri === r ? Array.from({ length: width }, (_, ci) => (ci === c ? value : row[ci] ?? '')) : row)));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="min-w-[8rem]">
                    <Input
                      aria-label={`${r + 1} · ${c + 1}`}
                      value={row[c] ?? ''}
                      maxLength={1000}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      className={r === 0 ? 'font-medium' : undefined}
                    />
                  </td>
                ))}
                <td>
                  <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('guide.removeRow')} disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, ri) => ri !== r))}>
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => onChange([...rows, Array(width).fill('')])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('guide.addRow')}
        </Button>
        <Button size="sm" variant="ghost" disabled={width >= 12} onClick={() => onChange(rows.map((row) => [...Array.from({ length: width }, (_, c) => row[c] ?? ''), '']))}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('guide.addColumn')}
        </Button>
        <Button size="sm" variant="ghost" disabled={width <= 1} onClick={() => onChange(rows.map((row) => row.slice(0, width - 1)))}>
          <X className="h-3.5 w-3.5" aria-hidden />
          {t('guide.removeColumn')}
        </Button>
      </div>
    </div>
  );
}
