-- ============================================================
-- Sales: prospects — potential customers, from first contact to won or lost.
--
--   prospects        who they are, how we found them, what interests them,
--                    the stage, and — while open — the next step and its
--                    date, which is required. A responsible salesperson gets
--                    the reminder that day.
--   prospect_notes   calls, visits, messages, offers. Permanent, like
--                    customer notes.
--
-- Stages: new → contacted → tasting → offer → won | lost. Won and lost are
-- final: nothing about the prospect changes after, and a new attempt with a
-- lost one is a new prospect. Winning creates the customer, with the
-- prospect's details, and copies the notes to the customer's file.
--
-- All of it for sales (is_sales()): the Ventas team, Admin and Owners.
-- ============================================================

create table public.prospects (
  id               uuid primary key default gen_random_uuid(),
  company_name     text not null check (length(btrim(company_name)) > 0),
  contact_name     text,
  phone            text,
  email            text,
  street           text,
  postal_code      text,
  city             text,
  customer_type_id uuid references public.customer_types (id) on delete set null,
  source           text check (source in ('recommendation', 'visit', 'fair', 'internet', 'inbound', 'other')),
  interest         text,
  weekly_volume    text,
  stage            text not null default 'new'
                   check (stage in ('new', 'contacted', 'tasting', 'offer', 'won', 'lost')),
  next_step        text,
  next_step_on     date,
  owner_id         uuid references public.profiles (id) on delete set null,
  lost_reason      text check (lost_reason in ('price', 'not_interested', 'has_supplier', 'other')),
  lost_note        text,
  customer_id      uuid references public.customers (id) on delete set null,
  closed_at        timestamptz,
  -- The day whose next step was last announced, so it is announced once.
  next_step_notified_on date,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- While open, a next step and its date, always.
  constraint prospects_open_has_next_step check (
    stage in ('won', 'lost')
    or (next_step is not null and length(btrim(next_step)) > 0 and next_step_on is not null)
  ),
  constraint prospects_lost_has_reason check (stage <> 'lost' or lost_reason is not null),
  constraint prospects_won_has_customer check (stage <> 'won' or customer_id is not null)
);

create index prospects_open_idx on public.prospects (owner_id, next_step_on) where stage not in ('won', 'lost');

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

/* Closed is final; and the responsible person is someone in sales. */
create or replace function public.guard_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.stage in ('won', 'lost') then
    -- The notifier's bookkeeping is the one thing that may still move.
    if new is distinct from old and (select auth.uid()) is not null then
      raise exception 'prospect_closed' using errcode = '42501';
    end if;
  end if;
  if new.owner_id is not null and not exists (
    select 1 from public.profiles p
     where p.id = new.owner_id and p.status = 'approved'
       and (p.team = 'sales' or p.role in ('admin', 'owner'))
  ) then
    raise exception 'owner_not_sales' using errcode = '22023';
  end if;
  -- Won and lost go through their own functions, which set what they need.
  if (select auth.uid()) is not null and new.stage in ('won', 'lost')
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
     and current_setting('app.prospect_closing', true) is distinct from 'on' then
    raise exception 'use_win_or_lose' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger prospects_guard
  before insert or update on public.prospects
  for each row execute function public.guard_prospect();

create table public.prospect_notes (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  kind        text not null check (kind in ('call', 'visit', 'message', 'offer')),
  note_date   date not null,
  body        text not null check (length(btrim(body)) > 0),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index prospect_notes_prospect_idx on public.prospect_notes (prospect_id, note_date desc, created_at desc);

-- ---------- RLS ----------

alter table public.prospects      enable row level security;
alter table public.prospect_notes enable row level security;

create policy "prospects: sales read" on public.prospects
  for select to authenticated using ((select public.is_sales()));
create policy "prospects: sales add" on public.prospects
  for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));
-- Changed while open; never deleted (no delete policy).
create policy "prospects: sales change" on public.prospects
  for update to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));

create policy "prospect_notes: sales read" on public.prospect_notes
  for select to authenticated using ((select public.is_sales()));
create policy "prospect_notes: sales add" on public.prospect_notes
  for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));

-- ---------- won and lost ----------

/* Won: the customer is created from the prospect, and the notes go to its file. */
create or replace function public.sales_prospect_win(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.prospects%rowtype;
  v_customer uuid;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_p from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_p.stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;

  insert into public.customers (company_name, name, street, postal_code, city, customer_type_id)
  values (v_p.company_name, v_p.contact_name, v_p.street, v_p.postal_code, v_p.city, v_p.customer_type_id)
  returning id into v_customer;

  insert into public.customer_notes (customer_id, kind, note_date, body, created_by, created_at)
  select v_customer, n.kind, n.note_date, n.body, n.created_by, n.created_at
    from public.prospect_notes n where n.prospect_id = p_prospect_id;

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'won', customer_id = v_customer, closed_at = now(),
         next_step = null, next_step_on = null
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);

  return v_customer;
end;
$$;

create or replace function public.sales_prospect_lose(p_prospect_id uuid, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_sales() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select stage into v_stage from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;
  if v_stage in ('won', 'lost') then
    raise exception 'prospect_closed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('price', 'not_interested', 'has_supplier', 'other') then
    raise exception 'lost_reason_required' using errcode = '22023';
  end if;

  perform set_config('app.prospect_closing', 'on', true);
  update public.prospects
     set stage = 'lost', lost_reason = p_reason, lost_note = nullif(btrim(coalesce(p_note, '')), ''),
         closed_at = now(), next_step = null, next_step_on = null
   where id = p_prospect_id;
  perform set_config('app.prospect_closing', 'off', true);
end;
$$;

revoke all on function public.sales_prospect_win(uuid) from public, anon;
revoke all on function public.sales_prospect_lose(uuid, text, text) from public, anon;
grant execute on function public.sales_prospect_win(uuid) to authenticated;
grant execute on function public.sales_prospect_lose(uuid, text, text) to authenticated;
