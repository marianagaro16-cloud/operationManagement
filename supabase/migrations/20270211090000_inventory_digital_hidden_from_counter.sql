-- ============================================================
-- Inventory Digital is out of sight of whoever does the physical count.
--
-- The digital figure can be entered while the count is still going on, so
-- the person counting must never see it — or anything worked out from it:
-- the difference, whether a line is "to review" or "resolved", the digital
-- history, the resolutions. Not while counting, not after closing, not after
-- a reopen. No trace: for them it is a plain count.
--
-- "The counter" of an inventory is anyone assigned to it, holding an active
-- edit grant over it, who wrote a count line in it, marked a product done or
-- closed it. Admins and Owners — who enter the digital figure — always see
-- everything, even on an inventory they counted. Everyone else is unchanged.
--
-- Enforced here, not in the page: the reconciliation columns and the stored
-- status are no longer readable from inventory_instances /
-- inventory_instance_items at all. They come through
-- inventory_review_summary() and inventory_review_items(), which blank them
-- for the counter. The status they then see follows the count alone:
-- in progress until closed, completed after.
--
-- NOTE: SELECT on these two tables is now granted column by column. A column
-- added to either later must be granted to `authenticated` here too, or no
-- one can read it.
-- ============================================================

/* True when the caller did (or is doing) the physical count of this inventory. */
create or replace function public.inventory_digital_hidden(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.is_admin()
     and (
          public.inventory_is_mine(p_instance_id)
       or exists (select 1 from public.inventory_instances i
                   where i.id = p_instance_id and i.completed_by = (select auth.uid()))
       or exists (select 1 from public.inventory_instance_items ii
                   where ii.instance_id = p_instance_id and ii.counted_by = (select auth.uid()))
       or exists (select 1 from public.inventory_entries e
                   where e.instance_id = p_instance_id
                     and (e.created_by = (select auth.uid()) or e.updated_by = (select auth.uid())))
     );
$$;

comment on function public.inventory_digital_hidden(uuid) is
  'True when the caller counts (or counted) this inventory and is not an Admin/Owner: Inventory Digital and everything derived from it is kept from them.';

/* May the caller read this inventory at all? The same rule as its read policy. */
create or replace function public.inventory_readable(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
     and not public.is_external()
     and (not public.inventory_own_only() or public.inventory_is_mine(p_instance_id));
$$;

revoke all on function public.inventory_digital_hidden(uuid) from public;
revoke all on function public.inventory_readable(uuid) from public;
grant execute on function public.inventory_digital_hidden(uuid) to authenticated;
grant execute on function public.inventory_readable(uuid) to authenticated;

-- ---------- the columns that give the digital side away ----------

revoke select on public.inventory_instance_items from authenticated, anon;
grant select (
  id, instance_id, template_item_id, item_name, item_group, item_sort_order, product_id,
  physical_stock, created_at, updated_at, counted_at, counted_by, item_translations
) on public.inventory_instance_items to authenticated;

revoke select on public.inventory_instances from authenticated, anon;
grant select (
  id, template_id, inventory_date, period_key, name_snapshot, kind, digital_enabled,
  completed_at, completed_by, created_at, updated_at, iso_week, iso_year, source
) on public.inventory_instances to authenticated;

-- ---------- what the app reads instead ----------

/* Per inventory: its status and review counts, as the caller may see them. */
create or replace function public.inventory_review_summary(p_instance_ids uuid[])
returns table (
  instance_id           uuid,
  status                public.inventory_status,
  digital_hidden        boolean,
  item_count            int,
  review_count          int,
  resolved_count        int,
  digital_pending_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select i.id, i.status, i.completed_at, i.digital_enabled,
           public.inventory_digital_hidden(i.id) as hidden
      from public.inventory_instances i
     where i.id = any (p_instance_ids)
       and public.inventory_readable(i.id)
  )
  select v.id,
         case when v.hidden
              then (case when v.completed_at is null then 'in_progress' else 'completed' end)::public.inventory_status
              else v.status end,
         v.hidden,
         (select count(*)::int from public.inventory_instance_items ii where ii.instance_id = v.id),
         case when v.hidden then 0 else
           (select count(*)::int from public.inventory_instance_items ii
             where ii.instance_id = v.id and ii.status = 'to_review') end,
         case when v.hidden then 0 else
           (select count(*)::int from public.inventory_instance_items ii
             where ii.instance_id = v.id and ii.is_resolved) end,
         case when v.hidden or not v.digital_enabled then 0 else
           (select count(*)::int from public.inventory_instance_items ii
             where ii.instance_id = v.id and ii.digital_quantity is null) end
    from v;
$$;

/* Per product line of one inventory: the reconciliation side, blank for the counter. */
create or replace function public.inventory_review_items(p_instance_id uuid)
returns table (
  item_id          uuid,
  status           public.inventory_status,
  digital_quantity int,
  difference       int,
  is_resolved      boolean,
  resolved_at      timestamptz,
  resolved_by      uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select public.inventory_digital_hidden(p_instance_id) as hidden,
           (select completed_at from public.inventory_instances where id = p_instance_id) as completed_at
  )
  select ii.id,
         case when h.hidden
              then (case when h.completed_at is null then 'in_progress' else 'completed' end)::public.inventory_status
              else ii.status end,
         case when h.hidden then null else ii.digital_quantity end,
         case when h.hidden then null else ii.difference end,
         case when h.hidden then false else ii.is_resolved end,
         case when h.hidden then null else ii.resolved_at end,
         case when h.hidden then null else ii.resolved_by end
    from public.inventory_instance_items ii, h
   where ii.instance_id = p_instance_id
     and public.inventory_readable(p_instance_id);
$$;

/*
 * One page of the inventory list filtered by status — the status as the
 * caller sees it, so a counter filtering "to review" finds nothing of theirs.
 * Only used when the list is filtered by status; otherwise the list reads the
 * table directly.
 */
create or replace function public.inventory_ids_by_status(
  p_status        public.inventory_status,
  p_template_id   uuid default null,
  p_iso_week      int default null,
  p_iso_year      int default null,
  p_from          date default null,
  p_to            date default null,
  p_assigned_user uuid default null,
  p_limit         int default 25,
  p_offset        int default 0
)
returns table (id uuid, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select i.id, i.inventory_date,
           case when public.inventory_digital_hidden(i.id)
                then (case when i.completed_at is null then 'in_progress' else 'completed' end)::public.inventory_status
                else i.status end as shown
      from public.inventory_instances i
     where public.inventory_readable(i.id)
       and (p_template_id is null or i.template_id = p_template_id)
       and (p_iso_week is null or i.iso_week = p_iso_week)
       and (p_iso_year is null or i.iso_year = p_iso_year)
       and (p_from is null or i.inventory_date >= p_from)
       and (p_to is null or i.inventory_date <= p_to)
       and (p_assigned_user is null or exists (
             select 1 from public.inventory_assignments a
              where a.instance_id = i.id and a.user_id = p_assigned_user))
  ), m as (
    select v.id, v.inventory_date, count(*) over () as total from v where v.shown = p_status
  )
  select m.id, m.total from m
   order by m.inventory_date desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.inventory_review_summary(uuid[]) from public;
revoke all on function public.inventory_review_items(uuid) from public;
revoke all on function public.inventory_ids_by_status(public.inventory_status, uuid, int, int, date, date, uuid, int, int) from public;
grant execute on function public.inventory_review_summary(uuid[]) to authenticated;
grant execute on function public.inventory_review_items(uuid) to authenticated;
grant execute on function public.inventory_ids_by_status(public.inventory_status, uuid, int, int, date, date, uuid, int, int) to authenticated;

-- ---------- digital history, resolutions and the audit log ----------

drop policy if exists "inventory_digital_history: approved read" on public.inventory_digital_history;
create policy "inventory_digital_history: approved read" on public.inventory_digital_history
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id))
         and not public.inventory_digital_hidden(instance_id));

drop policy if exists "inventory_resolutions: approved read" on public.inventory_resolutions;
create policy "inventory_resolutions: approved read" on public.inventory_resolutions
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id))
         and not public.inventory_digital_hidden(instance_id));

-- The audit log records digital values and status changes; a manager who
-- counted an inventory does not read its log.
drop policy if exists "inventory_audit_log: not for the counter" on public.inventory_audit_log;
create policy "inventory_audit_log: not for the counter" on public.inventory_audit_log
  as restrictive for SELECT to authenticated
  using (instance_id is null or not public.inventory_digital_hidden(instance_id));

-- ---------- closing and reopening hand back the row: mask it too ----------

create or replace function public.inventory_complete(p_instance_id uuid)
returns public.inventory_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_instances;
  v_open integer;
begin
  if not public.inventory_can_edit(p_instance_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select count(*) into v_open
    from public.inventory_instance_items
   where instance_id = p_instance_id
     and counted_at is null;

  if v_open > 0 then
    -- The count travels in the message so the screen can say "3 products
    -- are not done yet" rather than a bare refusal.
    raise exception 'items_not_done:%', v_open using errcode = 'P0001';
  end if;

  update public.inventory_instances
     set completed_at = now(),
         completed_by = (select auth.uid())
   where id = p_instance_id
     and completed_at is null
   returning * into v_row;

  if not found then
    raise exception 'inventory_already_completed' using errcode = '23505';
  end if;

  -- Re-derive every item now that the instance is closed: on a template with
  -- Inventory Digital disabled, completion is what moves items to Completed.
  update public.inventory_instance_items
     set updated_at = now()
   where instance_id = p_instance_id;

  perform public.inventory_sync_instance_status(p_instance_id);

  select * into v_row from public.inventory_instances where id = p_instance_id;
  -- Whoever closes a count is its counter: the stored status may already
  -- carry the comparison with Inventory Digital.
  if public.inventory_digital_hidden(p_instance_id) then
    v_row.status := 'completed';
  end if;
  return v_row;
end;
$$;

create or replace function public.inventory_reopen(p_instance_id uuid)
returns public.inventory_instances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_instances;
begin
  if not public.has_permission('inventory.manage_instances') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.inventory_instances
     set completed_at = null, completed_by = null
   where id = p_instance_id
   returning * into v_row;

  if not found then
    raise exception 'inventory_not_found' using errcode = 'P0002';
  end if;

  update public.inventory_instance_items set updated_at = now() where instance_id = p_instance_id;
  perform public.inventory_sync_instance_status(p_instance_id);

  select * into v_row from public.inventory_instances where id = p_instance_id;
  if public.inventory_digital_hidden(p_instance_id) then
    v_row.status := 'in_progress';
  end if;
  return v_row;
end;
$$;
