/** Where an event's photos and files live: `<event id>/<random>.<ext>`, one folder per event. */
export const EVENT_BUCKET = 'event-files';

/** Photos and PDFs, as the bucket itself allows. */
export const EVENT_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
export const EVENT_MAX_BYTES = 10 * 1024 * 1024;

/** An event's review columns: any of them filled means somebody said how it went. */
export const RESULT_COLUMNS = [
  'result_summary', 'result_rating', 'result_repeat', 'result_visitors', 'result_samples', 'result_contacts',
  'result_went_well', 'result_went_wrong', 'result_next_time', 'result_stand', 'result_public', 'result_busiest',
  'result_weather', 'result_competitors', 'result_organiser_rating', 'result_setup', 'result_staffing', 'result_materials',
] as const;

export function hasResults(e: object): boolean {
  const row = e as Record<string, unknown>;
  return RESULT_COLUMNS.some((k) => row[k] !== null && row[k] !== undefined && row[k] !== '');
}

/** Days after its end before the responsible person is reminded of an empty review. */
export const REVIEW_REMIND_DAYS = 3;
