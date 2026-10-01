import type { PostChannel, PostStatus } from '@/lib/marketing';

/** One post or campaign in the content plan. */
export interface MarketingPost {
  id: string;
  title: string;
  brand_id: string | null;
  brand_name: string | null;
  status: PostStatus;
  planned_on: string | null;
  published_on: string | null;
  channels: PostChannel[];
  caption: string | null;
  event_id: string | null;
  event_name: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  author_name: string | null;
  updated_at: string;
}

export interface MarketingPostFile {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Signed for an hour; null when signing failed. */
  url: string | null;
}

export interface MarketingPostFull extends MarketingPost {
  products: { id: string; name: string }[];
  files: MarketingPostFile[];
}
