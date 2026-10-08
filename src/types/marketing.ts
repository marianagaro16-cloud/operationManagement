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

/** Something asked of Marketing. */
export interface MarketingRequest {
  id: string;
  title: string;
  description: string | null;
  brand_id: string | null;
  brand_name: string | null;
  due_on: string | null;
  status: import('@/lib/marketing').RequestStatus;
  requested_by: string;
  /** Everyone who asked: requested_by first, then whoever asks with them. */
  requester_ids: string[];
  /** Their names, in that order. */
  requester_name: string | null;
  post_id: string | null;
  done_at: string | null;
  created_at: string;
}

export interface MarketingRequestFull extends MarketingRequest {
  comments: { id: string; body: string; author_id: string; author_name: string | null; created_at: string }[];
  files: (MarketingPostFile & { uploaded_by: string })[];
}
