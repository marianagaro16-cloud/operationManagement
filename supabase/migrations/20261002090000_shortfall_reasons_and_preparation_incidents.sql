-- ============================================================
-- Shortfalls: a reason from a list, a product that is not sent at all, and
-- an incident raised from the preparation itself.
--
-- Three things the floor could not do:
--
--   1. Leave a product out. A reason could only be written once at least one
--      lot was recorded, so a product with no stock at all could not be
--      explained, the order could never be marked Ready, and it could never
--      ship. An explained line with nothing allocated now counts as accounted
--      for — "not sent, because…" is a finished answer.
--
--   2. Say why in a way that can be counted. The reason was free text only.
--      It is now a code from a short fixed list, plus an optional note
--      (required for 'other'). The old free-text column stays as that note,
--      so every reason written so far still reads and still counts.
--
--   3. Report it. A plain USER may not create an incident — by the incident
--      module's explicit design — so a missing product only reached the
--      incident log if a manager noticed it. The person preparing may now
--      raise ONE incident per short line, pre-filled from the order, through
--      set_line_shortfall(). Nothing else is widened: the insert and update
--      policies on incidents are untouched, so investigating, editing and
--      resolving still need incidents.manage. The reporter sees what they
--      reported, and nothing more.
-- ============================================================

alter table public.order_lines
  add column shortfall_code text
    constraint order_lines_shortfall_code_check
    check (shortfall_code in ('no_stock', 'damaged', 'short_shelf_life', 'quality_hold', 'other')),
  add column shortfall_incident_id uuid
    references public.incidents (id) on delete set null;

create index order_lines_shortfall_incident_idx on public.order_lines (shortfall_incident_id)
  where shortfall_incident_id is not null;

comment on column public.order_lines.shortfall_code is
  'Why the line was prepared short or not sent. Written only by set_line_shortfall(). NULL on lines explained before codes existed; their shortfall_reason text still counts.';
comment on column public.order_lines.shortfall_reason is
  'Free-text note on the shortfall. On its own (no code) it is a reason written before codes existed.';
comment on column public.order_lines.shortfall_incident_id is
  'The incident raised from preparation about this shortfall, if one was.';

-- ---------- what "prepared" means ----------

/*
 * Every line accounted for — fully allocated (or over), or short with a
 * reason, INCLUDING a line with nothing allocated — and at least one lot on
 * the order. An order with every product left out is not prepared: nothing
 * would leave, and that is a cancellation or a new date, not a shipment.
 *
 * The same rule as src/domain/orders/progress.ts (isPrepared).
 */
create or replace function public.order_is_prepared(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with line_state as (
    select l.id,
           l.ordered_quantity,
           l.shortfall_code is not null
             or nullif(btrim(coalesce(l.shortfall_reason, '')), '') is not null as explained,
           (select coalesce(sum(a.quantity), 0)
              from public.lot_allocations a
             where a.order_line_id = l.id) as allocated
      from public.order_lines l
     where l.order_id = p_order_id
  )
  select exists (select 1 from line_state where allocated > 0)
     and not exists (
       select 1 from line_state
        where not (allocated >= ordered_quantity or explained)
     );
$$;

-- ---------- recording the shortfall ----------

/*
 * Record why a line is short, optionally raising an incident about it.
 *
 * p_code NULL clears the reason (a lot turned up after all). Otherwise the
 * code must be one of the list, and 'other' needs a note.
 *
 * p_report_incident creates a 'missing_product' incident on the order, with
 * this product and the missing quantity as its affected item, and links it
 * to the line. At most one per line: asking again once one exists does not
 * create a second. p_incident_description is written by the client in the
 * reporter's language, from the same reason and note.
 *
 * SECURITY DEFINER because a plain user may neither write order_lines nor
 * insert incidents directly. The ready lock still applies — its trigger fires
 * here as everywhere.
 *
 * Returns the linked incident, if any: { incident_id, incident_number }.
 */
create or replace function public.set_line_shortfall(
  p_order_line_id        uuid,
  p_code                 text,
  p_note                 text,
  p_report_incident      boolean default false,
  p_incident_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_line      public.order_lines;
  v_order     public.orders;
  v_allocated numeric;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_type_id   uuid;
  v_incident  public.incidents;
begin
  if v_uid is null or not public.is_approved() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_line from public.order_lines where id = p_order_line_id for update;
  if not found then raise exception 'order_line_not_found' using errcode = 'P0002'; end if;

  select * into v_order from public.orders where id = v_line.order_id;
  if v_order.status <> 'confirmed' then raise exception 'order_not_confirmed'; end if;
  if v_order.ready_at is not null then raise exception 'order_ready_locked'; end if;

  if p_code is null then
    if p_report_incident then raise exception 'reason_required' using errcode = '22023'; end if;
    update public.order_lines
       set shortfall_code = null, shortfall_reason = null
     where id = p_order_line_id;
    return case when v_line.shortfall_incident_id is null then null else
      (select jsonb_build_object('incident_id', i.id, 'incident_number', i.incident_number)
         from public.incidents i where i.id = v_line.shortfall_incident_id) end;
  end if;

  if p_code not in ('no_stock', 'damaged', 'short_shelf_life', 'quality_hold', 'other') then
    raise exception 'invalid_shortfall_code' using errcode = '22023';
  end if;
  if p_code = 'other' and v_note is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select coalesce(sum(quantity), 0) into v_allocated
    from public.lot_allocations where order_line_id = p_order_line_id;
  if v_allocated >= v_line.ordered_quantity then
    raise exception 'line_not_short' using errcode = '22023';
  end if;

  update public.order_lines
     set shortfall_code = p_code, shortfall_reason = v_note
   where id = p_order_line_id;

  if p_report_incident and v_line.shortfall_incident_id is null then
    if nullif(btrim(coalesce(p_incident_description, '')), '') is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;

    select id into v_type_id from public.incident_types where slug = 'missing_product';
    if v_type_id is null then raise exception 'incident_type_missing'; end if;

    insert into public.incidents
      (customer_id, order_id, delivery_method_id, incident_type_id, description,
       created_by, updated_by)
    values
      (v_order.customer_id, v_order.id, v_order.delivery_method_id, v_type_id,
       btrim(p_incident_description), v_uid, v_uid)
    returning * into v_incident;

    insert into public.incident_affected_items
      (incident_id, product_id, order_line_id, affected_quantity, note)
    values
      (v_incident.id, v_line.product_id, v_line.id,
       v_line.ordered_quantity - v_allocated, v_note);

    update public.order_lines
       set shortfall_incident_id = v_incident.id
     where id = p_order_line_id;

    return jsonb_build_object('incident_id', v_incident.id, 'incident_number', v_incident.incident_number);
  end if;

  return case when v_line.shortfall_incident_id is null then null else
    (select jsonb_build_object('incident_id', i.id, 'incident_number', i.incident_number)
       from public.incidents i where i.id = v_line.shortfall_incident_id) end;
end;
$$;

revoke all on function public.set_line_shortfall(uuid, text, text, boolean, text) from public;
grant execute on function public.set_line_shortfall(uuid, text, text, boolean, text) to authenticated;

-- set_line_shortfall_reason(uuid, text) is kept as it was: the running app
-- calls it until the new build is deployed, and a free-text reason still
-- counts as an explanation.

-- ---------- the reporter sees what they reported ----------

/*
 * A third arity, for the same reason the reception one was a second: the
 * existing signatures stay exactly as they are. Somebody who raised an
 * incident from preparation may have recorded no lot on that order (the line
 * they explained had none), so the prepared-it rule alone would hide their
 * own report from them.
 */
create or replace function public.can_view_incident(
  p_order_id uuid, p_goods_reception_id uuid, p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_incident(p_order_id, p_goods_reception_id)
      or (p_created_by is not null
          and p_created_by = (select auth.uid())
          and public.is_approved());
$$;

comment on function public.can_view_incident(uuid, uuid, uuid) is
  'Incident visibility including the reporter: whoever created an incident may read it.';

drop policy if exists "incidents: scoped read"             on public.incidents;
drop policy if exists "incident_items: scoped read"        on public.incident_affected_items;
drop policy if exists "incident_causes: scoped read"       on public.incident_secondary_causes;
drop policy if exists "incident_evidence: scoped read"     on public.incident_evidence;
drop policy if exists "incident_replacements: scoped read" on public.incident_replacements;
drop policy if exists "incident evidence: scoped read"     on storage.objects;

create policy "incidents: scoped read" on public.incidents
  for select to authenticated
  using (public.can_view_incident(order_id, goods_reception_id, created_by));

create policy "incident_items: scoped read" on public.incident_affected_items
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id, i.created_by))
  );

create policy "incident_causes: scoped read" on public.incident_secondary_causes
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id, i.created_by))
  );

create policy "incident_evidence: scoped read" on public.incident_evidence
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id, i.created_by))
  );

create policy "incident_replacements: scoped read" on public.incident_replacements
  for select to authenticated using (
    exists (select 1 from public.incidents i
             where i.id = incident_id
               and public.can_view_incident(i.order_id, i.goods_reception_id, i.created_by))
  );

create policy "incident evidence: scoped read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-evidence'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and exists (
      select 1 from public.incidents i
       where i.id = ((storage.foldername(name))[1])::uuid
         and public.can_view_incident(i.order_id, i.goods_reception_id, i.created_by)
    )
  );
