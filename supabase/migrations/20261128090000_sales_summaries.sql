-- ============================================================
-- Sales: highlights and the summary for the weekly meetings.
--
--   customer_notes / prospect_notes .starred   a note marked as a highlight.
--       Notes stay permanent: the star is the one thing about a note that
--       changes, and only people in sales change it.
--   sales_summaries             a summary of a period, as it was when shared:
--       highlights (starred notes), the conversations with customers and
--       prospects, the activity figures, the events. A snapshot — the people
--       it is shared with read it without access to Ventas.
--   sales_summary_recipients    people it was sent to.
--   meeting_summaries           summaries attached to a meeting: its
--       organiser and invitees read them.
-- ============================================================

alter table public.customer_notes add column starred boolean not null default false;
alter table public.prospect_notes add column starred boolean not null default false;

create index customer_notes_starred_idx on public.customer_notes (note_date) where starred;
create index prospect_notes_starred_idx on public.prospect_notes (note_date) where starred;

/* A note is permanent; only its star changes. */
create or replace function public.guard_note_star()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'starred') is distinct from (to_jsonb(old) - 'starred') then
    raise exception 'note_permanent' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger customer_notes_star_only before update on public.customer_notes
  for each row execute function public.guard_note_star();
create trigger prospect_notes_star_only before update on public.prospect_notes
  for each row execute function public.guard_note_star();

create policy "customer_notes: sales star" on public.customer_notes for update to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));
create policy "prospect_notes: sales star" on public.prospect_notes for update to authenticated
  using ((select public.is_sales())) with check ((select public.is_sales()));

-- ---------- summaries ----------

create table public.sales_summaries (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) > 0),
  period_from date not null,
  period_to   date not null,
  content     jsonb not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint sales_summaries_period check (period_to >= period_from)
);

create index sales_summaries_created_idx on public.sales_summaries (created_at desc);

create table public.sales_summary_recipients (
  summary_id uuid not null references public.sales_summaries (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  sent_by    uuid references public.profiles (id) on delete set null,
  sent_at    timestamptz not null default now(),
  primary key (summary_id, profile_id)
);

create table public.meeting_summaries (
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  summary_id  uuid not null references public.sales_summaries (id) on delete cascade,
  attached_by uuid references public.profiles (id) on delete set null,
  attached_at timestamptz not null default now(),
  primary key (meeting_id, summary_id)
);

/* Sales, whoever it was sent to, and the people of a meeting it is attached to. */
create or replace function public.can_see_summary(p_summary_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    public.is_sales()
    or exists (select 1 from public.sales_summary_recipients r where r.summary_id = p_summary_id and r.profile_id = (select auth.uid()))
    or exists (select 1 from public.meeting_summaries ms where ms.summary_id = p_summary_id and public.can_see_meeting(ms.meeting_id))
  );
$$;

revoke all on function public.can_see_summary(uuid) from public, anon;
grant execute on function public.can_see_summary(uuid) to authenticated;

alter table public.sales_summaries          enable row level security;
alter table public.sales_summary_recipients enable row level security;
alter table public.meeting_summaries        enable row level security;

create policy "sales_summaries: shared read" on public.sales_summaries for select to authenticated
  using (public.can_see_summary(id));
create policy "sales_summaries: sales add" on public.sales_summaries for insert to authenticated
  with check ((select public.is_sales()) and created_by = (select auth.uid()));

create policy "sales_summary_recipients: shared read" on public.sales_summary_recipients for select to authenticated
  using (public.can_see_summary(summary_id));
create policy "sales_summary_recipients: sales send" on public.sales_summary_recipients for insert to authenticated
  with check ((select public.is_sales()) and sent_by = (select auth.uid()));

create policy "meeting_summaries: meeting read" on public.meeting_summaries for select to authenticated
  using (public.can_see_meeting(meeting_id));
-- Sales attach to a meeting they can change (their own, or Admin).
create policy "meeting_summaries: sales attach" on public.meeting_summaries for insert to authenticated
  with check ((select public.is_sales()) and public.can_change_meeting(meeting_id) and attached_by = (select auth.uid()));
create policy "meeting_summaries: organiser detaches" on public.meeting_summaries for delete to authenticated
  using (public.can_change_meeting(meeting_id));
