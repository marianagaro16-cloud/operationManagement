-- ============================================================
-- Planned sales activities run from a time until a time.
--
--   sales_activities.activity_end        optional; only with a start, and after it.
--   sales_activity_kinds.default_minutes  how long a kind usually takes, which
--                                         fills the end in when a start is set.
-- ============================================================

alter table public.sales_activities add column activity_end time;
alter table public.sales_activities
  add constraint sales_activities_end_after_start check (
    activity_end is null or (activity_time is not null and activity_end > activity_time)
  );

alter table public.sales_activity_kinds
  add column default_minutes int not null default 30 check (default_minutes between 5 and 600);

update public.sales_activity_kinds set default_minutes = case slug
  when 'call' then 30
  when 'appointment' then 60
  when 'email' then 15
  when 'visit' then 60
  when 'whatsapp' then 15
  when 'offer' then 30
  else default_minutes
end;
