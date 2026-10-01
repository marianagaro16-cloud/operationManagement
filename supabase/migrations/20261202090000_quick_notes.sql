-- Quick notes: a personal notepad. Private to whoever wrote it — not even an
-- Admin reads it — unless it is shared; whoever it is shared with reads it and
-- ticks its checklist lines, nothing more.
--
--   quick_notes         the note (owner, text, pin, customer, archived)
--   quick_note_items    checklist lines
--   quick_note_shares   who else sees it

create table public.quick_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  pinned boolean not null default false,
  customer_id uuid references public.customers (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quick_notes_owner_idx on public.quick_notes (owner_id, archived_at);
create index quick_notes_customer_idx on public.quick_notes (customer_id) where customer_id is not null;

create table public.quick_note_items (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.quick_notes (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  done boolean not null default false,
  sort_order int not null default 0,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz
);
create index quick_note_items_note_idx on public.quick_note_items (note_id, sort_order);

create table public.quick_note_shares (
  note_id uuid not null references public.quick_notes (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (note_id, profile_id)
);
create index quick_note_shares_profile_idx on public.quick_note_shares (profile_id);

create trigger quick_notes_set_updated_at before update on public.quick_notes
  for each row execute function public.set_updated_at();

create or replace function public.owns_quick_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.quick_notes n where n.id = p_note_id and n.owner_id = (select auth.uid()));
$$;

create or replace function public.can_see_quick_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.owns_quick_note(p_note_id)
    or exists (select 1 from public.quick_note_shares s where s.note_id = p_note_id and s.profile_id = (select auth.uid()))
  );
$$;

revoke all on function public.owns_quick_note(uuid) from public, anon;
revoke all on function public.can_see_quick_note(uuid) from public, anon;
grant execute on function public.owns_quick_note(uuid) to authenticated;
grant execute on function public.can_see_quick_note(uuid) to authenticated;

-- Whoever it is shared with ticks lines; the text, order and the rest stay the owner's.
create or replace function public.guard_quick_note_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.done is distinct from old.done then
    new.done_by := case when new.done then (select auth.uid()) else null end;
    new.done_at := case when new.done then now() else null end;
  else
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;
  if not public.owns_quick_note(old.note_id)
     and (new.body is distinct from old.body or new.sort_order is distinct from old.sort_order or new.note_id is distinct from old.note_id) then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

create trigger quick_note_items_guard before update on public.quick_note_items
  for each row execute function public.guard_quick_note_item();

alter table public.quick_notes enable row level security;
alter table public.quick_note_items enable row level security;
alter table public.quick_note_shares enable row level security;

create policy "quick_notes: involved read" on public.quick_notes for select to authenticated
  using (public.can_see_quick_note(id));
create policy "quick_notes: own add" on public.quick_notes for insert to authenticated
  with check (public.is_approved() and owner_id = (select auth.uid()));
create policy "quick_notes: own change" on public.quick_notes for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "quick_notes: own delete" on public.quick_notes for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "quick_note_items: involved read" on public.quick_note_items for select to authenticated
  using (public.can_see_quick_note(note_id));
create policy "quick_note_items: own add" on public.quick_note_items for insert to authenticated
  with check (public.owns_quick_note(note_id));
create policy "quick_note_items: involved tick" on public.quick_note_items for update to authenticated
  using (public.can_see_quick_note(note_id)) with check (public.can_see_quick_note(note_id));
create policy "quick_note_items: own delete" on public.quick_note_items for delete to authenticated
  using (public.owns_quick_note(note_id));

create policy "quick_note_shares: involved read" on public.quick_note_shares for select to authenticated
  using (public.can_see_quick_note(note_id));
create policy "quick_note_shares: own add" on public.quick_note_shares for insert to authenticated
  with check (public.owns_quick_note(note_id) and profile_id <> (select auth.uid()));
create policy "quick_note_shares: own remove" on public.quick_note_shares for delete to authenticated
  using (public.owns_quick_note(note_id));

grant select, insert, update, delete on public.quick_notes, public.quick_note_items, public.quick_note_shares to authenticated;
