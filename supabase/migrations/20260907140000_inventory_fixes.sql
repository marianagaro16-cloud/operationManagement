-- ============================================================
-- Inventory module: two corrections found by end-to-end verification
-- against a real database (scripts/verify-inventory.mjs).
--
-- Structural only. No data is created, changed or removed.
-- ============================================================

-- ============================================================
-- 1. A grant meant to start "now" must not be dead for a second
--
-- The admin UI defaults the start time to the browser's clock. A browser
-- running even a second ahead of the database produced a grant whose
-- starts_at was briefly in the future, so `now() >= starts_at` was false and
-- the user it was just issued to still could not edit. Measured skew on a
-- normal laptop was 1.1 seconds — small enough never to be suspected, large
-- enough to make the feature look broken.
--
-- The database clock is the only one that matters here, so a start time
-- within a minute of it in either direction is treated as "now". A window
-- deliberately scheduled for later today is left exactly as the admin set it.
-- ============================================================
create or replace function public.inventory_grant_edit(
  p_user_id     uuid,
  p_scope       public.inventory_grant_scope,
  p_instance_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reason      text default null
)
returns public.inventory_edit_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.inventory_edit_grants;
  v_start timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  -- "Now" according to the database, not according to the client.
  v_start := case
    when p_starts_at between now() - interval '1 minute' and now() + interval '1 minute'
      then now()
    else p_starts_at
  end;

  -- Clamping the start forward must not swallow the whole window.
  if p_ends_at <= v_start then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  -- Checked here as well as in the trigger so the caller gets a specific,
  -- translatable error rather than a raw exception from a trigger.
  if (v_start at time zone 'Europe/Zurich')::date
     <> (p_ends_at at time zone 'Europe/Zurich')::date then
    raise exception 'grant_spans_multiple_days' using errcode = '22023';
  end if;

  insert into public.inventory_edit_grants (
    user_id, scope, instance_id, starts_at, ends_at, reason, granted_by
  ) values (
    p_user_id, p_scope,
    case when p_scope = 'instance' then p_instance_id else null end,
    v_start, p_ends_at, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.inventory_grant_edit(uuid, public.inventory_grant_scope, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.inventory_grant_edit(uuid, public.inventory_grant_scope, uuid, timestamptz, timestamptz, text) to authenticated;

-- ============================================================
-- 2. Audit triggers must not resurrect a deleted inventory
--
-- inventory_audit_log.instance_id is ON DELETE CASCADE, so an inventory's
-- audit rows go when the inventory does. But deleting an inventory cascades
-- to its entries and assignments, whose AFTER DELETE triggers then tried to
-- INSERT a fresh audit row pointing at the parent that had just been removed
-- — a foreign key violation that made an inventory undeletable, with an error
-- naming a table the admin never touched.
--
-- The fix is to log nothing once the subject is gone. That is also the right
-- semantics: there is no inventory left for the entry to be audited against.
--
-- This does NOT make history disposable. Nothing in the module ever deletes
-- an inventory; an admin doing so deliberately is the only path, and it stays
-- admin-only through RLS.
-- ============================================================
create or replace function public.inventory_instance_exists(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.inventory_instances where id = p_instance_id);
$$;

create or replace function public.inventory_audit_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  public.inventory_entries;
  v_prev jsonb;
  v_next jsonb;
begin
  if TG_OP = 'DELETE' then
    v_row  := old;
    v_prev := jsonb_build_object('quantity', old.quantity, 'expiry_date', old.expiry_date,
                                 'lot_number', old.lot_number, 'location_name', old.location_name,
                                 'note', old.note);
    v_next := null;
  elsif TG_OP = 'UPDATE' then
    v_row  := new;
    v_prev := jsonb_build_object('quantity', old.quantity, 'expiry_date', old.expiry_date,
                                 'lot_number', old.lot_number, 'location_name', old.location_name,
                                 'note', old.note);
    v_next := jsonb_build_object('quantity', new.quantity, 'expiry_date', new.expiry_date,
                                 'lot_number', new.lot_number, 'location_name', new.location_name,
                                 'note', new.note);
  else
    v_row  := new;
    v_prev := null;
    v_next := jsonb_build_object('quantity', new.quantity, 'expiry_date', new.expiry_date,
                                 'lot_number', new.lot_number, 'location_name', new.location_name,
                                 'note', new.note);
  end if;

  -- The inventory is already gone (this delete is a cascade from it): there
  -- is nothing left to attach the record to.
  if not public.inventory_instance_exists(v_row.instance_id) then
    return null;
  end if;

  insert into public.inventory_audit_log (
    instance_id, instance_item_id, entry_id, actor_id, action, previous_value, new_value
  )
  values (
    v_row.instance_id, v_row.instance_item_id, v_row.id,
    (select auth.uid()), 'entry_' || lower(TG_OP), v_prev, v_next
  );
  return null;
end;
$$;

create or replace function public.inventory_audit_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_assignments;
begin
  if TG_OP = 'DELETE' then v_row := old; else v_row := new; end if;

  if not public.inventory_instance_exists(v_row.instance_id) then
    return null;
  end if;

  insert into public.inventory_audit_log (instance_id, actor_id, action, new_value)
  values (
    v_row.instance_id, (select auth.uid()),
    case when TG_OP = 'DELETE' then 'assignment_removed' else 'inventory_assigned' end,
    jsonb_build_object('user_id', v_row.user_id)
  );
  return null;
end;
$$;

create or replace function public.inventory_audit_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and public.inventory_instance_exists(new.instance_id) then
    insert into public.inventory_audit_log (
      instance_id, instance_item_id, actor_id, action, previous_value, new_value
    ) values (
      new.instance_id, new.id, (select auth.uid()), 'item_status_changed',
      to_jsonb(old.status), to_jsonb(new.status)
    );
  end if;
  return null;
end;
$$;
