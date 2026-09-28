-- ============================================================
-- Evaluations sent to several people about one worker.
--
-- Admin chooses a worker, the questions and the people; each of them
-- evaluates the worker, and every answer stays in the worker's file.
--
--   hr_eval_requests      one sending: whose evaluation, until when. Carries
--                         the worker's name, position and team as they were,
--                         because the evaluators have no access to the file.
--   hr_eval_request_items what is asked: criteria ticked from the lists and
--                         Admin's own questions, frozen when sent so a later
--                         rename leaves the answers reading as written.
--   hr_eval_assignments   one per evaluator: their general comment, and when
--                         they submitted.
--   hr_eval_answers       their answer to each item: 1-5 with details, or text.
--
-- Anonymity. Only Admin reads who answered what. Whoever else sees the file
-- (hr.manage) reads the requests and their items, and gets the answers only
-- through hr_eval_overview(): combined, without names, and only once three
-- people have answered — below that it would say who said it.
--
-- Permanent. There is no write policy on any of these tables; every change
-- goes through the functions below, and none of them changes or removes a
-- submitted answer. An evaluator may save a draft until they submit.
--
-- Open means not closed early and the deadline day (Europe/Zurich) not over.
-- ============================================================

create table public.hr_eval_requests (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid not null references public.hr_workers (id) on delete cascade,
  worker_name     text not null,
  worker_position text,
  worker_team     public.team not null,
  deadline        date not null,
  closed_at       timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index hr_eval_requests_worker_idx on public.hr_eval_requests (worker_id, created_at desc);

create table public.hr_eval_request_items (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.hr_eval_requests (id) on delete cascade,
  sort_order   int not null,
  kind         text not null check (kind in ('scale', 'text')),
  criterion_id uuid references public.hr_criteria (id) on delete set null,
  name         text not null check (length(btrim(name)) > 0),
  description  text,
  translations jsonb not null default '{}'::jsonb
);

create index hr_eval_request_items_request_idx on public.hr_eval_request_items (request_id, sort_order);

create table public.hr_eval_assignments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.hr_eval_requests (id) on delete cascade,
  -- Kept when an account is removed: the answer belongs to the worker's file.
  evaluator_id uuid references public.profiles (id) on delete set null,
  comment      text,
  submitted_at timestamptz,
  reminded_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (request_id, evaluator_id)
);

create index hr_eval_assignments_evaluator_idx on public.hr_eval_assignments (evaluator_id, submitted_at);

create table public.hr_eval_answers (
  assignment_id uuid not null references public.hr_eval_assignments (id) on delete cascade,
  item_id       uuid not null references public.hr_eval_request_items (id) on delete cascade,
  score         int check (score between 1 and 5),
  body          text,
  primary key (assignment_id, item_id)
);

-- ---------- helpers ----------

create or replace function public.hr_eval_is_open(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_eval_requests r
     where r.id = p_request_id
       and r.closed_at is null
       and (now() at time zone 'Europe/Zurich')::date <= r.deadline
  );
$$;

/* Is this the caller's own evaluation to fill in? */
create or replace function public.hr_eval_is_mine(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_eval_assignments a
     where a.request_id = p_request_id and a.evaluator_id = (select auth.uid())
  );
$$;

-- ---------- RLS: reads only ----------

alter table public.hr_eval_requests      enable row level security;
alter table public.hr_eval_request_items enable row level security;
alter table public.hr_eval_assignments   enable row level security;
alter table public.hr_eval_answers       enable row level security;

create policy "hr_eval_requests: read" on public.hr_eval_requests
  for select to authenticated
  using (public.hr_can_worker(worker_id) or public.hr_eval_is_mine(id));

create policy "hr_eval_request_items: read" on public.hr_eval_request_items
  for select to authenticated
  using (exists (
    select 1 from public.hr_eval_requests r
     where r.id = request_id and (public.hr_can_worker(r.worker_id) or public.hr_eval_is_mine(r.id))
  ));

-- Names and answers: Admin, and each evaluator their own.
create policy "hr_eval_assignments: read" on public.hr_eval_assignments
  for select to authenticated
  using ((select public.is_admin()) or evaluator_id = (select auth.uid()));

create policy "hr_eval_answers: read" on public.hr_eval_answers
  for select to authenticated
  using (exists (
    select 1 from public.hr_eval_assignments a
     where a.id = assignment_id
       and ((select public.is_admin()) or a.evaluator_id = (select auth.uid()))
  ));

-- ---------- sending (Admin) ----------

/*
 * p_items: [{"criterion_id": uuid}] for a criterion from the lists, or
 * {"kind": "scale"|"text", "name": text, "description": text|null,
 *  "translations": {"de": {"name", "description"}, "en": {...}}} for Admin's own.
 * Returns the request and, for telling them, each evaluator's assignment.
 */
create or replace function public.hr_eval_send(
  p_worker_id  uuid,
  p_deadline   date,
  p_items      jsonb,
  p_evaluators uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker  public.hr_workers%rowtype;
  v_request uuid;
  v_item    jsonb;
  v_crit    public.hr_criteria%rowtype;
  v_order   int := 0;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_deadline is null or p_deadline < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'deadline_past' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'items_required' using errcode = '22023';
  end if;
  if coalesce(array_length(p_evaluators, 1), 0) = 0 then
    raise exception 'evaluators_required' using errcode = '22023';
  end if;

  select * into v_worker from public.hr_workers where id = p_worker_id;
  if not found then
    raise exception 'worker_not_found' using errcode = 'P0002';
  end if;

  insert into public.hr_eval_requests (worker_id, worker_name, worker_position, worker_team, deadline, created_by)
  values (v_worker.id, v_worker.name, v_worker.position, v_worker.team, p_deadline, (select auth.uid()))
  returning id into v_request;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_order := v_order + 1;
    if v_item ? 'criterion_id' then
      select * into v_crit from public.hr_criteria where id = (v_item ->> 'criterion_id')::uuid;
      if not found then
        raise exception 'invalid_criterion' using errcode = '22023';
      end if;
      insert into public.hr_eval_request_items (request_id, sort_order, kind, criterion_id, name, description, translations)
      values (v_request, v_order, 'scale', v_crit.id, v_crit.name, v_crit.description, v_crit.translations);
    else
      if coalesce(v_item ->> 'kind', '') not in ('scale', 'text')
         or length(btrim(coalesce(v_item ->> 'name', ''))) = 0 then
        raise exception 'invalid_question' using errcode = '22023';
      end if;
      insert into public.hr_eval_request_items (request_id, sort_order, kind, name, description, translations)
      values (
        v_request, v_order, v_item ->> 'kind', btrim(v_item ->> 'name'),
        nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
        coalesce(v_item -> 'translations', '{}'::jsonb)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'request_id', v_request,
    'assignments', public.hr_eval_invite(v_request, p_evaluators)
  );
end;
$$;

/*
 * Add people to an open request. Only approved accounts, never the worker's
 * own, and nobody twice. Returns [{assignment_id, evaluator_id}] of those added.
 */
create or replace function public.hr_eval_invite(p_request_id uuid, p_evaluators uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.hr_eval_is_open(p_request_id) then
    raise exception 'evaluation_closed' using errcode = '42501';
  end if;

  with added as (
    insert into public.hr_eval_assignments (request_id, evaluator_id)
    select p_request_id, p.id
      from public.profiles p
     where p.id = any (p_evaluators)
       and p.status = 'approved'
       and p.deleted_at is null
       and p.id is distinct from (
         select w.profile_id from public.hr_eval_requests r
           join public.hr_workers w on w.id = r.worker_id
          where r.id = p_request_id)
    on conflict (request_id, evaluator_id) do nothing
    returning id, evaluator_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', id, 'evaluator_id', evaluator_id)), '[]'::jsonb)
    into v_added from added;

  return v_added;
end;
$$;

/* Take back an evaluation nobody has submitted yet; its draft goes with it. */
create or replace function public.hr_eval_uninvite(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.hr_eval_assignments where id = p_assignment_id and submitted_at is null;
  if not found then
    raise exception 'already_submitted' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.hr_eval_close(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.hr_eval_requests set closed_at = now() where id = p_request_id and closed_at is null;
end;
$$;

/* A new deadline; extending one that already passed opens it again. Not once closed early. */
create or replace function public.hr_eval_set_deadline(p_request_id uuid, p_deadline date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_deadline is null or p_deadline < (now() at time zone 'Europe/Zurich')::date then
    raise exception 'deadline_past' using errcode = '22023';
  end if;
  update public.hr_eval_requests
     set deadline = p_deadline
   where id = p_request_id and closed_at is null;
  if not found then
    raise exception 'evaluation_closed' using errcode = '42501';
  end if;
end;
$$;

-- ---------- answering (the evaluator) ----------

/*
 * Save the caller's answers — a draft, or submitted when p_submit. Submitting
 * needs every 1-5 item rated; free text may stay empty. After submitting,
 * nothing can change it.
 *
 * p_answers: [{"item_id": uuid, "score": 1-5|null, "body": text|null}]
 */
create or replace function public.hr_eval_answer(
  p_assignment_id uuid,
  p_answers       jsonb,
  p_comment       text,
  p_submit        boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.hr_eval_assignments%rowtype;
begin
  select * into v_a from public.hr_eval_assignments where id = p_assignment_id for update;
  if not found or v_a.evaluator_id is distinct from (select auth.uid()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_a.submitted_at is not null then
    raise exception 'already_submitted' using errcode = '42501';
  end if;
  if not public.hr_eval_is_open(v_a.request_id) then
    raise exception 'evaluation_closed' using errcode = '42501';
  end if;

  insert into public.hr_eval_answers (assignment_id, item_id, score, body)
  select p_assignment_id, i.id,
         case when i.kind = 'scale' then (x ->> 'score')::int end,
         nullif(btrim(coalesce(x ->> 'body', '')), '')
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) x
    join public.hr_eval_request_items i
      on i.id = (x ->> 'item_id')::uuid and i.request_id = v_a.request_id
  on conflict (assignment_id, item_id) do update
    set score = excluded.score, body = excluded.body;

  update public.hr_eval_assignments
     set comment = nullif(btrim(coalesce(p_comment, '')), '')
   where id = p_assignment_id;

  if p_submit then
    if exists (
      select 1 from public.hr_eval_request_items i
       where i.request_id = v_a.request_id and i.kind = 'scale'
         and not exists (select 1 from public.hr_eval_answers x
                          where x.assignment_id = p_assignment_id and x.item_id = i.id and x.score is not null)
    ) then
      raise exception 'rate_all' using errcode = '22023';
    end if;
    update public.hr_eval_assignments set submitted_at = now() where id = p_assignment_id;
  end if;
end;
$$;

-- ---------- the overview (whoever sees the file) ----------

/*
 * Counts always; the answers combined and without names once three people
 * have submitted. Comments come ordered by a hash, not by who or when.
 */
create or replace function public.hr_eval_overview(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_worker    uuid;
  v_invited   int;
  v_submitted int;
begin
  select r.worker_id into v_worker from public.hr_eval_requests r where r.id = p_request_id;
  if not found or not public.hr_can_worker(v_worker) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where a.submitted_at is not null)
    into v_invited, v_submitted
    from public.hr_eval_assignments a where a.request_id = p_request_id;

  if v_submitted < 3 then
    return jsonb_build_object('invited', v_invited, 'submitted', v_submitted, 'shown', false);
  end if;

  return jsonb_build_object(
    'invited', v_invited,
    'submitted', v_submitted,
    'shown', true,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id,
        'average', (select round(avg(x.score)::numeric, 2) from public.hr_eval_answers x
                      join public.hr_eval_assignments a on a.id = x.assignment_id
                     where x.item_id = i.id and a.submitted_at is not null and x.score is not null),
        'distribution', (select jsonb_agg(n.c order by n.s) from (
                           select s, (select count(*) from public.hr_eval_answers x
                                        join public.hr_eval_assignments a on a.id = x.assignment_id
                                       where x.item_id = i.id and a.submitted_at is not null and x.score = s) c
                             from generate_series(1, 5) s) n),
        'texts', (select coalesce(jsonb_agg(x.body order by md5(x.assignment_id::text || x.item_id::text)), '[]'::jsonb)
                    from public.hr_eval_answers x
                    join public.hr_eval_assignments a on a.id = x.assignment_id
                   where x.item_id = i.id and a.submitted_at is not null and x.body is not null)
      ) order by i.sort_order), '[]'::jsonb)
        from public.hr_eval_request_items i where i.request_id = p_request_id
    ),
    'comments', (
      select coalesce(jsonb_agg(a.comment order by md5(a.id::text)), '[]'::jsonb)
        from public.hr_eval_assignments a
       where a.request_id = p_request_id and a.submitted_at is not null and a.comment is not null
    )
  );
end;
$$;

/* Invited and answered, per request of a worker — for the file's list. */
create or replace function public.hr_eval_counts(p_worker_id uuid)
returns table (request_id uuid, invited int, submitted int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         count(a.id)::int,
         (count(a.id) filter (where a.submitted_at is not null))::int
    from public.hr_eval_requests r
    left join public.hr_eval_assignments a on a.request_id = r.id
   where r.worker_id = p_worker_id and public.hr_can_worker(p_worker_id)
   group by r.id;
$$;

revoke all on function public.hr_eval_is_open(uuid) from public, anon;
revoke all on function public.hr_eval_is_mine(uuid) from public, anon;
revoke all on function public.hr_eval_send(uuid, date, jsonb, uuid[]) from public, anon;
revoke all on function public.hr_eval_invite(uuid, uuid[]) from public, anon;
revoke all on function public.hr_eval_uninvite(uuid) from public, anon;
revoke all on function public.hr_eval_close(uuid) from public, anon;
revoke all on function public.hr_eval_set_deadline(uuid, date) from public, anon;
revoke all on function public.hr_eval_answer(uuid, jsonb, text, boolean) from public, anon;
revoke all on function public.hr_eval_overview(uuid) from public, anon;
revoke all on function public.hr_eval_counts(uuid) from public, anon;
grant execute on function public.hr_eval_is_open(uuid) to authenticated;
grant execute on function public.hr_eval_is_mine(uuid) to authenticated;
grant execute on function public.hr_eval_send(uuid, date, jsonb, uuid[]) to authenticated;
grant execute on function public.hr_eval_invite(uuid, uuid[]) to authenticated;
grant execute on function public.hr_eval_uninvite(uuid) to authenticated;
grant execute on function public.hr_eval_close(uuid) to authenticated;
grant execute on function public.hr_eval_set_deadline(uuid, date) to authenticated;
grant execute on function public.hr_eval_answer(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.hr_eval_overview(uuid) to authenticated;
grant execute on function public.hr_eval_counts(uuid) to authenticated;
