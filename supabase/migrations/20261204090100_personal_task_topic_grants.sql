-- personal_tasks is written column by column (see 20260928090000); the filing
-- columns join the list.
grant insert (topic_id, category_id) on public.personal_tasks to authenticated;
grant update (topic_id, category_id) on public.personal_tasks to authenticated;
