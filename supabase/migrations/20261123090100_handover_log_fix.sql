-- ============================================================
-- The handover history: appending a word to the list of actions needs it
-- typed as text — untyped, Postgres read 'status' as an array literal and
-- the change failed.
-- ============================================================

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
    v_actions := array['added'::text] || case when new.link_id is not null then array['linked'::text] else '{}'::text[] end;
  else
    if new.removed_at is not null and old.removed_at is null then v_actions := v_actions || 'removed'::text; end if;
    if (new.title, coalesce(new.body, '')) is distinct from (old.title, coalesce(old.body, '')) then v_actions := v_actions || 'changed'::text; end if;
    if new.link_id is distinct from old.link_id then
      if old.link_id is not null then v_actions := v_actions || 'unlinked'::text; end if;
      if new.link_id is not null then v_actions := v_actions || 'linked'::text; end if;
    end if;
    if new.status is distinct from old.status then v_actions := v_actions || 'status'::text; end if;
    if coalesce(new.coverer_note, '') is distinct from coalesce(old.coverer_note, '') then v_actions := v_actions || 'note'::text; end if;
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
