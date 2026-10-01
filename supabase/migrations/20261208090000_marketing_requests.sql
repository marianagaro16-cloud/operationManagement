-- ============================================================
-- Marketing step 3: requests to Marketing (decided 2026-10-01).
--
-- Anyone with an account asks Marketing for something — a post, a flyer,
-- photos: a title, what is needed, the brand, by when, and files. Marketing
-- (and Admin, Owners) see every request and move it new → in progress →
-- done; whoever asked sees their own, can change it while still new, cancel
-- it, and talk in its comments. A request can become a post of the plan.
-- ============================================================

create table public.marketing_requests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 5000),
  brand_id     uuid references public.brands (id) on delete set null,
  due_on       date,
  status       text not null default 'new' check (status in ('new', 'in_progress', 'done', 'cancelled')),
  requested_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id      uuid references public.marketing_posts (id) on delete set null,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index marketing_requests_status_idx on public.marketing_requests (status, due_on);
create index marketing_requests_requester_idx on public.marketing_requests (requested_by);

create trigger marketing_requests_set_updated_at before update on public.marketing_requests
  for each row execute function public.set_updated_at();

/* Who sees a request: whoever asked, and Marketing (with Admin and Owners). */
create or replace function public.can_see_marketing_request(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.can_edit_marketing()
    or exists (select 1 from public.marketing_requests r where r.id = p_id and r.requested_by = (select auth.uid()))
  );
$$;

revoke all on function public.can_see_marketing_request(uuid) from public, anon;
grant execute on function public.can_see_marketing_request(uuid) to authenticated;

/*
 * Marketing moves a request; whoever asked may change it only while it is
 * new, and only to cancel it. Done is stamped.
 */
create or replace function public.guard_marketing_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.requested_by := old.requested_by;
  if not public.can_edit_marketing() then
    if old.status <> 'new' or new.status not in ('new', 'cancelled') or new.post_id is distinct from old.post_id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger marketing_requests_guard before update on public.marketing_requests
  for each row execute function public.guard_marketing_request();

create table public.marketing_request_comments (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.marketing_requests (id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index marketing_request_comments_idx on public.marketing_request_comments (request_id, created_at);

create table public.marketing_request_files (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.marketing_requests (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null,
  uploaded_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index marketing_request_files_idx on public.marketing_request_files (request_id, created_at);

alter table public.marketing_requests enable row level security;
alter table public.marketing_request_comments enable row level security;
alter table public.marketing_request_files enable row level security;

-- Read on the row itself, so a new request can be read back as it is added.
create policy "marketing_requests: read" on public.marketing_requests for select to authenticated
  using ((select public.is_approved()) and (requested_by = (select auth.uid()) or (select public.can_edit_marketing())));
create policy "marketing_requests: ask" on public.marketing_requests for insert to authenticated
  with check ((select public.is_approved()) and requested_by = (select auth.uid()) and status = 'new' and post_id is null);
create policy "marketing_requests: change" on public.marketing_requests for update to authenticated
  using ((select public.is_approved()) and (requested_by = (select auth.uid()) or (select public.can_edit_marketing())))
  with check ((select public.is_approved()));
create policy "marketing_requests: marketing removes" on public.marketing_requests for delete to authenticated
  using ((select public.can_edit_marketing()));

create policy "marketing_request_comments: read" on public.marketing_request_comments for select to authenticated
  using (public.can_see_marketing_request(request_id));
create policy "marketing_request_comments: add" on public.marketing_request_comments for insert to authenticated
  with check (public.can_see_marketing_request(request_id) and author_id = (select auth.uid()));

create policy "marketing_request_files: read" on public.marketing_request_files for select to authenticated
  using (public.can_see_marketing_request(request_id));
create policy "marketing_request_files: add" on public.marketing_request_files for insert to authenticated
  with check (public.can_see_marketing_request(request_id) and uploaded_by = (select auth.uid()));
create policy "marketing_request_files: remove" on public.marketing_request_files for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.can_edit_marketing()));

grant select, insert, update, delete on public.marketing_requests, public.marketing_request_comments, public.marketing_request_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-requests',
  'marketing-requests',
  false,
  20971520, -- 20 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf']
)
on conflict (id) do nothing;

-- Files sit in the request's folder: whoever sees the request sees and adds them.
create policy "marketing requests: read" on storage.objects for select to authenticated
  using (
    bucket_id = 'marketing-requests'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.can_see_marketing_request(((storage.foldername(name))[1])::uuid)
  );
create policy "marketing requests: upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marketing-requests'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and public.can_see_marketing_request(((storage.foldername(name))[1])::uuid)
  );
create policy "marketing requests: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-requests' and (owner = (select auth.uid()) or (select public.can_edit_marketing())));
