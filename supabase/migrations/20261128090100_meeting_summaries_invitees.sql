-- ============================================================
-- A summary can be attached by anyone in sales who is part of the meeting —
-- its organiser or an invitee: the weekly meeting may be the CEO's, and the
-- summary Carlos's. Detached by whoever attached it, or the organiser.
-- ============================================================

drop policy "meeting_summaries: sales attach" on public.meeting_summaries;
create policy "meeting_summaries: sales attach" on public.meeting_summaries for insert to authenticated
  with check ((select public.is_sales()) and public.can_see_meeting(meeting_id) and attached_by = (select auth.uid()));

drop policy "meeting_summaries: organiser detaches" on public.meeting_summaries;
create policy "meeting_summaries: detach" on public.meeting_summaries for delete to authenticated
  using (attached_by = (select auth.uid()) or public.can_change_meeting(meeting_id));
