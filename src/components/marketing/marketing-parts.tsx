'use client';

import Link from 'next/link';
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Badge, Card } from '@/components/ui/primitives';
import type { PostChannel, PostStatus } from '@/lib/marketing';
import type { MarketingPost } from '@/types/marketing';

/* What the content plan's screens share. */

const STATUS_TONE: Record<PostStatus, 'neutral' | 'accent' | 'done'> = { idea: 'neutral', in_progress: 'accent', published: 'done' };
const STATUS_LABEL: Record<PostStatus, MessageKey> = {
  idea: 'mkt.statusIdea',
  in_progress: 'mkt.statusInProgress',
  published: 'mkt.statusPublished',
};
const CHANNEL_LABEL: Record<PostChannel, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  newsletter: 'Newsletter',
  web: 'Web',
  other: '',
};

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Badge>;
}

export function usePostLabels() {
  const { t } = useI18n();
  return {
    status: (s: PostStatus) => t(STATUS_LABEL[s]),
    channel: (c: PostChannel) => CHANNEL_LABEL[c] || t('mkt.channelOther'),
    brand: (p: { brand_name: string | null }) => p.brand_name ?? t('mkt.group'),
    error: (code: string) =>
      code === 'not_authorized' ? t('mkt.errNotAuthorized') : code === 'title_required' ? t('mkt.errTitle') : t('common.error'),
  };
}

/** A colour per brand, steady across screens: picked from its name. */
const BRAND_COLORS = ['bg-blue-500', 'bg-orange-500', 'bg-green-500', 'bg-violet-500', 'bg-pink-500', 'bg-teal-500', 'bg-amber-500', 'bg-red-500'];
export function brandColor(name: string | null): string {
  if (!name) return 'bg-slate-400';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BRAND_COLORS[h % BRAND_COLORS.length];
}

export function BrandDot({ name, className }: { name: string | null; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', brandColor(name), className)} aria-hidden />;
}

/** A post as a row: day, brand, title, status, channels. */
export function PostRow({ post }: { post: MarketingPost }) {
  const { formatDate } = useI18n();
  const labels = usePostLabels();
  return (
    <Link href={`/marketing/${post.id}`} className="flex items-start gap-3 px-3.5 py-2.5 hover:bg-surface-2">
      <span className="w-20 shrink-0 text-[12px] tabular text-muted">{post.planned_on ? formatDate(post.planned_on, 'short') : '—'}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">
          <BrandDot name={post.brand_name} />
          {post.title}
        </p>
        <p className="text-[12px] text-muted">
          {labels.brand(post)}
          {post.channels.length > 0 && ` · ${post.channels.map(labels.channel).join(', ')}`}
        </p>
      </div>
      <PostStatusBadge status={post.status} />
    </Link>
  );
}

/** The posts about an event, on the event's page. */
export function EventPosts({ posts }: { posts: MarketingPost[] }) {
  const { t } = useI18n();
  if (posts.length === 0) return null;
  return (
    <section className="mt-4">
      <h2 className="mb-1.5 px-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{t('mkt.eventPosts')}</h2>
      <Card className="divide-y divide-border">
        {posts.map((p) => <PostRow key={p.id} post={p} />)}
      </Card>
    </section>
  );
}
