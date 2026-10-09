-- ============================================================
-- Blocked activities stay owed (2026-10-09).
--
-- A blocked activity used to leave the day: not late, not counted, nobody
-- reminded. It is still work to do, so now it stays on the person's list —
-- late once its day has passed — and each working morning whoever has one,
-- and the Admin, are reminded of what is still blocked.
--
-- This is the ledger of those reminders: one per person and day, claimed
-- before sending, so two runs at once send one notice.
-- ============================================================

create table public.activity_block_reminders (
  reminder_date date not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (reminder_date, user_id)
);

-- Written and read by the scheduler only (service role).
alter table public.activity_block_reminders enable row level security;
