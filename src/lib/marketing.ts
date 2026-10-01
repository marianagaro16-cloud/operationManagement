/** The content plan: what the server and the screens share. */

export const MARKETING_BUCKET = 'marketing-files';
export const MARKETING_ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'video/mp4', 'video/quicktime', 'application/pdf',
];
export const MARKETING_MAX_BYTES = 20 * 1024 * 1024;

export const POST_STATUSES = ['idea', 'in_progress', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_CHANNELS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'newsletter', 'web', 'other'] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];
