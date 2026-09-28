-- ============================================================
-- Birthdays and work anniversaries.
--
--   hr_workers.birth_date    new, in the worker's file. The anniversary
--                            uses the start date already there.
--   hr_celebration_notices   one row per notice sent — a person, the
--                            occasion, its date and the stage (3 days
--                            before, or the day) — so the notifier, called
--                            every few minutes, tells people once.
--
-- Who is told: whoever can see that person's file (hr_can_worker for each
-- of them): Admin, Owners, Manager, the Production manager for Production's
-- people — never the person themselves, and nobody about an Owner, whose
-- file nobody sees. Current staff only.
-- ============================================================

alter table public.hr_workers add column birth_date date;

create table public.hr_celebration_notices (
  worker_id uuid not null references public.hr_workers (id) on delete cascade,
  kind      text not null check (kind in ('birthday', 'anniversary')),
  on_date   date not null,
  stage     text not null check (stage in ('before', 'day')),
  sent_at   timestamptz not null default now(),
  primary key (worker_id, kind, on_date, stage)
);

-- Written and read only by the notifier (service role).
alter table public.hr_celebration_notices enable row level security;

/*
 * Who may be told about this worker: the same people who may open the file,
 * decided per recipient rather than for the caller. Mirrors hr_can_worker().
 */
create or replace function public.hr_celebration_recipients(p_worker_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.hr_workers w
    join public.profiles p on p.status = 'approved' and p.deleted_at is null
   where w.id = p_worker_id
     and w.is_active
     and p.id is distinct from w.profile_id
     and not public.is_owner_account(w.profile_id)
     and (
       p.role in ('admin', 'owner')
       or (
         exists (select 1 from public.role_permissions rp
                  where rp.role = p.role and rp.permission = 'hr.manage')
         -- A Production manager sees their own team's files only (hr_scope()).
         and (p.role <> 'production_manager' or p.team = w.team)
       )
     );
$$;

revoke all on function public.hr_celebration_recipients(uuid) from public, anon, authenticated;
