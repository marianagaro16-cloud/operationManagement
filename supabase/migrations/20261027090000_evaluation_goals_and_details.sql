-- ============================================================
-- Evaluations: goals for the next period, and details per criterion.
--
--   hr_evaluations.goals          what the worker should aim for until the
--                                 next evaluation — which then shows it, so
--                                 the goals can be checked against.
--   hr_evaluation_scores.comment  the reason behind one rating (optional).
--
-- Permanent like the rest of the evaluation: written with it, never changed.
-- ============================================================

alter table public.hr_evaluations add column goals text;
alter table public.hr_evaluation_scores add column comment text;

comment on column public.hr_evaluations.goals is 'Goals for the next evaluation period.';
comment on column public.hr_evaluation_scores.comment is 'Details behind this one rating; optional.';
