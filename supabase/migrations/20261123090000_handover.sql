-- ============================================================
-- Absence & Coverage, step 4: the handover.
--
--   handover_items   what the people covering should know, per absence:
--                    a title, a text, and optionally one existing record it
--                    is about — a customer, an order, an incident, an
--                    activity, a reception, an inventory, a product, or one
--                    of the author's own reminders or personal tasks. The
--                    record is never copied: its id, and the label it had
--                    when linked (so a private reminder shows its title and
--                    date and nothing else). Status open → in progress →
--                    done, and a note back from whoever covers. Removed
--                    items stay (removed_at).
--   handover_events  history: added, changed, linked, unlinked, status,
--                    note, removed, sent.
--   handover_sends   each "send to the people covering me".
--
-- Who sees it: the absent person, the approvers, and whoever covers that
-- absence. Who writes it: the absent person and the approvers; the people
-- covering change the status and write their note (handover_item_progress).
-- ============================================================

create or replace function public.can_see_handover(p_absence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_absence_approver()
    or exists (select 1 from public.absences a where a.id = p_absence_id and a.profile_id = (select auth.uid()))
    or exists (select 1 from public.coverage_assignments c
                where c.absence_id = p_absence_id and c.coverer_id = (select auth.uid()) and c.removed_at is null)
  );
$$;

create or replace function public.can_write_handover(p_absence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_absence_approver()
    or exists (select 1 from public.absences a where a.id = p_absence_id and a.profile_id = (select auth.uid()))
  );
$$;

revoke all on function public.can_see_handover(uuid) from public, anon;
revoke all on function public.can_write_handover(uuid) from public, anon;
grant execute on function public.can_see_handover(uuid) to authenticated;
grant execute on function public.can_write_handover(uuid) to authenticated;

create table public.handover_items (
  id           uuid primary key default gen_random_uuid(),
  absence_id   uuid not null references public.absences (id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  body         text,
  link_type    text check (link_type in ('customer', 'order', 'incident', 'task', 'personal_task', 'reminder',
                                         'goods_reception', 'inventory', 'product')),
  link_id      uuid,
  -- What the record was called when linked: all a covering person may see of a private one.
  link_label   text,
  status       text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  coverer_note text,
  sort_order   int not null default 100,
  created_by   uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  removed_at   timestamptz,
  constraint handover_link_whole check ((link_type is null) = (link_id is null))
);

create index handover_items_absence_idx on public.handover_items (absence_id, sort_order) where removed_at is null;
create index handover_items_link_idx on public.handover_items (link_type, link_id) where link_id is not null;

create trigger handover_items_set_updated_at before update on public.handover_items
  for each row execute function public.set_updated_at();

create table public.handover_events (
  id         bigserial primary key,
  item_id    uuid references public.handover_items (id) on delete cascade,
  absence_id uuid not null references public.absences (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index handover_events_absence_idx on public.handover_events (absence_id, created_at);

create table public.handover_sends (
  id         bigserial primary key,
  absence_id uuid not null references public.absences (id) on delete cascade,
  sent_by    uuid references public.profiles (id) on delete set null,
  recipients int not null default 0,
  sent_at    timestamptz not null default now()
);

create index handover_sends_absence_idx on public.handover_sends (absence_id, sent_at);

create or replace function public.log_handover_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actions text[] := '{}';
  v_a text;
begin
  if tg_op = 'INSERT' then
    v_actions := array['added'] || case when new.link_id is not null then array['linked'] else '{}' end;
  else
    if new.removed_at is not null and old.removed_at is null then v_actions := v_actions || 'removed'; end if;
    if (new.title, coalesce(new.body, '')) is distinct from (old.title, coalesce(old.body, '')) then v_actions := v_actions || 'changed'; end if;
    if new.link_id is distinct from old.link_id then
      if old.link_id is not null then v_actions := v_actions || 'unlinked'; end if;
      if new.link_id is not null then v_actions := v_actions || 'linked'; end if;
    end if;
    if new.status is distinct from old.status then v_actions := v_actions || 'status'; end if;
    if coalesce(new.coverer_note, '') is distinct from coalesce(old.coverer_note, '') then v_actions := v_actions || 'note'; end if;
  end if;
  foreach v_a in array v_actions loop
    insert into public.handover_events (item_id, absence_id, actor_id, action, detail)
    values (new.id, new.absence_id, (select auth.uid()), v_a, jsonb_build_object(
      'title', new.title, 'status', new.status, 'link_type', new.link_type, 'link_label', new.link_label,
      'previous_link_label', case when tg_op = 'UPDATE' then old.link_label end));
  end loop;
  return new;
end;
$$;

create trigger handover_items_log
  after insert or update on public.handover_items
  for each row execute function public.log_handover_item();

/* The people covering change only the status and their note, through handover_item_progress(). */
create or replace function public.guard_handover_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.removed_at is not null then
    raise exception 'handover_item_removed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.absence_id is distinct from old.absence_id then
    raise exception 'handover_item_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger handover_items_guard
  before update on public.handover_items
  for each row execute function public.guard_handover_item();

alter table public.handover_items  enable row level security;
alter table public.handover_events enable row level security;
alter table public.handover_sends  enable row level security;

create policy "handover_items: involved read" on public.handover_items for select to authenticated
  using (public.can_see_handover(absence_id));
create policy "handover_items: author adds" on public.handover_items for insert to authenticated
  with check (public.can_write_handover(absence_id) and created_by = (select auth.uid()));
create policy "handover_items: author changes" on public.handover_items for update to authenticated
  using (public.can_write_handover(absence_id)) with check (public.can_write_handover(absence_id));

create policy "handover_events: involved read" on public.handover_events for select to authenticated
  using (public.can_see_handover(absence_id));
create policy "handover_sends: involved read" on public.handover_sends for select to authenticated
  using (public.can_see_handover(absence_id));
create policy "handover_sends: author sends" on public.handover_sends for insert to authenticated
  with check (public.can_write_handover(absence_id) and sent_by = (select auth.uid()));

/* Whoever covers the absence (or may write it): an item's status, and a note back. */
create or replace function public.handover_item_progress(p_item_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.handover_items%rowtype;
begin
  select * into v_i from public.handover_items where id = p_item_id and removed_at is null for update;
  if not found then
    raise exception 'handover_item_not_found' using errcode = 'P0002';
  end if;
  if not public.can_see_handover(v_i.absence_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_status not in ('open', 'in_progress', 'done') then
    raise exception 'handover_bad_status' using errcode = '22023';
  end if;
  update public.handover_items
     set status = p_status,
         coverer_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_by = (select auth.uid())
   where id = p_item_id;
end;
$$;

revoke all on function public.handover_item_progress(uuid, text, text) from public, anon;
grant execute on function public.handover_item_progress(uuid, text, text) to authenticated;
