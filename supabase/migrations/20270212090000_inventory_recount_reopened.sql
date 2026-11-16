-- ============================================================
-- A product reopened for a recount can be counted again — any day.
--
-- When the digital side finds a difference it reopens the product so the
-- physical count is done again. Until now that reopen did nothing for the
-- counter once the inventory was closed or past its 18:00: the whole
-- inventory stayed locked and someone had to hand out a temporary grant.
--
-- Decided 2026-11-16:
--   * who:   everyone assigned to the inventory (or covering for them);
--   * what:  only the reopened products — the rest stays locked;
--   * until: the product is marked done again, whatever day that is;
--   * a notice to the assignees, one per inventory (sent by the app).
--
-- "Reopened for a recount" = reopened by someone who manages inventories
-- while the inventory is closed or past its deadline. A reopen during the
-- normal count is just the counter undoing their own "done", as before.
-- ============================================================

alter table public.inventory_instance_items
  add column recount_requested_at timestamptz,
  add column recount_requested_by uuid references public.profiles (id) on delete set null,
  add column recount_notified_at  timestamptz;

comment on column public.inventory_instance_items.recount_requested_at is
  'Reopened for a recount after the inventory closed: its assignees may count it again until it is marked done.';
comment on column public.inventory_instance_items.recount_notified_at is
  'When the assignees were told about this recount (one notice per inventory, sent by the app).';

-- The counter reads only granted columns (20270211090000). The request time
-- says nothing about the digital side; who asked does, so it stays hidden.
grant select (recount_requested_at) on public.inventory_instance_items to authenticated;

create index inventory_items_recount_idx
  on public.inventory_instance_items (instance_id)
  where recount_requested_at is not null;

-- ---------- who may write to one product ----------

create or replace function public.inventory_can_edit_item(p_item_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_instance uuid;
  v_recount  timestamptz;
begin
  select ii.instance_id, ii.recount_requested_at
    into v_instance, v_recount
    from public.inventory_instance_items ii
   where ii.id = p_item_id;

  if not found then
    return false;
  end if;

  -- Whoever may edit the whole inventory may edit each product of it.
  if public.inventory_can_edit(v_instance) then
    return true;
  end if;

  if v_recount is null or v_uid is null or not public.is_approved() then
    return false;
  end if;

  return exists (
    select 1 from public.inventory_assignments a
     where a.instance_id = v_instance
       and (a.user_id = v_uid or public.covering_for(a.user_id))
  );
end;
$$;

revoke all on function public.inventory_can_edit_item(uuid) from public;
grant execute on function public.inventory_can_edit_item(uuid) to authenticated;

-- The products of one inventory the viewer may recount (for the screen).
create or replace function public.inventory_recount_item_ids(p_instance_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ii.id
    from public.inventory_instance_items ii
   where ii.instance_id = p_instance_id
     and ii.recount_requested_at is not null
     and public.inventory_can_edit_item(ii.id);
$$;

revoke all on function public.inventory_recount_item_ids(uuid) from public;
grant execute on function public.inventory_recount_item_ids(uuid) to authenticated;

-- ---------- entries: per product now ----------

drop policy if exists "inventory_entries: editor inserts" on public.inventory_entries;
drop policy if exists "inventory_entries: editor updates" on public.inventory_entries;
drop policy if exists "inventory_entries: editor deletes" on public.inventory_entries;

create policy "inventory_entries: editor inserts" on public.inventory_entries
  for insert to authenticated
  with check (
    public.inventory_can_edit_item(instance_item_id)
    and created_by = (select auth.uid())
  );

create policy "inventory_entries: editor updates" on public.inventory_entries
  for update to authenticated
  using (public.inventory_can_edit_item(instance_item_id))
  with check (public.inventory_can_edit_item(instance_item_id));

create policy "inventory_entries: editor deletes" on public.inventory_entries
  for delete to authenticated
  using (public.inventory_can_edit_item(instance_item_id));

-- ---------- done / reopen ----------

create or replace function public.inventory_item_set_done(p_item_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_instance  uuid;
  v_before    timestamptz;
  v_date      date;
  v_completed timestamptz;
  v_recount   boolean;
begin
  select ii.instance_id, ii.counted_at, i.inventory_date, i.completed_at
    into v_instance, v_before, v_date, v_completed
    from public.inventory_instance_items ii
    join public.inventory_instances i on i.id = ii.instance_id
   where ii.id = p_item_id
   for update of ii;

  if not found then
    raise exception 'inventory_item_not_found';
  end if;
  if not public.inventory_can_edit_item(p_item_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_done then
    if not exists (
      select 1 from public.inventory_entries e
       where e.instance_item_id = p_item_id and e.quantity is not null
    ) then
      raise exception 'nothing_counted';
    end if;

    -- Counted again: the recount is over and the product locks once more.
    update public.inventory_instance_items
       set counted_at = now(), counted_by = v_uid,
           recount_requested_at = null, recount_requested_by = null, recount_notified_at = null
     where id = p_item_id;
  else
    v_recount := public.has_permission('inventory.manage_instances')
                 and (v_completed is not null or now() > public.inventory_edit_deadline(v_date));

    update public.inventory_instance_items
       set counted_at = null, counted_by = null,
           recount_requested_at = case when v_recount then now() else recount_requested_at end,
           recount_requested_by = case when v_recount then v_uid else recount_requested_by end,
           recount_notified_at  = case when v_recount then null else recount_notified_at end
     where id = p_item_id;
  end if;

  if (v_before is null) = p_done then
    insert into public.inventory_audit_log (instance_id, instance_item_id, actor_id, action, previous_value, new_value)
    values (
      v_instance, p_item_id, v_uid,
      case when p_done then 'item_counted' else 'item_reopened' end,
      jsonb_build_object('counted_at', v_before),
      jsonb_build_object('counted_at', case when p_done then now() end)
    );
  end if;
end;
$$;

revoke all on function public.inventory_item_set_done(uuid, boolean) from public;
grant execute on function public.inventory_item_set_done(uuid, boolean) to authenticated;

-- ---------- the products already reopened this past week ----------
-- Reopened after the inventory closed and not counted again since. Already
-- arranged by hand, so no notice goes out for these.

with last_reopen as (
  select distinct on (l.instance_item_id) l.instance_item_id, l.created_at as at, l.actor_id
    from public.inventory_audit_log l
   where l.action = 'item_reopened' and l.instance_item_id is not null
   order by l.instance_item_id, l.created_at desc
)
update public.inventory_instance_items ii
   set recount_requested_at = r.at,
       recount_requested_by = r.actor_id,
       recount_notified_at  = now()
  from last_reopen r, public.inventory_instances i
 where r.instance_item_id = ii.id
   and i.id = ii.instance_id
   and ii.counted_at is null
   and i.completed_at is not null
   and r.at > i.completed_at
   and i.inventory_date >= date '2026-11-09';
