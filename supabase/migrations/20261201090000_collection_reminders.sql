-- ============================================================
-- Collections start at the invoicing program's payment reminders.
--
-- A case can open at the first reminder: stage 'reminders', counting the
-- reminders sent (1–3), each with its date in the history. After the third
-- it moves to follow-up (calls, emails) as before.
--
-- What everyone else learns now has two levels: 'reminder' while reminders
-- are running, 'pending' from follow-up on (and at the agency). The old
-- collection_flagged_customers() stays for the app already deployed.
-- ============================================================

alter table public.collection_cases drop constraint collection_cases_stage_check;
alter table public.collection_cases add constraint collection_cases_stage_check
  check (stage in ('reminders', 'follow_up', 'promise', 'paid', 'agency', 'paid_agency', 'uncollectible'));

alter table public.collection_cases
  add column reminders_sent int not null default 0 check (reminders_sent between 0 and 3);

alter table public.collection_events drop constraint collection_events_kind_check;
alter table public.collection_events add constraint collection_events_kind_check
  check (kind in ('call', 'email', 'note', 'promise', 'payment', 'stage', 'agency', 'invoice', 'responsible', 'reminder'));

/* Customers with an open case, and how far it is: 'reminder' or 'pending'. Nothing else. */
create or replace function public.collection_customer_flags()
returns table (customer_id uuid, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.customer_id,
         case when bool_or(c.stage <> 'reminders') then 'pending' else 'reminder' end
    from public.collection_cases c
   where c.closed_at is null and public.is_approved()
   group by c.customer_id;
$$;

revoke all on function public.collection_customer_flags() from public, anon;
grant execute on function public.collection_customer_flags() to authenticated;
