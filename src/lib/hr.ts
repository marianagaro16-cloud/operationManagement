/** Where a note's files live: `<note id>/<random>.<ext>`, one folder per note. */
export const HR_BUCKET = 'hr-attachments';

/** What a note may carry — photos and PDFs, as the bucket itself allows. */
export const HR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
export const HR_MAX_BYTES = 10 * 1024 * 1024;
