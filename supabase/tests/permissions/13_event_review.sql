-- ============================================================
-- An event's fuller review (2026-11-02): whoever works on events writes it
-- and how each product was received; whoever worked a shift gives their own
-- short view once the event is done, and reads only their own.
-- ============================================================

select pg_temp.person('seller', 'user', 'sales');
select pg_temp.person('tona', 'user', 'marketing');
select pg_temp.person('jeff', 'user', 'logistics');
select pg_temp.person('other', 'user', 'operations');

insert into public.events (kind_id, name, stage, start_date, end_date, owner_id, created_by)
values ((select id from public.event_kinds order by sort_order limit 1), 'ZZ review fair', 'confirmed',
        current_date - 5, current_date - 4, pg_temp.id('seller'), pg_temp.id('seller'));

create temp table _e as
  select e.id, (select id from public.products order by created_at limit 1) as product_id
    from public.events e where e.name = 'ZZ review fair';
grant select on _e to authenticated;

insert into public.event_shifts (event_id, shift_date, start_time, end_time, profile_id)
values ((select id from _e), current_date - 5, '09:00', '17:00', pg_temp.id('jeff'));

-- ---------- the review ----------

select pg_temp.cannot('event review: someone outside events cannot write it', 'other',
  $$update public.events set result_went_well = 'x' where id = (select id from _e)$$);
select pg_temp.cannot('event review: a shift worker cannot write the full review', 'jeff',
  $$update public.events set result_next_time = 'x' where id = (select id from _e)$$);
select pg_temp.can('event review: sales writes it', 'seller',
  $$update public.events set result_went_well = 'Busy stand', result_stand = 'good' where id = (select id from _e)$$);
select pg_temp.can('event review: Marketing writes it too', 'tona',
  $$update public.events set result_organiser_rating = 4 where id = (select id from _e)$$);

select pg_temp.cannot('event review: someone outside events cannot set product reception', 'other',
  $$select public.event_set_product_feedback((select id from _e),
      jsonb_build_array(jsonb_build_object('product_id', (select product_id from _e), 'reaction', 'liked')))$$);
select pg_temp.can('event review: sales sets product reception', 'seller',
  $$select public.event_set_product_feedback((select id from _e),
      jsonb_build_array(jsonb_build_object('product_id', (select product_id from _e), 'reaction', 'liked', 'most_asked', true)))$$);
select pg_temp.sees('event review: Marketing reads product reception', 'tona',
  $$select 1 from public.event_product_feedback where event_id = (select id from _e)$$);
select pg_temp.hidden('event review: a shift worker does not read product reception', 'jeff',
  $$select 1 from public.event_product_feedback where event_id = (select id from _e)$$);

-- ---------- the staff's view ----------

select pg_temp.cannot('staff view: not before the event is done', 'jeff',
  $$select public.event_staff_review_save((select id from _e), 4, 'Good', null)$$);

select pg_temp.cannot('event review: a shift worker cannot mark it done', 'jeff',
  $$update public.events set stage = 'done' where id = (select id from _e)$$);
select pg_temp.can('event review: sales marks it done', 'seller',
  $$update public.events set stage = 'done' where id = (select id from _e)$$);

select pg_temp.check('staff view: asked for on their Inicio once done',
  (select count(*) from (select pg_temp.act_as('jeff')) a, public.my_event_reviews_due() r where r.event_id = (select id from _e)) = 1);
select pg_temp.as_system();
select pg_temp.cannot('staff view: someone who did not work a shift cannot give one', 'other',
  $$select public.event_staff_review_save((select id from _e), 3, 'x', null)$$);
select pg_temp.can('staff view: whoever worked a shift gives theirs', 'jeff',
  $$select public.event_staff_review_save((select id from _e), 4, 'Good stand', 'More samples')$$);
select pg_temp.cannot('staff view: nobody writes the table directly', 'jeff',
  $$update public.event_staff_reviews set rating = 1 where event_id = (select id from _e)$$);
select pg_temp.check('staff view: no longer asked for once given',
  (select count(*) from (select pg_temp.act_as('jeff')) a, public.my_event_reviews_due() r where r.event_id = (select id from _e)) = 0);
select pg_temp.as_system();

select pg_temp.sees('staff view: they read their own', 'jeff',
  $$select 1 from public.event_staff_reviews where event_id = (select id from _e)$$);
select pg_temp.sees('staff view: sales reads it', 'seller',
  $$select 1 from public.event_staff_reviews where event_id = (select id from _e)$$);
select pg_temp.hidden('staff view: someone else does not read it', 'other',
  $$select 1 from public.event_staff_reviews where event_id = (select id from _e)$$);
select pg_temp.check('staff view: the status lists them, answered, for sales',
  (select answered from (select pg_temp.act_as('seller')) a, public.event_staff_review_status((select id from _e)) s
    where s.profile_id = pg_temp.id('jeff')));
select pg_temp.as_system();
select pg_temp.check('staff view: the status is empty for someone outside events',
  (select count(*) from (select pg_temp.act_as('other')) a, public.event_staff_review_status((select id from _e)) s) = 0);
select pg_temp.as_system();
insert into public.event_review_notices (event_id) values ((select id from _e));
select pg_temp.hidden('reminder ledger: nobody reads it', 'seller', $$select 1 from public.event_review_notices$$);
