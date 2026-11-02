-- ============================================================
-- Events: a fuller review of how it went (decided 2026-11-02).
--
--   events.result_*            besides rating, repeat and the figures:
--                              went well / went wrong / next time (in place
--                              of the single summary, which old events keep);
--                              place and public; organisation.
--   event_product_feedback     per product taken: liked / neutral / not
--                              liked, most asked for, a comment.
--   event_staff_reviews        everyone with an account who worked a shift
--                              gives a short view once the event is done:
--                              stars, went well, to improve. Shown with
--                              their names to whoever works on events.
--   event_review_notices       once per event: the push to its responsible
--                              person when the review is still empty three
--                              days after the end.
--
-- Whoever works on events (is_events()) writes the review, as before.
-- ============================================================

alter table public.events
  add column result_went_well        text,
  add column result_went_wrong       text,
  add column result_next_time        text,
  add column result_stand            text check (result_stand in ('good', 'average', 'bad')),
  add column result_public           text,
  add column result_busiest          text,
  add column result_weather          text,
  add column result_competitors      text,
  add column result_organiser_rating smallint check (result_organiser_rating between 1 and 5),
  add column result_setup            text,
  add column result_staffing         text check (result_staffing in ('enough', 'short', 'too_many')),
  add column result_materials        text;

/* Any result_* column, and marking done: whoever works on events. */
create or replace function public.guard_event_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_events() and (
       exists (
         select 1
           from jsonb_each(to_jsonb(new)) n
           join jsonb_each(to_jsonb(old)) o using (key)
          where n.key like 'result\_%' and n.value is distinct from o.value)
    or (new.stage = 'done' and old.stage <> 'done')
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- how the products were received ----------

create table public.event_product_feedback (
  event_id    uuid not null references public.events (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete restrict,
  reaction    text check (reaction in ('liked', 'neutral', 'disliked')),
  most_asked  boolean not null default false,
  comment     text check (comment is null or length(comment) <= 1000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  primary key (event_id, product_id)
);

alter table public.event_product_feedback enable row level security;

-- Written by event_set_product_feedback() only.
create policy "event_product_feedback: events read" on public.event_product_feedback for select to authenticated
  using ((select public.is_events()));

grant select on public.event_product_feedback to authenticated;

/* The whole list at once: rows with nothing said are dropped. */
create or replace function public.event_set_product_feedback(p_event_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_events() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select stage into v_stage from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;
  if v_stage in ('idea', 'cancelled') then
    raise exception 'event_closed' using errcode = '22023';
  end if;

  delete from public.event_product_feedback where event_id = p_event_id;
  insert into public.event_product_feedback (event_id, product_id, reaction, most_asked, comment, updated_by)
  select p_event_id, (r->>'product_id')::uuid, nullif(r->>'reaction', ''),
         coalesce((r->>'most_asked')::boolean, false), nullif(btrim(coalesce(r->>'comment', '')), ''), (select auth.uid())
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where nullif(r->>'reaction', '') is not null
      or coalesce((r->>'most_asked')::boolean, false)
      or nullif(btrim(coalesce(r->>'comment', '')), '') is not null;
end;
$$;

revoke all on function public.event_set_product_feedback(uuid, jsonb) from public, anon;
grant execute on function public.event_set_product_feedback(uuid, jsonb) to authenticated;

-- ---------- the staff's view ----------

create table public.event_staff_reviews (
  event_id    uuid not null references public.events (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  rating      smallint check (rating between 1 and 5),
  went_well   text check (went_well is null or length(went_well) <= 2000),
  to_improve  text check (to_improve is null or length(to_improve) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, profile_id),
  constraint event_staff_reviews_something check (rating is not null or went_well is not null or to_improve is not null)
);

create trigger event_staff_reviews_set_updated_at before update on public.event_staff_reviews
  for each row execute function public.set_updated_at();

alter table public.event_staff_reviews enable row level security;

-- Whoever works on events reads them all; anyone else their own. Written by event_staff_review_save() only.
create policy "event_staff_reviews: events read" on public.event_staff_reviews for select to authenticated
  using ((select public.is_events()) or profile_id = (select auth.uid()));

grant select on public.event_staff_reviews to authenticated;

/* The caller's own view, once the event is done, when they worked a shift on it. */
create or replace function public.event_staff_review_save(p_event_id uuid, p_rating int, p_went_well text, p_to_improve text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.event_shifts s where s.event_id = p_event_id and s.profile_id = v_uid) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.id = p_event_id and e.stage = 'done') then
    raise exception 'event_not_done' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  insert into public.event_staff_reviews (event_id, profile_id, rating, went_well, to_improve)
  values (p_event_id, v_uid, p_rating, nullif(btrim(coalesce(p_went_well, '')), ''), nullif(btrim(coalesce(p_to_improve, '')), ''))
  on conflict (event_id, profile_id) do update
    set rating = excluded.rating, went_well = excluded.went_well, to_improve = excluded.to_improve;
end;
$$;

revoke all on function public.event_staff_review_save(uuid, int, text, text) from public, anon;
grant execute on function public.event_staff_review_save(uuid, int, text, text) to authenticated;

/*
 * Who worked a shift on the event, with an account, and whether they gave
 * their view: for whoever works on events, to show who is still missing.
 */
create or replace function public.event_staff_review_status(p_event_id uuid)
returns table (profile_id uuid, name text, answered boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(p.name, ''), p.email),
         exists (select 1 from public.event_staff_reviews r where r.event_id = p_event_id and r.profile_id = p.id)
    from public.profiles p
   where public.is_events()
     and p.id in (select s.profile_id from public.event_shifts s where s.event_id = p_event_id and s.profile_id is not null)
   order by 2;
$$;

revoke all on function public.event_staff_review_status(uuid) from public, anon;
grant execute on function public.event_staff_review_status(uuid) to authenticated;

/*
 * The done events, in the last 30 days, where the caller worked a shift and
 * has not given their view yet: for their Inicio.
 */
create or replace function public.my_event_reviews_due()
returns table (event_id uuid, name text, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.end_date
    from public.events e
   where public.is_approved()
     and e.stage = 'done'
     and e.end_date >= (now() at time zone 'Europe/Zurich')::date - 30
     and exists (select 1 from public.event_shifts s where s.event_id = e.id and s.profile_id = (select auth.uid()))
     and not exists (select 1 from public.event_staff_reviews r where r.event_id = e.id and r.profile_id = (select auth.uid()))
     -- The responsible person writes the full review instead.
     and e.owner_id is distinct from (select auth.uid())
   order by e.end_date desc;
$$;

revoke all on function public.my_event_reviews_due() from public, anon;
grant execute on function public.my_event_reviews_due() to authenticated;

-- ---------- the responsible person's reminder ----------

-- Once per event. Written and read only by the notifier (service role).
create table public.event_review_notices (
  event_id uuid primary key references public.events (id) on delete cascade,
  sent_at  timestamptz not null default now()
);

alter table public.event_review_notices enable row level security;
