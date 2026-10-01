-- An organiser must be able to read back a meeting (or series) in the same
-- statement that adds it (insert … returning id). can_see_meeting() and
-- can_see_series() look the row up in a snapshot taken before the insert, so
-- only Admin — who passes without the lookup — could create meetings.
-- The organiser's own rows are now checked on the row itself.

create policy "meetings: organiser reads own" on public.meetings for select to authenticated
  using (organizer_id = (select auth.uid()) and public.is_approved());

create policy "meeting_series: organiser reads own" on public.meeting_series for select to authenticated
  using (organizer_id = (select auth.uid()) and public.is_approved());
