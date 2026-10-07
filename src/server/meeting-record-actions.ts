'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from './actions';
import { AGREEMENT_RESULTS, NOTE_TOPICS } from '@/domain/hr/note-structure';

/*
 * A meeting's record for the workers' files. Who may write, and whether it is
 * complete, is the database's decision (meeting_record_save); these shape the
 * input and translate errors.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

const personSchema = z.object({
  profile_id: z.string().uuid().nullable(),
  worker_id: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(200),
});

const contentSchema = z.object({
  attendees: z.array(personSchema).max(80),
  points: z
    .array(
      z.object({
        title: z.string().trim().max(300),
        topic: z.enum(NOTE_TOPICS).nullable(),
        situation: z.string().trim().max(10000),
        discussed: z.string().trim().max(10000),
        no_agreements_reason: z.string().trim().max(1000),
        agreements: z
          .array(z.object({ body: z.string().trim().max(2000), all: z.boolean(), responsible: personSchema.nullable(), due_on: DATE.nullable() }))
          .max(30),
      }),
    )
    .max(30),
  follow_up_on: DATE.nullable(),
});

export type MeetingRecordInput = z.input<typeof contentSchema>;

const ERRORS = [
  'not_authorized', 'files_not_allowed', 'meeting_not_held', 'record_registered', 'record_not_registered',
  'attendee_required', 'point_incomplete', 'topic_required', 'agreement_required', 'agreement_incomplete',
  'follow_up_required', 'follow_up_date_invalid', 'follow_up_closed', 'participant_not_found',
  'result_required', 'result_comment_required', 'body_required', 'invalid_date',
];

function fail(error: unknown): { ok: false; error: string } {
  const message = String((error as { message?: string })?.message ?? error);
  return { ok: false, error: ERRORS.find((code) => message.includes(code)) ?? (message.includes('row-level security') ? 'not_authorized' : 'unknown') };
}

function revalidate(meetingId: string) {
  revalidatePath('/meetings');
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath('/hr', 'layout');
  revalidatePath('/dashboard');
}

/** Saves the record as a draft, or registers it: from then on it is permanent and in the attendees' files. */
export async function saveMeetingRecord(meetingId: string, input: MeetingRecordInput, register: boolean): Promise<ActionResult> {
  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'unknown' };
  const supabase = createClient();
  const { error } = await supabase.rpc('meeting_record_save', { p_meeting_id: meetingId, p_content: parsed.data, p_register: register });
  if (error) return fail(error);
  revalidate(meetingId);
  return { ok: true, data: undefined };
}

const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addendum'), entry_date: DATE, body: z.string().trim().min(1, { message: 'body_required' }).max(10000) }),
  // What came of the agreements: it ends here, or it continues on a new date.
  z.object({
    kind: z.literal('followup'),
    entry_date: DATE,
    body: z.string().trim().min(1, { message: 'body_required' }).max(10000),
    closes: z.boolean(),
    next_on: DATE.nullable(),
    results: z
      .array(z.object({ agreement_id: z.string().uuid(), result: z.enum(AGREEMENT_RESULTS), comment: z.string().trim().max(1000).nullable() }))
      .max(200),
  }),
]);

export type MeetingRecordEntryInput = z.input<typeof entrySchema>;

/** Adds to a registered record — by the organiser or an Admin. The record itself is never touched. */
export async function addMeetingRecordEntry(meetingId: string, input: MeetingRecordEntryInput): Promise<ActionResult> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'unknown' };
  const v = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.rpc('meeting_record_entry_add', {
    p_meeting_id: meetingId,
    p_kind: v.kind,
    p_entry_date: v.entry_date,
    p_body: v.body,
    p_closes: v.kind === 'followup' && v.closes,
    p_next_on: v.kind === 'followup' && !v.closes ? v.next_on : null,
    p_results: v.kind === 'followup' ? v.results : null,
  });
  if (error) return fail(error);
  revalidate(meetingId);
  return { ok: true, data: undefined };
}

/** "This meeting goes into the files" — or not, while nobody has started its record. */
export async function setMeetingForFiles(meetingId: string, on: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc('meeting_set_hr_record', { p_meeting_id: meetingId, p_on: on });
  if (error) return fail(error);
  revalidate(meetingId);
  return { ok: true, data: undefined };
}
