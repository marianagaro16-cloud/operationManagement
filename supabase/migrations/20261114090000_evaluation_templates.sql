-- ============================================================
-- Evaluation templates: criteria for a job, not only for a team.
--
-- A team's criteria are its general ones — every operator of Production is
-- rated on them. A template is a named set for a particular job, of that
-- team: "Encargado de turno de producción" is rated on its own 22 criteria,
-- not on the general ones. When evaluating, one chooses General or a
-- template; a sent evaluation can tick a template's criteria like any.
--
--   hr_eval_templates     Admin's list, in three languages.
--   hr_criteria.template_id  null for a team's general criteria.
-- ============================================================

create table public.hr_eval_templates (
  id           uuid primary key default gen_random_uuid(),
  team         public.team not null,
  name         text not null check (length(btrim(name)) > 0),
  translations jsonb not null default '{}'::jsonb,
  sort_order   int not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger hr_eval_templates_set_updated_at before update on public.hr_eval_templates
  for each row execute function public.set_updated_at();

alter table public.hr_eval_templates enable row level security;
create policy "hr_eval_templates: read" on public.hr_eval_templates
  for select to authenticated using ((select public.has_permission('hr.manage')));
create policy "hr_eval_templates: admin writes" on public.hr_eval_templates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

alter table public.hr_criteria
  add column template_id uuid references public.hr_eval_templates (id) on delete restrict;

create index hr_criteria_template_idx on public.hr_criteria (template_id);

-- ---------- Encargado de turno de producción ----------

with t as (
  insert into public.hr_eval_templates (team, name, translations, sort_order)
  values ('production', 'Encargado de turno de producción',
          '{"de": {"name": "Schichtleiter Produktion"}, "en": {"name": "Production shift lead"}}', 10)
  returning id
)
insert into public.hr_criteria (team, template_id, name, description, translations, sort_order)
select 'production', t.id, c.name, c.description, c.translations::jsonb, c.sort_order
  from t, (values
  (10, 'Cumplimiento del plan de producción', 'Cumplimiento del plan de producción del turno (% real vs. programado).',
   '{"de": {"name": "Erfüllung des Produktionsplans", "description": "Erfüllung des Produktionsplans der Schicht (% Ist vs. Soll)."}, "en": {"name": "Meeting the production plan", "description": "Meeting the shift''s production plan (% actual vs. planned)."}}'),
  (20, 'Rendimiento de materia prima (yield)', 'Kg de producto obtenido vs. kg de insumo usado.',
   '{"de": {"name": "Rohstoffausbeute (Yield)", "description": "Kg gewonnenes Produkt vs. kg eingesetzter Rohstoff."}, "en": {"name": "Raw material yield", "description": "Kg of product obtained vs. kg of input used."}}'),
  (30, 'Mermas y desperdicios', 'Mermas y desperdicios generados en el turno (%).',
   '{"de": {"name": "Ausschuss und Abfall", "description": "In der Schicht entstandener Ausschuss und Abfall (%)."}, "en": {"name": "Waste and scrap", "description": "Waste and scrap generated in the shift (%)."}}'),
  (40, 'Paradas no programadas', 'Tiempo de paradas no programadas.',
   '{"de": {"name": "Ungeplante Stillstände", "description": "Dauer ungeplanter Stillstände."}, "en": {"name": "Unplanned stoppages", "description": "Time lost to unplanned stoppages."}}'),
  (50, 'Arranque, cierre y cambios de formato', 'Tiempo de arranque, cierre y cambio de formato/producto.',
   '{"de": {"name": "Anlauf, Abschluss und Formatwechsel", "description": "Zeit für Anlauf, Abschluss und Format-/Produktwechsel."}, "en": {"name": "Start-up, close and changeovers", "description": "Time for start-up, close and format/product changeovers."}}'),
  (60, 'Cumplimiento de BPM', 'Buenas Prácticas de Manufactura.',
   '{"de": {"name": "Einhaltung der GMP", "description": "Gute Herstellungspraxis."}, "en": {"name": "GMP compliance", "description": "Good Manufacturing Practices."}}'),
  (70, 'Cumplimiento de POES', 'Limpieza y saneamiento antes y después del turno.',
   '{"de": {"name": "Einhaltung der Reinigungsverfahren (SSOP)", "description": "Reinigung und Desinfektion vor und nach der Schicht."}, "en": {"name": "SSOP compliance", "description": "Cleaning and sanitation before and after the shift."}}'),
  (80, 'Puntos críticos de control HACCP', 'Cumplimiento de los puntos críticos de control HACCP.',
   '{"de": {"name": "HACCP-Kontrollpunkte", "description": "Einhaltung der kritischen HACCP-Kontrollpunkte."}, "en": {"name": "HACCP critical control points", "description": "Compliance with the HACCP critical control points."}}'),
  (90, 'Detección, solución y escalamiento de desviaciones', 'Detecta y soluciona las no conformidades durante el turno, y escala a tiempo las desviaciones de calidad, seguridad o producción.',
   '{"de": {"name": "Erkennen, Lösen und Eskalieren von Abweichungen", "description": "Erkennt und behebt Nichtkonformitäten in der Schicht und eskaliert Abweichungen bei Qualität, Sicherheit oder Produktion rechtzeitig."}, "en": {"name": "Detecting, solving and escalating deviations", "description": "Detects and solves non-conformities during the shift, and escalates quality, safety or production deviations in time."}}'),
  (100, 'Trazabilidad de lotes', 'Trazabilidad correcta de los lotes producidos.',
   '{"de": {"name": "Rückverfolgbarkeit der Chargen", "description": "Korrekte Rückverfolgbarkeit der produzierten Chargen."}, "en": {"name": "Batch traceability", "description": "Correct traceability of the batches produced."}}'),
  (110, 'Uso de EPP', 'Cumplimiento del uso de equipo de protección personal.',
   '{"de": {"name": "Tragen der PSA", "description": "Einhaltung der persönlichen Schutzausrüstung."}, "en": {"name": "Use of PPE", "description": "Wearing the personal protective equipment."}}'),
  (120, 'Incidentes y su reporte oportuno', 'Incidentes, accidentes o casi-accidentes en el turno, y si se reportan a tiempo.',
   '{"de": {"name": "Vorfälle und rechtzeitige Meldung", "description": "Vorfälle, Unfälle oder Beinahe-Unfälle in der Schicht und ob sie rechtzeitig gemeldet werden."}, "en": {"name": "Incidents and timely reporting", "description": "Incidents, accidents or near misses in the shift, and whether they are reported in time."}}'),
  (130, 'Higiene personal', 'Cumplimiento de las normas de higiene personal.',
   '{"de": {"name": "Persönliche Hygiene", "description": "Einhaltung der Regeln zur persönlichen Hygiene."}, "en": {"name": "Personal hygiene", "description": "Following the personal hygiene rules."}}'),
  (140, 'Asistencia y puntualidad', 'Asistencia y puntualidad del equipo del turno y propia.',
   '{"de": {"name": "Anwesenheit und Pünktlichkeit", "description": "Anwesenheit und Pünktlichkeit des Schichtteams und die eigene."}, "en": {"name": "Attendance and punctuality", "description": "Attendance and punctuality of the shift team and their own."}}'),
  (150, 'Ausentismo y rotación', 'Ausentismo y rotación del personal supervisado.',
   '{"de": {"name": "Fehlzeiten und Fluktuation", "description": "Fehlzeiten und Fluktuation des geführten Personals."}, "en": {"name": "Absenteeism and turnover", "description": "Absenteeism and turnover of the staff supervised."}}'),
  (160, 'Capacitaciones del personal', 'Cumplimiento de las capacitaciones asignadas al personal.',
   '{"de": {"name": "Schulungen des Personals", "description": "Erfüllung der dem Personal zugewiesenen Schulungen."}, "en": {"name": "Staff training", "description": "Completion of the training assigned to the staff."}}'),
  (170, 'Manejo de conflictos', 'Manejo de conflictos o incidencias dentro del turno.',
   '{"de": {"name": "Umgang mit Konflikten", "description": "Umgang mit Konflikten oder Vorfällen in der Schicht."}, "en": {"name": "Handling conflicts", "description": "Handling conflicts or issues within the shift."}}'),
  (180, 'Reportes de turno', 'Calidad y oportunidad de los reportes de turno (bitácora, parte de producción, indicadores).',
   '{"de": {"name": "Schichtberichte", "description": "Qualität und Rechtzeitigkeit der Schichtberichte (Logbuch, Produktionsbericht, Kennzahlen)."}, "en": {"name": "Shift reports", "description": "Quality and timeliness of the shift reports (log, production report, indicators)."}}'),
  (190, 'Cumplimiento de instrucciones', 'Cumplimiento de instrucciones y prioridades definidas por el gerente de producción.',
   '{"de": {"name": "Befolgen von Anweisungen", "description": "Befolgen der Anweisungen und Prioritäten des Produktionsleiters."}, "en": {"name": "Following instructions", "description": "Following the instructions and priorities set by the production manager."}}'),
  (200, 'Traspaso de turno', 'Claridad en el traspaso de turno (shift handover) al siguiente encargado.',
   '{"de": {"name": "Schichtübergabe", "description": "Klarheit bei der Übergabe an die nächste Schichtleitung."}, "en": {"name": "Shift handover", "description": "Clarity of the handover to the next shift lead."}}'),
  (210, 'Propuestas de mejora', 'Propuestas de mejora o de reducción de mermas implementadas.',
   '{"de": {"name": "Verbesserungsvorschläge", "description": "Umgesetzte Verbesserungen oder Massnahmen zur Ausschussreduktion."}, "en": {"name": "Improvement proposals", "description": "Improvements or waste reductions proposed and implemented."}}'),
  (220, '5S e iniciativas', 'Participación en iniciativas 5S o similares dentro del turno.',
   '{"de": {"name": "5S und Initiativen", "description": "Teilnahme an 5S oder ähnlichen Initiativen in der Schicht."}, "en": {"name": "5S and initiatives", "description": "Taking part in 5S or similar initiatives within the shift."}}')
  ) as c(sort_order, name, description, translations);
