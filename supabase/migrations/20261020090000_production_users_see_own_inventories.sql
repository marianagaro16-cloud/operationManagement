-- ============================================================
-- A User on the Production team sees only the inventories they count.
--
-- Until now every approved person read every inventory. For a plain User on
-- Production that is now narrowed to:
--   * the inventories they are ASSIGNED to (past ones included), plus any
--     they hold an active temporary edit grant for — a manager who hands
--     someone a grant means them to work on it, and they cannot without
--     seeing it;
--   * inside such an inventory, everything as before: every count line with
--     who counted it, and every comment;
--   * but not WHO ELSE is assigned — neither on an inventory nor as a
--     template's default counter. They see only their own assignment.
--
-- Everyone else — Operations users and every other role — is unchanged.
-- Enforced here rather than by hiding rows in the page, so the calendar,
-- reminder links and every other read path follow automatically.
-- ============================================================

/* True when the caller is an approved plain User on the Production team. */
create or replace function public.inventory_own_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.status = 'approved'
       and p.role = 'user'
       and p.team = 'production'
  );
$$;

comment on function public.inventory_own_only() is
  'True for a plain User on the Production team, who sees only the inventories assigned (or temporarily granted) to them.';

/* May an own-only caller see this inventory? Assigned, or an active edit grant covers it. */
create or replace function public.inventory_is_mine(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.inventory_assignments a
            where a.instance_id = p_instance_id
              and a.user_id = (select auth.uid())
         )
      or exists (
           select 1 from public.inventory_edit_grants g
            where g.user_id = (select auth.uid())
              and g.revoked_at is null
              and now() >= g.starts_at
              and now() <= g.ends_at
              and (g.scope = 'all' or g.instance_id = p_instance_id)
         );
$$;

revoke all on function public.inventory_own_only() from public;
revoke all on function public.inventory_is_mine(uuid) from public;
grant execute on function public.inventory_own_only() to authenticated;
grant execute on function public.inventory_is_mine(uuid) to authenticated;

-- ---------- the inventory itself and everything inside it ----------

drop policy if exists "inventory_instances: approved read" on public.inventory_instances;
create policy "inventory_instances: approved read" on public.inventory_instances
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(id)));

drop policy if exists "inventory_instance_items: approved read" on public.inventory_instance_items;
create policy "inventory_instance_items: approved read" on public.inventory_instance_items
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id)));

drop policy if exists "inventory_entries: approved read" on public.inventory_entries;
create policy "inventory_entries: approved read" on public.inventory_entries
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id)));

drop policy if exists "inventory_comments: approved read" on public.inventory_comments;
create policy "inventory_comments: approved read" on public.inventory_comments
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id)));

drop policy if exists "inventory_resolutions: approved read" on public.inventory_resolutions;
create policy "inventory_resolutions: approved read" on public.inventory_resolutions
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id)));

drop policy if exists "inventory_digital_history: approved read" on public.inventory_digital_history;
create policy "inventory_digital_history: approved read" on public.inventory_digital_history
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or public.inventory_is_mine(instance_id)));

-- ---------- who is assigned: only their own row ----------

drop policy if exists "inventory_assignments: approved read" on public.inventory_assignments;
create policy "inventory_assignments: approved read" on public.inventory_assignments
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or user_id = (select auth.uid())));

drop policy if exists "inventory_template_assignees: approved read" on public.inventory_template_assignees;
create policy "inventory_template_assignees: approved read" on public.inventory_template_assignees
  for SELECT to authenticated
  using ((select public.is_approved())
         and (not (select public.inventory_own_only()) or user_id = (select auth.uid())));
