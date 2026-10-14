-- ============================================================
-- What is one person's own: quick notes, personal tasks, notifications,
-- reminders, Mi espacio settings. No Admin or Owner override.
-- A shared note is read (and ticked) by whom it is shared with, not edited.
-- ============================================================

select pg_temp.person('a', 'user', 'logistics');
select pg_temp.person('b', 'user', 'logistics');
select pg_temp.person('admin', 'admin');
select pg_temp.person('owner', 'owner');

insert into public.quick_notes (owner_id, body) values
  (pg_temp.id('a'), 'ZZ private note'),
  (pg_temp.id('a'), 'ZZ shared note');
insert into public.quick_note_shares (note_id, profile_id)
select id, pg_temp.id('b') from public.quick_notes where body = 'ZZ shared note';

select pg_temp.sees('note: its writer sees it', 'a', $$select 1 from public.quick_notes where body = 'ZZ private note'$$);
select pg_temp.hidden('note: admin does not see a private note', 'admin', $$select 1 from public.quick_notes where body = 'ZZ private note'$$);
select pg_temp.hidden('note: owner does not see a private note', 'owner', $$select 1 from public.quick_notes where body = 'ZZ private note'$$);
select pg_temp.hidden('note: a colleague does not see a private note', 'b', $$select 1 from public.quick_notes where body = 'ZZ private note'$$);
select pg_temp.sees('note: shared with b, b reads it', 'b', $$select 1 from public.quick_notes where body = 'ZZ shared note'$$);
select pg_temp.cannot('note: b cannot edit a note shared with them', 'b',
  $$update public.quick_notes set body = 'zz edited' where body = 'ZZ shared note'$$);
select pg_temp.cannot('note: admin cannot delete someone''s note', 'admin',
  $$delete from public.quick_notes where body = 'ZZ private note'$$);

insert into public.personal_tasks (owner_id, title) values (pg_temp.id('a'), 'ZZ personal task');
select pg_temp.sees('personal task: its owner sees it', 'a', $$select 1 from public.personal_tasks where title = 'ZZ personal task'$$);
select pg_temp.hidden('personal task: admin does not see it', 'admin', $$select 1 from public.personal_tasks where title = 'ZZ personal task'$$);
select pg_temp.hidden('personal task: owner does not see it', 'owner', $$select 1 from public.personal_tasks where title = 'ZZ personal task'$$);

insert into public.notification_inbox (user_id, tag, title) values (pg_temp.id('a'), 'zz-test', 'ZZ notice');
select pg_temp.sees('notification: its person sees it', 'a', $$select 1 from public.notification_inbox where tag = 'zz-test'$$);
select pg_temp.hidden('notification: admin does not see it', 'admin', $$select 1 from public.notification_inbox where tag = 'zz-test'$$);
select pg_temp.hidden('notification: a colleague does not see it', 'b', $$select 1 from public.notification_inbox where tag = 'zz-test'$$);

insert into public.reminders (created_by, title, due_at) values (pg_temp.id('a'), 'ZZ own reminder', now() + interval '1 day');
insert into public.reminder_participants (reminder_id, user_id)
select id, pg_temp.id('a') from public.reminders where title = 'ZZ own reminder';
select pg_temp.sees('reminder: its person sees it', 'a', $$select 1 from public.reminders where title = 'ZZ own reminder'$$);
select pg_temp.hidden('reminder: a colleague does not see it', 'b', $$select 1 from public.reminders where title = 'ZZ own reminder'$$);
select pg_temp.hidden('reminder: admin does not see it', 'admin', $$select 1 from public.reminders where title = 'ZZ own reminder'$$);

insert into public.space_settings (profile_id, accent) values (pg_temp.id('a'), 'blue');
select pg_temp.cannot('Mi espacio: nobody changes someone else''s colour', 'b',
  format('update public.space_settings set accent = %L where profile_id = %L', 'red', pg_temp.id('a')));
