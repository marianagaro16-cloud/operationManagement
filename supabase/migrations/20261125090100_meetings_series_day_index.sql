-- ============================================================
-- One meeting per series and day, as an index the "make what is missing"
-- insert can use. A partial index (where series_id is not null) cannot be
-- named in ON CONFLICT without its condition, which PostgREST does not send;
-- a full one behaves the same, since meetings without a series have a null
-- series_id and nulls never collide.
-- ============================================================

drop index public.meetings_series_day;
create unique index meetings_series_day on public.meetings (series_id, meeting_date);
