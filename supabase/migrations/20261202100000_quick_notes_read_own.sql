-- A new note must be readable in the same statement that adds it (insert …
-- returning id). can_see_quick_note() looks the note up in a snapshot taken
-- before the insert, so it did not find it and the insert was refused.
-- The owner's own rows are now checked on the row itself.

drop policy "quick_notes: involved read" on public.quick_notes;
create policy "quick_notes: involved read" on public.quick_notes for select to authenticated
  using (
    public.is_approved() and (
      owner_id = (select auth.uid())
      or exists (select 1 from public.quick_note_shares s where s.note_id = id and s.profile_id = (select auth.uid()))
    )
  );
