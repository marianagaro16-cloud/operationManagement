-- ============================================================
-- Activities can be given to a person.
--
-- Until now only a one-off or a corrective action could name somebody; a
-- recurring activity produced days that belonged to nobody, and nothing in
-- the app could change that. Now:
--
--   tasks.default_assignee_id        who normally does this activity. Every
--                                    new day of it starts assigned to them.
--   task_occurrences.assignee_manual this day's person was chosen by hand in
--                                    the calendar, so a later change of the
--                                    default leaves it alone.
--
-- Changing an activity's default moves its PENDING days from today onward
-- to the new person, except the ones changed by hand. Past, completed and
-- skipped days keep who they were: they are the record.
--
-- Both are set in the database rather than by each insert path, so the
-- daily generator, planning from the calendar and anything added later
-- cannot forget it.
-- ============================================================

alter table public.tasks
  add column default_assignee_id uuid references public.profiles (id) on delete set null;

comment on column public.tasks.default_assignee_id is
  'Who normally does this activity. Each new occurrence starts assigned to them; NULL = shared.';

alter table public.task_occurrences
  add column assignee_manual boolean not null default false;

comment on column public.task_occurrences.assignee_manual is
  'The person for this day was chosen by hand, so a change of the activity''s default does not move it.';

create index tasks_default_assignee_idx on public.tasks (default_assignee_id)
  where default_assignee_id is not null;

-- ---------- a new day starts with the activity's person ----------

create or replace function public.occurrence_default_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Named on insert (a one-off, a corrective action): that choice is deliberate.
  if new.assignee_id is not null then
    new.assignee_manual := true;
  elsif not new.assignee_manual then
    select t.default_assignee_id into new.assignee_id
      from public.tasks t
     where t.id = new.task_id;
  end if;
  return new;
end;
$$;

create trigger task_occurrences_default_assignee
  before insert on public.task_occurrences
  for each row execute function public.occurrence_default_assignee();

-- ---------- a new default moves the days still to come ----------

create or replace function public.task_default_assignee_follows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_occurrences o
     set assignee_id = new.default_assignee_id
   where o.task_id = new.id
     and o.status = 'pending'
     and not o.assignee_manual
     and o.effective_due_date >= (now() at time zone 'Europe/Zurich')::date;
  return new;
end;
$$;

create trigger tasks_default_assignee_follows
  after update of default_assignee_id on public.tasks
  for each row
  when (new.default_assignee_id is distinct from old.default_assignee_id)
  execute function public.task_default_assignee_follows();

