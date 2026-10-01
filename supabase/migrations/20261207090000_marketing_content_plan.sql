-- ============================================================
-- Marketing step 2: the content plan (decided 2026-10-01).
--
-- Posts and campaigns per brand (the app's brands; none = the group as a
-- whole), each idea → in progress → published, with a planned day, channels,
-- the text, images and files, an event and products it is about, and — once
-- published — its results typed by hand.
--
-- Marketing, Admin and Owners write; Sales and Managers read.
-- ============================================================

create or replace function public.can_edit_marketing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved'
       and (p.team = 'marketing' or p.role in ('admin', 'owner'))
  );
$$;

create or replace function public.can_read_marketing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_marketing() or public.is_sales() or exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.status = 'approved' and p.role = 'manager'
  );
$$;

revoke all on function public.can_edit_marketing() from public, anon;
revoke all on function public.can_read_marketing() from public, anon;
grant execute on function public.can_edit_marketing() to authenticated;
grant execute on function public.can_read_marketing() to authenticated;

create table public.marketing_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 200),
  brand_id     uuid references public.brands (id) on delete set null,
  status       text not null default 'idea' check (status in ('idea', 'in_progress', 'published')),
  planned_on   date,
  published_on date,
  channels     text[] not null default '{}'
               check (channels <@ array['instagram', 'facebook', 'tiktok', 'linkedin', 'newsletter', 'web', 'other']),
  caption      text check (caption is null or length(caption) <= 5000),
  event_id     uuid references public.events (id) on delete set null,
  reach        int check (reach is null or reach >= 0),
  likes        int check (likes is null or likes >= 0),
  comments     int check (comments is null or comments >= 0),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index marketing_posts_planned_idx on public.marketing_posts (planned_on);
create index marketing_posts_event_idx on public.marketing_posts (event_id) where event_id is not null;

create trigger marketing_posts_set_updated_at before update on public.marketing_posts
  for each row execute function public.set_updated_at();

/* Published: the day it went out, unless given. */
create or replace function public.marketing_post_published_on()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_on is null then
    new.published_on := coalesce(new.planned_on, (now() at time zone 'Europe/Zurich')::date);
  elsif new.status <> 'published' then
    new.published_on := null;
  end if;
  return new;
end;
$$;

create trigger marketing_posts_published_on before insert or update on public.marketing_posts
  for each row execute function public.marketing_post_published_on();

create table public.marketing_post_products (
  post_id    uuid not null references public.marketing_posts (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (post_id, product_id)
);

create table public.marketing_post_files (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.marketing_posts (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   int not null,
  uploaded_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index marketing_post_files_post_idx on public.marketing_post_files (post_id, created_at);

alter table public.marketing_posts enable row level security;
alter table public.marketing_post_products enable row level security;
alter table public.marketing_post_files enable row level security;

create policy "marketing_posts: read" on public.marketing_posts for select to authenticated
  using ((select public.can_read_marketing()));
create policy "marketing_posts: write" on public.marketing_posts for all to authenticated
  using ((select public.can_edit_marketing())) with check ((select public.can_edit_marketing()));

create policy "marketing_post_products: read" on public.marketing_post_products for select to authenticated
  using ((select public.can_read_marketing()));
create policy "marketing_post_products: write" on public.marketing_post_products for all to authenticated
  using ((select public.can_edit_marketing())) with check ((select public.can_edit_marketing()));

create policy "marketing_post_files: read" on public.marketing_post_files for select to authenticated
  using ((select public.can_read_marketing()));
create policy "marketing_post_files: write" on public.marketing_post_files for all to authenticated
  using ((select public.can_edit_marketing())) with check ((select public.can_edit_marketing()));

grant select, insert, update, delete on public.marketing_posts, public.marketing_post_products, public.marketing_post_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-files',
  'marketing-files',
  false,
  20971520, -- 20 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf']
)
on conflict (id) do nothing;

create policy "marketing files: read" on storage.objects for select to authenticated
  using (bucket_id = 'marketing-files' and (select public.can_read_marketing()));
create policy "marketing files: upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marketing-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (select public.can_edit_marketing())
  );
create policy "marketing files: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-files' and (select public.can_edit_marketing()));
