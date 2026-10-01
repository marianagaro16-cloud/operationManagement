'use client';

import { useEffect, useState, useTransition } from 'react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/primitives';
import { createCategory, createTopic, loadPersonalTopics } from '@/server/topic-actions';
import type { PersonalTask, PersonalTopic, TopicColor } from '@/types/reminders';

/* Topics and categories of personal tasks: what the list, the rows and the form share. */

export const TOPIC_DOT: Record<TopicColor, string> = {
  slate: 'bg-slate-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
};

export function TopicDot({ color, className }: { color: TopicColor | null; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color ? TOPIC_DOT[color] : 'bg-border', className)} aria-hidden />;
}

/** "Cobranza · Llamadas" as a small chip on a task row. */
export function TopicChip({ task, topics }: { task: PersonalTask; topics: PersonalTopic[] }) {
  const topic = topics.find((t) => t.id === task.topic_id);
  if (!topic) return null;
  const category = topic.categories.find((c) => c.id === task.category_id);
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
      <TopicDot color={topic.color} />
      {topic.name}
      {category && <span className="text-subtle">· {category.name}</span>}
    </span>
  );
}

/** The viewer's topics, fetched once the form opens — so the form works from anywhere. */
export function usePersonalTopics(initial?: PersonalTopic[]) {
  const [topics, setTopics] = useState<PersonalTopic[] | null>(initial ?? null);
  useEffect(() => {
    if (initial) return;
    let live = true;
    loadPersonalTopics().then((res) => live && res.ok && setTopics(res.data));
    return () => {
      live = false;
    };
  }, [initial]);
  return [topics, setTopics] as const;
}

const NEW = '__new__';

/**
 * Topic, then category — each with "+ New…" to create one on the spot. An
 * archived topic or category stays shown when the task already carries it.
 */
export function TopicPicker({
  topics,
  onTopicsChange,
  topicId,
  categoryId,
  onChange,
}: {
  topics: PersonalTopic[];
  onTopicsChange: (next: PersonalTopic[]) => void;
  topicId: string | null;
  categoryId: string | null;
  onChange: (next: { topicId: string | null; categoryId: string | null }) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState<'topic' | 'category' | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shownTopics = topics.filter((tp) => !tp.archived_at || tp.id === topicId);
  const topic = topics.find((tp) => tp.id === topicId) ?? null;
  const shownCategories = topic ? topic.categories.filter((c) => !c.archived_at || c.id === categoryId) : [];

  function add() {
    const text = name.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      if (adding === 'topic') {
        const res = await createTopic({ name: text });
        if (!res.ok) return setError(res.error === 'topic_exists' ? t('ptopic.exists') : t('common.error'));
        onTopicsChange([...topics, { id: res.data.id, name: text, color: null, sort_order: 1e6, archived_at: null, categories: [] }]);
        onChange({ topicId: res.data.id, categoryId: null });
      } else if (adding === 'category' && topic) {
        const res = await createCategory(topic.id, { name: text });
        if (!res.ok) return setError(res.error === 'topic_exists' ? t('ptopic.exists') : t('common.error'));
        onTopicsChange(
          topics.map((tp) =>
            tp.id === topic.id ? { ...tp, categories: [...tp.categories, { id: res.data.id, name: text, sort_order: 1e6, archived_at: null }] } : tp,
          ),
        );
        onChange({ topicId: topic.id, categoryId: res.data.id });
      }
      setAdding(null);
      setName('');
    });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('ptopic.topic')} htmlFor="pt-topic">
          <Select
            id="pt-topic"
            value={topicId ?? ''}
            onChange={(e) => {
              if (e.target.value === NEW) return setAdding('topic');
              onChange({ topicId: e.target.value || null, categoryId: null });
            }}
          >
            <option value="">{t('ptopic.none')}</option>
            {shownTopics.map((tp) => (
              <option key={tp.id} value={tp.id}>{tp.name}</option>
            ))}
            <option value={NEW}>{t('ptopic.newTopic')}</option>
          </Select>
        </Field>
        <Field label={t('ptopic.category')} htmlFor="pt-category">
          <Select
            id="pt-category"
            value={categoryId ?? ''}
            disabled={!topic}
            onChange={(e) => {
              if (e.target.value === NEW) return setAdding('category');
              onChange({ topicId, categoryId: e.target.value || null });
            }}
          >
            <option value="">{t('ptopic.noCategory')}</option>
            {shownCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {topic && <option value={NEW}>{t('ptopic.newCategory')}</option>}
          </Select>
        </Field>
      </div>
      {adding && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder={adding === 'topic' ? t('ptopic.topicName') : t('ptopic.categoryName')}
            aria-label={adding === 'topic' ? t('ptopic.topicName') : t('ptopic.categoryName')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                add();
              }
            }}
          />
          <Button size="sm" variant="primary" onClick={add} loading={pending} disabled={!name.trim()}>
            {t('ptopic.create')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setName(''); }} disabled={pending}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {error && <p className="text-[12px] text-late">{error}</p>}
    </div>
  );
}
