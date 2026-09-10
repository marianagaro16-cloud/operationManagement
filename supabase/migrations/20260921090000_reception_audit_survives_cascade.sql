-- ============================================================
-- The child audit trigger must not block a cascade delete
--
-- THE BUG, reproduced against this database:
--
--   delete from goods_receptions where id = ...;
--   ERROR: insert or update on table "goods_reception_audit_log" violates
--          foreign key constraint "goods_reception_audit_log_reception_id_fkey"
--
-- Deleting a reception cascades to its exceptions and evidence. Each of those
-- deletions fires log_goods_reception_child_change(), which writes an
-- 'exception_removed' row naming the reception — a reception that has, in
-- this very statement, just been deleted. The audit insert then fails its own
-- foreign key and takes the whole delete down with it.
--
-- A reception with no children deletes cleanly, which is why this went
-- unnoticed: the verification run's second reception had an exception on it
-- and its cleanup silently failed, leaving a test row in the production
-- table.
--
-- WHY IT MATTERED LITTLE AND STILL MATTERS. No policy grants delete on
-- goods_receptions to anyone, so no user could ever hit this — only the
-- service role can, which is exactly what a cleanup or a data migration runs
-- as. A trigger that makes a table undeletable by its own maintenance path is
-- a trap left for the next person.
--
-- THE FIX: an AFTER DELETE on a child records nothing when its parent is
-- already gone. There is nothing to record — the reception's whole history is
-- being removed with it, and a dangling note about one of its exceptions
-- would be an audit trail for a record that no longer exists.
--
-- Deleting an exception on its own is untouched: the reception is still there,
-- the EXISTS check passes, and the 'exception_removed' row is written exactly
-- as before. That is the path the application actually uses.
-- ============================================================

create or replace function public.log_goods_reception_child_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reception uuid;
  v_action    text;
  v_payload   jsonb;
begin
  if TG_OP = 'DELETE' then
    v_reception := old.reception_id;

    /*
     * The parent is going away and is taking this row with it. Within the
     * same transaction the reception row is already deleted, so this EXISTS
     * is false precisely and only during a cascade.
     */
    if not exists (select 1 from public.goods_receptions r where r.id = v_reception) then
      return old;
    end if;
  else
    v_reception := new.reception_id;
  end if;

  if TG_TABLE_NAME = 'goods_reception_evidence' then
    v_action  := case TG_OP when 'INSERT' then 'evidence_added' else 'evidence_removed' end;
    v_payload := case TG_OP
                   when 'INSERT' then jsonb_build_object('file_name', new.file_name)
                   else jsonb_build_object('file_name', old.file_name)
                 end;
  else
    v_action  := case TG_OP
                   when 'INSERT' then 'exception_added'
                   when 'UPDATE' then 'exception_changed'
                   else 'exception_removed'
                 end;
    v_payload := case TG_OP
                   when 'DELETE' then jsonb_build_object('product_id', old.product_id, 'description', old.description)
                   else jsonb_build_object('product_id', new.product_id, 'description', new.description)
                 end;
  end if;

  insert into public.goods_reception_audit_log (reception_id, actor_id, action, new_value)
  values (v_reception, (select auth.uid()), v_action, v_payload);

  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
