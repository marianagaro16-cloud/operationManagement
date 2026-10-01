-- ============================================================
-- Topics and categories for personal tasks (decided 2026-10-01).
--
-- Each person builds their own: private like the tasks themselves. A task
-- has no topic, a topic, or a topic and one of its categories. Topics and
-- categories are archived, never deleted: an archived one leaves the pickers
-- while the tasks filed under it keep showing it.
-- ============================================================

create table public.personal_task_topics (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  color       text check (color in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  sort_order  int not null default 100,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index personal_task_topics_name_key on public.personal_task_topics (owner_id, lower(btrim(name)));

create table public.personal_task_categories (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references public.personal_task_topics (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  sort_order  int not null default 100,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index personal_task_categories_name_key on public.personal_task_categories (topic_id, lower(btrim(name)));
create index personal_task_categories_owner_idx on public.personal_task_categories (owner_id);

alter table public.personal_tasks
  add column topic_id    uuid references public.personal_task_topics (id) on delete set null,
  add column category_id uuid references public.personal_task_categories (id) on delete set null;
create index personal_tasks_topic_idx on public.personal_tasks (topic_id) where topic_id is not null;

/* A category belongs to its topic and to the same person; so does a task's filing. */
create or replace function public.guard_personal_task_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.personal_task_topics t where t.id = new.topic_id and t.owner_id = new.owner_id) then
    raise exception 'topic_not_found' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger personal_task_categories_guard before insert or update on public.personal_task_categories
  for each row execute function public.guard_personal_task_category();

create or replace function public.guard_personal_task_topic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The category decides the topic.
  if new.category_id is not null then
    select c.topic_id into new.topic_id
      from public.personal_task_categories c
     where c.id = new.category_id and c.owner_id = new.owner_id;
    if new.topic_id is null then
      raise exception 'topic_not_found' using errcode = '22023';
    end if;
  end if;
  if new.topic_id is not null
     and not exists (select 1 from public.personal_task_topics t where t.id = new.topic_id and t.owner_id = new.owner_id) then
    raise exception 'topic_not_found' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger personal_tasks_guard_topic before insert or update of topic_id, category_id on public.personal_tasks
  for each row execute function public.guard_personal_task_topic();

alter table public.personal_task_topics enable row level security;
alter table public.personal_task_categories enable row level security;

create policy "personal_task_topics: owner all" on public.personal_task_topics for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.is_approved()));

create policy "personal_task_categories: owner all" on public.personal_task_categories for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.is_approved()));

grant select, insert, update, delete on public.personal_task_topics, public.personal_task_categories to authenticated;
