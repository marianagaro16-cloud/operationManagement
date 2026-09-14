-- ============================================================
-- Reminders and Personal Tasks for every approved user.
--
-- They were gated on a reminders.use capability held by Admin, Manager and
-- Power User. The people on the floor asked for them too — a reminder is a
-- personal tool, useful to anybody who uses the app.
--
-- The capability cannot simply be granted to 'user': role_permissions has a
-- CHECK allowing only 'manager' and 'power_user' rows, deliberately, so the
-- plain role structurally holds no delegated authority. Rather than weaken
-- that, the gate becomes what reminders actually require — an approved
-- account — and the capability, which would no longer decide anything, is
-- removed so the permission matrix does not show a checkbox that does
-- nothing.
--
-- Privacy is unchanged: a reminder is still visible only to its
-- participants and a personal task only to its owner. Everybody can now be
-- chosen as a participant, because everybody can now use them.
-- ============================================================

create or replace function public.can_use_reminders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved();
$$;

revoke all on function public.can_use_reminders() from public;
grant execute on function public.can_use_reminders() to authenticated;

comment on function public.can_use_reminders() is
  'Who may use reminders and personal tasks: any approved user. One place to change if that ever narrows again.';

-- Who may be added as a participant, or notified.
create or replace function public.reminders_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.status = 'approved');
$$;

create or replace function public.reminder_guard()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.can_use_reminders() then
    raise exception 'not_authorized';
  end if;
  return v_uid;
end;
$$;

-- ---------- policies: same shape, new gate ----------

drop policy if exists "reminders: participants read" on public.reminders;
create policy "reminders: participants read" on public.reminders
  for select to authenticated
  using (
    ( select can_use_reminders())
    and exists (
      select 1 from public.reminder_participants rp
       where rp.reminder_id = reminders.id and rp.user_id = ( select auth.uid())
    )
  );

drop policy if exists "reminder_participants: co-participants read" on public.reminder_participants;
create policy "reminder_participants: co-participants read" on public.reminder_participants
  for select to authenticated
  using (( select can_use_reminders()) and public.is_reminder_participant(reminder_id));

drop policy if exists "reminder_events: participants read" on public.reminder_events;
create policy "reminder_events: participants read" on public.reminder_events
  for select to authenticated
  using (( select can_use_reminders()) and public.is_reminder_participant(reminder_id));

drop policy if exists "personal_tasks: owner reads" on public.personal_tasks;
create policy "personal_tasks: owner reads" on public.personal_tasks
  for select to authenticated
  using (owner_id = ( select auth.uid()) and ( select can_use_reminders()));

drop policy if exists "personal_tasks: owner creates" on public.personal_tasks;
create policy "personal_tasks: owner creates" on public.personal_tasks
  for insert to authenticated
  with check (owner_id = ( select auth.uid()) and ( select can_use_reminders()));

drop policy if exists "personal_tasks: owner updates" on public.personal_tasks;
create policy "personal_tasks: owner updates" on public.personal_tasks
  for update to authenticated
  using (owner_id = ( select auth.uid()) and ( select can_use_reminders()))
  with check (owner_id = ( select auth.uid()) and ( select can_use_reminders()));

-- ---------- the capability goes ----------

-- The grants cascade from the catalogue row.
delete from public.role_permissions where permission = 'reminders.use';
delete from public.permission_catalog where key = 'reminders.use';
