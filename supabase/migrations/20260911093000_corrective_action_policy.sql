-- ============================================================
-- A corrective action is a task a Power User may raise.
--
-- 20260911090100 made corrective actions real tasks, which is what §17 and
-- §34 require. It did not notice that writing to public.tasks needs
-- `tasks.manage_definitions` — a MANAGER capability that a Power User
-- deliberately does not hold, because a Power User has no business inventing
-- recurring operational definitions.
--
-- So the module shipped with a Power User able to investigate an incident,
-- resolve it, and not raise the corrective action that would stop it
-- happening again. §20 says they must be able to. `verify-incidents.mjs`
-- caught it.
--
-- THE FIX IS A NARROW SECOND PATH, not a widening of the first.
--
-- Postgres ORs permissive policies together, so this adds one specific
-- permission without touching what `tasks: config writes` already grants. It
-- is deliberately hemmed in on three sides at once:
--
--   frequency = 'one_off'      — cannot create a recurring definition
--   incident_id is not null    — cannot create a free-standing task
--   has_permission('incidents.manage')
--
-- A Power User therefore gains exactly "raise a corrective action for an
-- incident" and nothing adjacent to it. They still cannot add a weekly task,
-- still cannot edit one, and still cannot detach a corrective action from the
-- incident that justifies its existence.
-- ============================================================

create policy "tasks: corrective actions" on public.tasks
  for insert to authenticated
  with check (
    public.has_permission('incidents.manage')
    and frequency = 'one_off'
    and incident_id is not null
  );

/*
 * Editing one, under the same three constraints.
 *
 * USING and WITH CHECK both carry them, so the row must be a corrective
 * action before the edit AND after it — without the WITH CHECK, an UPDATE
 * could turn a corrective action into a weekly definition, which is the
 * escalation this policy exists to prevent.
 *
 * No DELETE: a corrective action that was raised and then judged unnecessary
 * is deactivated, exactly as every other task in this system is. Soft
 * deletion only — occurrence history must survive.
 */
create policy "tasks: correct corrective actions" on public.tasks
  for update to authenticated
  using (
    public.has_permission('incidents.manage')
    and frequency = 'one_off'
    and incident_id is not null
  )
  with check (
    public.has_permission('incidents.manage')
    and frequency = 'one_off'
    and incident_id is not null
  );

comment on policy "tasks: corrective actions" on public.tasks is
  'Lets a holder of incidents.manage raise a ONE-OFF task attached to an incident, without granting the recurring-definition authority that tasks.manage_definitions carries.';
