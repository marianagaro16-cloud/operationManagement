-- ============================================================
-- Helpers for the permission tests (scripts/test-db.mjs puts this before
-- every test file, inside a transaction it always rolls back).
--
-- People are made up for the test — an auth user and its profile, created
-- here and gone at the rollback — so no test depends on who works here.
-- Checks run as them exactly as the app does: role `authenticated` with
-- their id in the JWT claims, so RLS, triggers and auth.uid() all apply.
-- ============================================================

create temp table _r (n serial, label text, ok boolean, detail text);
create temp table _p (key text primary key, id uuid not null);
grant all on _r to authenticated;
grant usage on sequence _r_n_seq to authenticated;
grant select on _p to authenticated;

-- Back to the test's own role: no RLS, for fixtures and for counting what exists.
create function pg_temp.as_system() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A made-up, approved person. `key` names them in the test.
create function pg_temp.person(p_key text, p_role text, p_team text default 'operations') returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform pg_temp.as_system();
  insert into auth.users (id, email, aud, role)
  values (v, 'zz-' || p_key || '-' || left(v::text, 8) || '@test.invalid', 'authenticated', 'authenticated');
  -- Signed in as nobody, so the owner guard lets the test make owners too.
  update public.profiles
     set name = 'ZZ ' || p_key, role = p_role::public.user_role, team = p_team::public.team, status = 'approved'
   where id = v;
  insert into _p values (p_key, v);
  return v;
end $$;

create function pg_temp.id(p_key text) returns uuid language sql stable as $$
  select id from _p where key = p_key
$$;

create function pg_temp.act_as(p_key text) returns void language plpgsql as $$
declare v uuid := pg_temp.id(p_key);
begin
  if v is null then raise exception 'test person % was never made', p_key; end if;
  perform pg_temp.as_system();
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.check(p_label text, p_ok boolean, p_detail text default null) returns void
language sql as $$
  insert into _r (label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail)
$$;

-- How many rows a query returns for whoever is acting now.
create function pg_temp.n(q text) returns bigint language plpgsql as $$
declare c bigint;
begin
  execute 'select count(*) from (' || q || ') x' into c;
  return c;
end $$;

-- Runs a write as whoever is acting now: 'ok:<rows>' or 'error:<message>'.
-- RLS hides a forbidden row from update/delete, so "ok:0" is a refusal too.
create function pg_temp.try(q text) returns text language plpgsql as $$
declare c bigint;
begin
  execute q;
  get diagnostics c = row_count;
  return 'ok:' || c;
exception when others then
  return 'error:' || sqlerrm;
end $$;

-- `who` sees rows of `q`. Hidden checks first make sure there is something to hide.
create function pg_temp.sees(p_label text, p_who text, q text) returns void language plpgsql as $$
declare c bigint;
begin
  perform pg_temp.act_as(p_who);
  c := pg_temp.n(q);
  perform pg_temp.as_system();
  perform pg_temp.check(p_label, c > 0, c || ' rows');
end $$;

create function pg_temp.hidden(p_label text, p_who text, q text) returns void language plpgsql as $$
declare total bigint; c bigint;
begin
  perform pg_temp.as_system();
  total := pg_temp.n(q);
  if total = 0 then
    perform pg_temp.check(p_label, false, 'nothing to hide: the query finds no rows at all');
    return;
  end if;
  perform pg_temp.act_as(p_who);
  c := pg_temp.n(q);
  perform pg_temp.as_system();
  perform pg_temp.check(p_label, c = 0, c || ' of ' || total || ' rows visible');
end $$;

-- `who` may make the write: it succeeds and touches at least one row.
create function pg_temp.can(p_label text, p_who text, q text) returns void language plpgsql as $$
declare res text;
begin
  perform pg_temp.act_as(p_who);
  res := pg_temp.try(q);
  perform pg_temp.as_system();
  perform pg_temp.check(p_label, res like 'ok:%' and res <> 'ok:0', res);
end $$;

-- `who` may not: an error, or nothing touched.
create function pg_temp.cannot(p_label text, p_who text, q text) returns void language plpgsql as $$
declare res text;
begin
  perform pg_temp.act_as(p_who);
  res := pg_temp.try(q);
  perform pg_temp.as_system();
  perform pg_temp.check(p_label, res = 'ok:0' or res like 'error:%', res);
end $$;
