-- ============================================================
-- How many to make, per day (decided 2026-10-01).
--
-- A production order has its usual quantity; whoever plans work can set a
-- different one for a single day of it. Recording measures against that day's.
-- ============================================================

alter table public.task_occurrences
  add column target_quantity numeric(12, 3) check (target_quantity is null or target_quantity > 0);

/* That day's quantity — or back to the usual one with null. Planners only, while still to do. */
create or replace function public.set_production_target(p_occurrence_id uuid, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o public.task_occurrences%rowtype;
begin
  if not public.has_permission('tasks.manage_occurrences') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_o from public.task_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.tasks t where t.id = v_o.task_id and t.product_id is not null) then
    raise exception 'not_production' using errcode = '22023';
  end if;
  if v_o.status <> 'pending' then
    raise exception 'already_recorded' using errcode = '22023';
  end if;
  if p_quantity is not null and p_quantity <= 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  update public.task_occurrences set target_quantity = p_quantity where id = p_occurrence_id;
end;
$$;

revoke all on function public.set_production_target(uuid, numeric) from public, anon;
grant execute on function public.set_production_target(uuid, numeric) to authenticated;

/* Recording measures against the day's quantity, or the usual one. */
create or replace function public.record_production(
  p_occurrence_id uuid,
  p_produced      numeric,
  p_lot           text,
  p_best_before   date,
  p_reason        text,
  p_note          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      public.task_occurrences%rowtype;
  v_t      public.tasks%rowtype;
  v_target numeric;
begin
  if not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_o from public.task_occurrences where id = p_occurrence_id for update;
  if not found then
    raise exception 'occurrence_not_found' using errcode = 'P0002';
  end if;
  select * into v_t from public.tasks where id = v_o.task_id;
  if v_t.product_id is null then
    raise exception 'not_production' using errcode = '22023';
  end if;
  if not (public.can_act_on_task_occurrence(v_o.task_id, v_o.assignee_id) or public.has_permission('tasks.manage_occurrences')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_target := coalesce(v_o.target_quantity, v_t.target_quantity);
  if p_produced is null or p_produced < 0 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if p_produced > 0 and nullif(btrim(coalesce(p_lot, '')), '') is null then
    raise exception 'lot_required' using errcode = '22023';
  end if;
  if p_produced < v_target and p_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  insert into public.production_records
    (occurrence_id, product_id, target_quantity, produced_quantity, lot_number, best_before, shortfall_reason, shortfall_note, recorded_by, recorded_at)
  values
    (p_occurrence_id, v_t.product_id, v_target, p_produced, nullif(btrim(coalesce(p_lot, '')), ''), p_best_before,
     case when p_produced < v_target then p_reason end,
     nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()), now())
  on conflict (occurrence_id) do update set
    target_quantity   = excluded.target_quantity,
    produced_quantity = excluded.produced_quantity,
    lot_number        = excluded.lot_number,
    best_before       = excluded.best_before,
    shortfall_reason  = excluded.shortfall_reason,
    shortfall_note    = excluded.shortfall_note,
    recorded_by       = excluded.recorded_by,
    recorded_at       = excluded.recorded_at;

  update public.task_occurrences
     set status = 'completed', completed_by = (select auth.uid()), completed_at = now(),
         skipped_by = null, skipped_at = null, skip_reason = null
   where id = p_occurrence_id;
end;
$$;
