'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorState, Input } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/app-shell';
import { createCategory, createTopic, moveTopic, renameCategory, setTopicArchived, updateTopic } from '@/server/topic-actions';
import { TOPIC_COLORS, type PersonalTopic, type TopicColor } from '@/types/reminders';
import { TOPIC_DOT, TopicDot } from './topic-bits';

/**
 * One's own topics and their categories: add, rename, recolour, reorder,
 * archive and restore. Archived ones leave the pickers; tasks keep them.
 */
export function TopicManager({ topics }: { topics: PersonalTopic[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newTopic, setNewTopic] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const active = topics.filter((tp) => !tp.archived_at);
  const archived = topics.filter((tp) => tp.archived_at);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error === 'topic_exists' ? t('ptopic.exists') : t('common.error'));
      after?.();
      router.refresh();
    });
  }

  return (
    <>
      <Link href="/reminders/tasks" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t('ptask.title')}
      </Link>
      <PageHeader title={t('ptopic.manageTitle')} subtitle={t('ptopic.manageSubtitle')} />

      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newTopic.trim()) run(() => createTopic({ name: newTopic }), () => setNewTopic(''));
        }}
      >
        <Input value={newTopic} maxLength={60} onChange={(e) => setNewTopic(e.target.value)} placeholder={t('ptopic.topicName')} aria-label={t('ptopic.topicName')} />
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!newTopic.trim()}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('ptopic.newTopicShort')}
        </Button>
      </form>

      {active.length === 0 ? (
        <EmptyState title={t('ptopic.noneYet')} body={t('ptopic.noneYetBody')} />
      ) : (
        <div className="space-y-3">
          {active.map((topic, i) => (
            <TopicCard key={topic.id} topic={topic} first={i === 0} last={i === active.length - 1} pending={pending} run={run} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section className="mt-6">
          <button onClick={() => setShowArchived((v) => !v)} className="text-[13px] font-semibold text-muted hover:text-fg">
            {t('ptopic.archived', { count: archived.length })}
          </button>
          {showArchived && (
            <Card className="mt-2 divide-y divide-border">
              {archived.map((topic) => (
                <div key={topic.id} className="flex items-center gap-2 px-3.5 py-2 text-[13.5px]">
                  <TopicDot color={topic.color} />
                  <span className="min-w-0 flex-1 truncate text-muted">{topic.name}</span>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTopicArchived('topic', topic.id, false))}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    {t('ptopic.restore')}
                  </Button>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}
    </>
  );
}

type Run = (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => void;

function TopicCard({ topic, first, last, pending, run }: { topic: PersonalTopic; first: boolean; last: boolean; pending: boolean; run: Run }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.name);
  const [newCategory, setNewCategory] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const categories = topic.categories.filter((c) => !c.archived_at);
  const archivedCategories = topic.categories.filter((c) => c.archived_at);

  const setColor = (color: TopicColor | null) => run(() => updateTopic(topic.id, { name: topic.name, color }));

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <TopicDot color={topic.color} className="h-2.5 w-2.5" />
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => updateTopic(topic.id, { name, color: topic.color }), () => setEditing(false));
            }}
          >
            <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={t('ptopic.topicName')} />
            <Button type="submit" size="icon" variant="ghost" aria-label={t('common.save')} disabled={!name.trim() || pending}>
              <Check className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={t('common.cancel')} onClick={() => { setName(topic.name); setEditing(false); }}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </form>
        ) : (
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{topic.name}</p>
        )}
        {!editing && (
          <>
            <Button size="icon" variant="ghost" aria-label={t('ptopic.up')} disabled={first || pending} onClick={() => run(() => moveTopic('topic', topic.id, -1))}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('ptopic.down')} disabled={last || pending} onClick={() => run(() => moveTopic('topic', topic.id, 1))}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('ptopic.rename')} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('ptopic.archive')} title={t('ptopic.archive')} disabled={pending} onClick={() => run(() => setTopicArchived('topic', topic.id, true))}>
              <Archive className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        )}
      </div>

      {/* Colour: a dot to tell topics apart at a glance. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[18px]">
        <button
          type="button"
          onClick={() => setColor(null)}
          aria-label={t('ptopic.noColor')}
          className={cn('h-5 w-5 rounded-full border border-border bg-surface', !topic.color && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
        />
        {TOPIC_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={c}
            className={cn('h-5 w-5 rounded-full', TOPIC_DOT[c], topic.color === c && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1 pl-[18px]">
        {categories.map((c, i) => (
          <CategoryRow key={c.id} id={c.id} name={c.name} first={i === 0} last={i === categories.length - 1} pending={pending} run={run} />
        ))}
      </ul>
      <form
        className="mt-2 flex items-center gap-2 pl-[18px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (newCategory.trim()) run(() => createCategory(topic.id, { name: newCategory }), () => setNewCategory(''));
        }}
      >
        <Input value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder={t('ptopic.categoryName')} aria-label={t('ptopic.categoryName')} className="h-8 text-[13px]" />
        <Button type="submit" size="sm" variant="ghost" disabled={!newCategory.trim() || pending}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t('ptopic.newCategoryShort')}
        </Button>
      </form>

      {archivedCategories.length > 0 && (
        <div className="mt-2 pl-[18px]">
          <button onClick={() => setShowArchived((v) => !v)} className="text-[12px] text-muted hover:text-fg">
            {t('ptopic.archived', { count: archivedCategories.length })}
          </button>
          {showArchived && (
            <ul className="mt-1 space-y-1">
              {archivedCategories.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[13px] text-muted">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTopicArchived('category', c.id, false))}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    {t('ptopic.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function CategoryRow({ id, name, first, last, pending, run }: { id: string; name: string; first: boolean; last: boolean; pending: boolean; run: Run }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <li className="flex items-center gap-1.5 text-[13.5px]">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameCategory(id, value), () => setEditing(false));
          }}
        >
          <Input autoFocus value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} aria-label={t('ptopic.categoryName')} className="h-8 text-[13px]" />
          <Button type="submit" size="icon" variant="ghost" aria-label={t('common.save')} disabled={!value.trim() || pending}>
            <Check className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={t('common.cancel')} onClick={() => { setValue(name); setEditing(false); }}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Button size="icon" variant="ghost" aria-label={t('ptopic.up')} disabled={first || pending} onClick={() => run(() => moveTopic('category', id, -1))}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t('ptopic.down')} disabled={last || pending} onClick={() => run(() => moveTopic('category', id, 1))}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t('ptopic.rename')} onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t('ptopic.archive')} title={t('ptopic.archive')} disabled={pending} onClick={() => run(() => setTopicArchived('category', id, true))}>
            <Archive className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </>
      )}
    </li>
  );
}
