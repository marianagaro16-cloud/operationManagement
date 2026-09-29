/** Where an event's photos and files live: `<event id>/<random>.<ext>`, one folder per event. */
export const EVENT_BUCKET = 'event-files';

/** Photos and PDFs, as the bucket itself allows. */
export const EVENT_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
export const EVENT_MAX_BYTES = 10 * 1024 * 1024;
