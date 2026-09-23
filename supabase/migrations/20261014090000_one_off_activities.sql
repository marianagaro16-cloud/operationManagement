-- ============================================================
-- One-off activities, placed from the calendar.
--
-- Every activity until now was a RECURRING definition: daily materialises
-- itself, the rest are put on dates by hand. Work that happens once and is
-- then finished had nowhere to live — "paint the cold room on Thursday" was
-- either invented as a recurring task nobody wanted back, or written down
-- outside the system.
--
-- The 'one_off' frequency already exists: an incident's corrective action is
-- one. What is new is that whoever PLANS work (tasks.manage_occurrences —
-- Manager, Power User, Production manager, Admin) may create one directly,
-- without holding tasks.manage_definitions, which governs the recurring
-- catalogue and stays where it is.
--
-- Narrow on purpose: only a one-off, and never one attached to an incident —
-- a corrective action is raised from its incident and nowhere else.
-- ============================================================

create policy "tasks: one-off planning" on public.tasks
  for insert to authenticated
  with check (
    frequency = 'one_off'
    and incident_id is null
    and (select public.has_permission('tasks.manage_occurrences'))
  );

/*
 * Taking a one-off off the calendar removes the activity itself: its
 * definition exists only to carry that single occurrence, so leaving it
 * behind would slowly fill the catalogue with rows nobody can see or reach.
 * A corrective action is again excluded — the incident owns it.
 */
create policy "tasks: one-off cleanup" on public.tasks
  for delete to authenticated
  using (
    frequency = 'one_off'
    and incident_id is null
    and (select public.has_permission('tasks.manage_occurrences'))
  );
