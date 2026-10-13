-- Collections: a follow-up can be a WhatsApp, next to a call and an email (2026-10-13).
alter table public.collection_events drop constraint collection_events_kind_check;
alter table public.collection_events add constraint collection_events_kind_check
  check (kind in ('call', 'email', 'whatsapp', 'note', 'promise', 'payment', 'stage', 'agency', 'invoice', 'responsible', 'reminder'));
