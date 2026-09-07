# Operation Manager

Operations task-management PWA for the logistics team. Replaces the
Excel workbook `Actividades de logística_Master.xlsx` with a shared,
auditable, recurrence-aware system.

**Business timezone: `Europe/Zurich`.** Every scheduling decision is computed
in that zone, never in the browser's.

---

## The central distinction

> **A task definition is not a task occurrence.**

`tasks` holds *definitions* ("Realizar el inventario de productos Masamor").
An *occurrence* is one of those due on one date. Users act on occurrences;
only admins and managers edit definitions. Editing or deactivating a
definition never alters or removes past occurrences.

**How an occurrence comes into existence depends on the frequency.**

```
DAILY       Task definition -> Recurrence engine -> Occurrence -> Dashboard
              (config)          (src/domain)        (nightly)     (user)

EVERYTHING  Task definition -> a person, on the  -> Occurrence -> Dashboard
ELSE          (no schedule)     calendar            (chosen)      (user)
```

The daily checklist still schedules itself. Weekly, biweekly, monthly and
semiannual work — and every inventory — is placed deliberately by an admin,
manager or power user from `/calendar`, one day at a time or a week or month
at once. A rule that fills the next four months with work nobody has decided
to do is not a schedule; it is noise, and it made the calendar unreadable.

The recurrence engine still contains correct, tested generators for the other
frequencies. They have no caller, and `schedule_config` is only read for
`daily`.

Two consequences worth knowing:

- **An occurrence is keyed by DATE, not by period.** `UNIQUE(task_id,
  due_date)` replaced `UNIQUE(task_id, period_key)`, so the same weekly task
  can sit on Monday *and* Wednesday of one week. `period_key` survives as a
  reporting label — History renders it — exactly as it does for inventories.
- **`source` says who created a row.** `auto` is the nightly generator, `manual`
  is a person. The stalled-scheduler warning counts only `auto` rows, so a
  deliberately quiet week never looks like a broken cron.

---

## Architecture

| Layer | Location | Responsibility |
|---|---|---|
| Domain | `src/domain/recurrence`, `src/domain/stats` | Pure recurrence + reporting logic. No I/O, no React. |
| Data access | `src/server/data.ts` | Queries, occurrence materialisation |
| Mutations | `src/server/actions.ts` | Validated server actions over RPCs |
| Auth/AuthZ | `supabase/migrations`, `src/middleware.ts` | RLS + SECURITY DEFINER functions |
| UI | `src/components`, `src/app` | Rendering only |
| i18n | `src/i18n` | Typed message keys (es / de / en) |

No React component performs recurrence maths. The engine is pure and
synchronous so it can be exhaustively tested and reused from a server action,
a cron route, or the seed importer.

### Recurrence model

An occurrence is identified by `UNIQUE(task_id, due_date)` — one requirement
per task per day, surviving concurrent writers and repeated generation. It was
`UNIQUE(task_id, period_key)` while a rule produced every date; once a person
places them, the same weekly task on two days of one week is a legitimate
request the old key refused.

| Frequency | Materialised by | period_key (label only) |
|---|---|---|
| daily | the nightly generator, from `schedule_config` | `2026-09-01` |
| weekly | a person, on the calendar | `2026-W36` (ISO week) |
| biweekly | a person, on the calendar | `BW-2026-09-08` |
| monthly | a person, on the calendar | `2026-09` |
| semiannual | a person, on the calendar | `2026-H2` |

**Only `daily` reads `schedule_config`** — the weekday restriction, defaulting
to Mon–Fri because the warehouse is closed at the weekend.

**Weekly completion window:** a weekly task placed on Tuesday is satisfied by
completing it that day. `period_key` still labels it `2026-W36`, so History and
the report groupings continue to read in weeks.

**Never invented:** a *daily* task whose schedule cannot be resolved generates
nothing and is surfaced as *"Scheduling configuration required"* with a direct
link to fix it. Other frequencies have no schedule to resolve and are never
flagged.

---

## Roles

Four levels. The line that matters runs between Manager and Power user, and it
is **configuration versus data**: a Manager may change the inventory *template*
that shapes every future count; a Power user may only work on the *counts* that
template produced.

| Role | Owns |
|---|---|
| `admin` | System control — users, roles, permissions, configuration |
| `manager` | Operational configuration *and* management |
| `power_user` | Operational management only |
| `user` | Operational execution — works on what they are assigned |

Between the two extremes the capabilities are **configurable**, at
`/admin/permissions`. A capability is a row in `permission_catalog`; a grant is a
row in `role_permissions`. What a Manager or Power user may do is therefore data,
not code, and an admin can move the line without a deploy.

Six capabilities are permanently admin-only — creating and approving users,
assigning roles, configuring permissions, system configuration, and the security
audit. They are catalogued with `is_configurable = false` purely so the matrix
can render them locked. Two independent database rules make them ungrantable: a
CHECK constrains `role_permissions` to `manager` and `power_user`, and a trigger
refuses any non-configurable permission. Delegating role assignment to a Manager
is not a mistake that can be made through the UI, the API, or hand-written SQL.

`is_admin()` was deliberately **not** changed. It still means "role = admin and
approved", and remains the predicate for everything system-level. Operational
access widened through a sibling, `has_permission(key)`, which short-circuits on
`is_admin()`. The consequence worth knowing: adding the roles changed nobody's
access, because until an account is actually promoted there is no `manager` or
`power_user` row for any policy to match.

Adding the enum labels ships as its own migration
(`20260908090000_roles_enum.sql`), separate from everything that references them
(`20260908090100_role_permissions.sql`). Postgres will not let a new enum label
be used in the transaction that added it, and `supabase db push` runs each file
as one transaction. **Do not merge those two files.**

---

## Security

RLS is the boundary; frontend role checks are cosmetic.

- `profiles` — read own always (so a pending user learns they are pending);
  approved users read the team; only admins write role/status.
- `tasks`, `categories` — approved users read; `tasks.manage_definitions` writes.
- `task_occurrences` — approved users read. **No direct UPDATE for users.**
- `task_comments` — approved read; insert only as yourself.
- `role_permissions` — approved users read (the UI has to explain why an action
  is unavailable); only admins write.
- `security_audit_log` — admin read only. The operational logs
  (`order_audit_log`, `inventory_audit_log`) open at `audit.view_operational`.

Column-level rules cannot be expressed as RLS, so two of them are triggers:
Product Code changes require `products.change_code`, and editing a confirmed
order requires `orders.correct_completed`. Both skip the check when there is no
session, because the importer runs as the service role and legitimately has none.

All user-facing state changes go through `SECURITY DEFINER` functions —
`complete_occurrence`, `skip_occurrence`, `reopen_occurrence` — which re-check
authorization and business rules server-side. This is what makes
"a skip always requires a reason" and "a non-skippable task cannot be skipped"
unbypassable, and stops one user silently reverting another's work.

Self-registration never grants access: a trigger creates the profile as
`pending`, and an admin must approve it.

---

## Routes

| Route | Access | Purpose |
|---|---|---|
| `/login`, `/register` | public | email/password auth |
| `/dashboard` | approved | today, overdue, upcoming, extra-tasks banner |
| `/calendar` | tasks.manage_occurrences | **the planner** — place tasks and inventories on days, or plan a week/month |
| `/admin` | power_user+ | config health + pending approvals |
| `/admin/tasks` | tasks.manage_definitions | definitions, frequency-adaptive schedule editor |
| `/admin/users` | admin | approve / reject / deactivate, role changes |
| `/admin/permissions` | admin | the role/capability matrix |
| `/admin/audit` | audit.view_operational | operational trail; security tab is admin-only |
| `/admin/history` | tasks.manage_occurrences | occurrence record (rolling 180 days) |
| `/admin/statistics` | reports.view | completion by day/week/month/year, user, category, frequency |
| `/admin/settings` | admin | manual occurrence generation |
| `/inventory` | approved | inventory overview: today, upcoming, review queue, filtered history |
| `/inventory/[id]` | approved (only assigned may edit) | the counting screen |
| `/admin/inventory` | inventory.manage_templates | inventory templates, schedules, Inventory Digital toggle |
| `/admin/inventory/[templateId]` | inventory.manage_templates | items, product links, ordering, default assignees |
| `/admin/inventory/locations` | inventory.manage_templates | counting locations for packaging |
| `/admin/inventory/permissions` | inventory.grant_temporary_edit | temporary edit permissions |
| `/api/cron/generate` | cron secret | nightly task occurrence + inventory materialisation |

---

## Setup

```bash
npm install
cp .env.example .env        # fill in values
npm run db:push             # apply migrations
npm run import:seed         # load the 50 tasks
npm run dev
```

### Bootstrapping the first admin

Registration deliberately grants no access — every new account is `pending`
until an admin approves it. That leaves a chicken-and-egg on a fresh install,
so the first admin is promoted directly in SQL.

1. Register normally at `/register`.
2. Run this once in the Supabase SQL editor, with your email:

```sql
update public.profiles
   set role = 'admin', status = 'approved'
 where email = 'you@example.com';
```

Every later admin is promoted from `/admin/users` in the app. The app refuses
to remove the last remaining admin, so you cannot lock yourself out.

### Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app + Vercel | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app + Vercel | public by design; RLS is the boundary |
| `SUPABASE_SERVICE_ROLE_KEY` | server + Vercel (Sensitive) | bypasses RLS — never `NEXT_PUBLIC_` |
| `CRON_SECRET` | Vercel (Sensitive) | schedulers send `Authorization: Bearer <value>` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | app + Vercel | **plain, not Sensitive** — it ships to every browser |
| `VAPID_PRIVATE_KEY` | server + Vercel (Sensitive) | signs push requests — never `NEXT_PUBLIC_` |
| `VAPID_SUBJECT` | server + Vercel | `mailto:` contact required by the Web Push spec |
| `SUPABASE_ACCESS_TOKEN` | **local CLI only** | account-wide; never deploy |
| `SUPABASE_DB_PASSWORD` | **local CLI only** | never deploy |

`NEXT_PUBLIC_*` values are **inlined into the browser bundle at build time**,
not read at runtime. Adding or changing one in Vercel does nothing until the
next deploy — a missing `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is what makes *Enable
notifications* fail with `push_not_configured`.

### Seed / import

The workbook contains **no scheduling data** — its columns are checkbox
logging grids. Defaults from the requirements are applied; where none exists
the task is flagged instead of guessed.

```bash
npm run import:extract   # xlsx  -> data/tasks.seed.json (committed)
npm run import:seed      # json  -> Supabase (idempotent)
```

Idempotency key is `(lower(title), frequency)` — three activities appear on
two sheets at different cadences, so title alone is not unique. Re-running
the seed leaves existing tasks untouched, including schedules admins have
since configured.

| Sheet | Frequency | Tasks |
|---|---|---|
| Actividades Diarias | daily | 4 |
| Actividades Semanales | weekly | 34 |
| Actividades Quincenales | biweekly | 1 |
| Actividades Mensuales | monthly | 7 |
| Actividades Semestrales | semiannual | 4 |

### Commands

```bash
npm run dev / build / start
npm test                # recurrence engine suite
npm run typecheck
npm run icons           # regenerate PWA icons
npm run db:types        # regenerate DB types from the live schema
npm run verify:roles    # role/permission RLS checks against the live database
npm run verify:tasks    # manual scheduling checks against the live database
```

---

## Testing

`npm test` runs the recurrence suite **pinned to `TZ=America/New_York`**, so
any accidental reliance on the ambient timezone fails loudly rather than
passing by luck on a Zurich machine.

Covered: daily generation and weekday restriction; weekly Tuesday/Thursday and
the Tuesday-satisfies-Thursday rule; ISO-week identity across a year boundary;
biweekly anchor, 14-day cadence, pre-anchor emptiness and missing-anchor
safety; monthly last-Thursday, leap February, 30/31-day months, day-of-month
clamping; semiannual defaults and half-year windows; config validation;
and both Zurich DST transitions.

---

## PWA

Installable on desktop, Android and iOS: manifest, maskable icons, standalone
display, safe-area padding, responsive navigation (bottom tabs on phones,
sidebar from `md`). Offline data modification is **not** in V1 — the service
worker caches only the static shell and always goes to the network for task
state, because showing stale operational data would be worse than showing
none. The fetch-handler structure is where an offline layer would slot in.

---

## Extending

Future modules (inventory, stock, purchase orders, maintenance, …) add their
own tables, a domain folder, and routes. They do not require changes to the
task system. Attachments were deliberately left out of V1 but the schema does
not block them: an `attachments` table keyed on `occurrence_id` drops in
without migration of existing data.

---

# Orders module — Order Control + Lotnummerkontrol

Replaces the duplicate data entry between two workbooks:
`Control de pedidos-Master.xlsx` (monthly order control) and
`Lotnummerkontrol_Master_para_copiar.xlsx` (weekly preparation).

**The order is entered once.** Order Control and Lotnummerkontrol are two
views over the same rows — there is no second copy of order data.

```
customer -> order -> order_line -> lot_allocation
```

| View | Driven by | Grouping |
|---|---|---|
| Order Control (`/orders`) | **delivery** date | day -> customer -> products |
| Lotnummerkontrol (`/preparation`) | **preparation** date | customer -> products |

Preparation defaults to the delivery date and an admin may move it earlier.
Deliver Thursday the 10th, prepare Wednesday the 9th: the order appears in
Lotnummerkontrol on the 9th and in Order Control under the 10th.

## Quantity semantics

A quantity is a **count of packages** of the product's presentation — 9 of
"Tortillas 12cm BIO / 1.75kg Fresco" means nine 1.75 kg packs, not 9 kg. The
weight lives in the presentation and the system never converts between them.
Verified by cross-referencing the same Los Guapos order in both workbooks.

## Rules enforced in the database

- A user may never allocate more than ordered (trigger). An admin may, to
  correct a real-world miscount.
- A short preparation requires an explanation before it counts as resolved.
- Lot numbers are free text — there is deliberately no lot master.
- A user cannot modify any order definition field. The only order-line column
  they can write is the shortfall reason, via a `SECURITY DEFINER` RPC.
- Cancelled orders leave preparation but are kept for the record.
- Customers, products and delivery methods are deactivated, never deleted;
  historical orders keep displaying inactive ones.

## Status model

`draft | confirmed | cancelled` — the minimum the workflow needs. Preparation
progress is **derived** from lot allocations rather than stored, so it cannot
drift out of sync with the actual lot entries.

## Recurring templates

Templates propose **draft** orders for admin review; they never create a
confirmed order. Kept separate from the task recurrence engine on purpose —
an order cadence and an operational task cadence are different concepts.

The 20 templates seeded from the workbook's weekday roster are **inactive**:
a customer appearing on a Wednesday sheet is evidence of a pattern, not proof
that the order recurs. Activate the real ones in Admin -> Recurring orders.

## Seed / import

```bash
npm run orders:extract   # workbooks -> data/orders.seed.json (committed)
npm run orders:seed      # json -> Supabase (idempotent)
```

Imports master data only — 222 customers, 246 product variants, 5 delivery
methods, 20 inactive templates. Historical orders are **not** migrated.

Product codes are not unique in the source (0107, 0026, 0287, 0219 and 0250
are each reused; 8 variants have none), so the code is a label rather than an
identifier and 26 products are flagged **needs review** for an admin to
resolve in Admin -> Products.

## Go-live

```
NEXT_PUBLIC_ORDERS_GO_LIVE=2026-09-01
```

Order Control will not navigate to months before this date, so an empty month
cannot be mistaken for lost data. Set it in `.env` and in Vercel.

## Verification

```bash
npm test                # 58 unit tests incl. 32 for the orders domain
npm run verify:orders   # 35 end-to-end checks against the live database
```

`verify:orders` creates throwaway admin and user accounts, exercises the whole
workflow — including every permission boundary — and deletes everything it
created. It asserts real outcomes by reading data back, not just the absence
of an error.

## Admin manages

| Screen | Purpose |
|---|---|
| Admin -> Customers | add / rename / deactivate |
| Admin -> Products | variants, codes, review flags |
| Admin -> Delivery methods | Planzer, DHL, Zürich, Carlos, factory pickup |
| Admin -> Recurring orders | activate templates, generate draft orders |

---

## Push notifications

Reaches the floor team when the app is closed. Opt-in per device, from the
user menu -> Settings.

**Enabled by the person, not the admin.** A push endpoint is a capability URL
for delivering to someone's device, so RLS restricts every operation to
`user_id = auth.uid()` — even an admin cannot read another user's endpoints.

### What fires

Only unfinished work whose delivery deadline is close. Levels `warning` (6h),
`critical` (2h) and `overdue`; `soon` (24h) deliberately does not notify.
A completed or cancelled order never notifies, however close the deadline.

Each `(order, level)` fires **once**, enforced by a UNIQUE constraint on
`order_notifications`. An order escalating warning -> critical -> overdue
produces exactly three notifications over its life, no matter how often the
scheduler runs. The claim is taken *before* sending, so two concurrent runs
cannot both send; if a send reaches nobody the claim is released again rather
than silently consumed.

### Scheduling

`/api/cron/notify` is **not** in `vercel.json`: a sub-daily cron there fails
the whole build on the Hobby plan (see below). Anything that can issue an
HTTP GET on a schedule will do, as long as it sends
`Authorization: Bearer <CRON_SECRET>`.

Two schedulers are set up in this repo. **Use one, not both** — running both
is harmless, because each `(order, level)` is claimed before sending, but it
doubles the traffic for nothing.

| Option | Where | Status |
|---|---|---|
| Supabase `pg_cron` | `supabase/migrations/*_schedule_delivery_notifications.sql` | **active** — no third party; secrets stay in Vault |
| GitHub Actions | `.github/workflows/notify.yml` | schedule commented out; manual `workflow_dispatch` only |

Both are free. Nothing about Web Push itself costs money — delivery is done
by the browser vendors' push services, and the VAPID keypair is self-issued.

The endpoint **fails closed**: without `CRON_SECRET` set it refuses to run in
production rather than being open to anyone.

### Setup

```bash
npx web-push generate-vapid-keys
```

Put the pair in `.env` and in Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` (Sensitive) and `VAPID_SUBJECT`, plus a `CRON_SECRET`.

**iOS requires the app to be installed to the home screen first** — Safari
does not deliver web push to a normal browser tab. Android and desktop
Chrome/Edge/Firefox work from the tab.

```bash
npm run verify:push   # 19 checks: VAPID, encryption, RLS, dedupe
```

### Scheduling with GitHub Actions (fallback, currently off)

`.github/workflows/notify.yml` can call the notifier every 15 minutes between
05:00 and 20:00 UTC (roughly 06:00–22:00 Zurich year-round). **Its `schedule`
trigger is commented out** — pg_cron drives the notifier now, and two
schedulers hitting the same endpoint is duplication. The workflow still runs
on demand from the Actions tab.

To switch back, uncomment the `schedule:` block and stop the database job with
`select cron.unschedule('delivery-notifications');`.

Add two **repository secrets** under Settings → Secrets and variables →
Actions:

| Secret | Value |
|---|---|
| `APP_URL` | your deployed URL, e.g. `https://operation-manager.vercel.app` |
| `CRON_SECRET` | the same value set in Vercel |

Then run it once by hand from the **Actions** tab (*Delivery notifications* →
*Run workflow*) to confirm the wiring. The response is printed in the run
summary.

The run **fails loudly** on a bad secret or an unreachable app rather than
passing silently, so a broken schedule is visible in the Actions list. Missing
secrets stop the run with an explicit message.

GitHub's scheduler is best-effort and can lag by a few minutes under load. The
urgency thresholds are hours wide, so this does not matter — and because the
endpoint is idempotent, a missed run simply catches up on the next one.

### Scheduling with Supabase pg_cron

`supabase/migrations/20260903230000_schedule_delivery_notifications.sql` does
the same job from inside the database, using `pg_cron` for the schedule and
`pg_net` for the outbound call. Both extensions are free on every Supabase
tier. Prefer this over GitHub Actions if you would rather not depend on a
third party for an operational alert, or want a tighter cadence than GitHub's
best-effort scheduler gives.

The URL and the token are **not** in the migration. They live in Supabase
Vault, so the file stays committable and the token never lands in
`cron.job.command`, which is readable by anyone with cron access. Apply the
migration and then create the two secrets once:

```bash
npm run db:push
```

```sql
-- Supabase dashboard → SQL editor, once:
select vault.create_secret('https://your-app.vercel.app', 'app_url');
select vault.create_secret('<the CRON_SECRET set in Vercel>', 'cron_secret');
```

Until both secrets exist the job runs and no-ops with a notice, rather than
failing every 15 minutes and burying a real error.

Check it is working:

```sql
select * from cron.job where jobname = 'delivery-notifications';
select * from private.notification_runs limit 20;   -- dispatches + HTTP replies
```

`private.notification_runs` joins each dispatch to its pg_net response by
request id. A null `status_code` means the reply has not arrived yet or pg_net
has already pruned it — it keeps responses only a few hours.

To switch back to GitHub Actions, unschedule the job rather than deleting the
migration:

```sql
select cron.unschedule('delivery-notifications');
```

The helper lives in a `private` schema, which `supabase/config.toml` does not
expose through the Data API, so no logged-in user can invoke the notifier as
an RPC.

### Vercel cron and the Hobby plan

`vercel.json` declares **one** cron, `/api/cron/generate`, at `30 3 * * *`.

A sub-daily expression here does **not** get ignored on the Hobby plan — it
**fails the entire build**, so nothing deploys at all:

```
Hobby accounts are limited to daily cron jobs. This cron expression
(*/15 5-20 * * *) would run more than once per day.
```

The 15-minute notification schedule therefore lives in
`.github/workflows/notify.yml` or in Supabase `pg_cron`, not here. Only move it
into `vercel.json` after upgrading to Pro — and note that Hobby is licensed for
non-commercial use, which is the more relevant limit for a production
operations tool.

---

# Inventory module — Bestandkontrolle

Replaces `Bestandkontrolle_Master.xlsx`. The workbook is the **initial source
of configuration only**; from the first migration onward the application is
the source of truth and the file is not needed to run an inventory.

## What the workbook actually contained

All ten sheets were **blank templates**. Verified before any code was written:
not one literal quantity, expiry date, KW or counter name anywhere in the
file, and every `Stock` / `Differenz` formula carried a null cached result.
The five `Masamor-Del Barrio KW` sheets are byte-identical copies of one
another, as are the two `Colectivo Comestibles KW` sheets.

**No historical inventories were imported, because there is no history in the
source to import.** The importer refuses to run against a sheet containing
literal values, so filling one in later cannot silently produce fabricated
counts — that becomes a decision for a person.

## The central distinction

An **inventory template** is the recurring *kind* of count. An **inventory
instance** is one actual count on one date.

```
inventory_templates
  └─ inventory_template_items          what gets counted, and in what order
       ↓  (materialised, with names frozen)
inventory_instances                    ONE count, ONE date
  └─ inventory_instance_items          one counted line
       └─ inventory_entries            quantity / expiry / lot / location
```

`UNIQUE(template_id, inventory_date)` is the core invariant: KW 37, KW 38 and
KW 39 are three permanent, separate records. No generation run, template edit
or item deactivation can overwrite or remove one.

## The five inventory types

| Template | Cadence | Entry type | Inventory Digital | Items |
|---|---|---|---|---|
| Masamor / Del Barrio | weekly, Friday | quantity + expiry | **on** | 114 |
| Colectivo Comestibles | 2nd **and** last Thursday | quantity + expiry | **on** | 145 |
| Materia Prima | last Thursday | quantity + lot + expiry | off | 7 |
| Empaques (mensual) | last Thursday | quantity per location | off | 26 |
| Empaques (semestral) | 30 Jun / 31 Dec | quantity per location | off | 26 |

Colectivo is the case a single monthly rule cannot express, which is why the
inventory schedule carries a **list** of monthly rules rather than one. The
semiannual dates move to the preceding Friday at a weekend, reusing
`shiftWeekendToPrecedingFriday` from the task recurrence engine — there is one
implementation of that rule in the codebase, not two.

Every one of these is a row an admin can change. Nothing about the cadence,
the entry type or the Inventory Digital switch is hard-coded.

## Inventory Digital

The workbook column `Bexio` is called **Inventory Digital** everywhere in the
schema and the UI. **There is no Bexio integration and none is implied** — an
admin types the value in by hand.

* `NULL` renders as **Inventory Digital: Pending**, never as `0`.
* `Difference = Physical Stock − Inventory Digital`, and is `NULL` whenever
  there is nothing to compare against. A pending item never shows a
  difference, because showing `0` there is the one genuinely misleading thing
  this screen could do.
* When a template has Inventory Digital off, no value is asked for, no
  difference is calculated, and no pending state exists.

## Physical Stock is derived, never typed

`physical_stock` is maintained by trigger as the sum of the entries;
`difference` is a **generated column** over it. No role has a policy that
permits writing either, and the trigger overwrites anything that gets in. A
client cannot state a total.

Unlimited entries per item. Duplicate expiry dates are kept as separate
records and never merged: `10 → 15.09` and `5 → 15.09` are two things somebody
counted in two places.

Quantities are **integers**. Decimals are rejected rather than rounded — a
`0.5` in a count of boxes means the counter meant something the system cannot
represent. Zero is allowed and is a real count; `NULL` means *not counted*,
which is a different statement.

## Status model

Four statuses: **In progress**, **Completed**, **To review**, **Resolved**.
"Inventory Digital: Pending" is deliberately *not* a fifth — it is an
orthogonal condition that coexists with a status.

```
difference = 0   → Completed
difference ≠ 0   → To review
admin resolves   → Resolved   (the difference may remain non-zero)
```

A resolution **requires a reason** and freezes the numbers it was given for.
Changing Inventory Digital afterwards reopens the item and marks the old
resolution *superseded* — it is never deleted. Every value ever entered is
kept in `inventory_digital_history` with both differences, who and when.

## Who may edit, and when

Enforced by `public.inventory_can_edit(instance_id)`, the single function both
RLS and the server actions consult:

| | may edit |
|---|---|
| admin | always |
| holder of an active temporary grant | yes — overrides assignment *and* deadline |
| assigned user, inventory open, before 18:00 on the inventory date | yes |
| anyone else | no |

The **18:00 deadline** is computed in `Europe/Zurich`, so it is 18:00 local on
both sides of a daylight-saving change. Unassigned users can read but not
write. None of this depends on hiding buttons.

**Temporary permissions** may not span more than one day and expire by
ceasing to match the predicate — there is no cleanup job that can fail to run.
A grant requested "from now" is clamped to the *database* clock: a browser
running a second fast previously produced a grant that was briefly inert.

## Audit trail

`inventory_audit_log` records inventory creation, assignment, every entry
insert/update/delete with before and after values, Inventory Digital changes,
status changes, resolutions, completion and permission grants — each with an
actor and a timestamp. Admin-readable only. Comments have no DELETE policy at
all: they are part of the record of a count.

## History survives everything

Instances freeze the template name, entry type and Inventory Digital setting;
items freeze their name, group and ordering; location entries freeze the
location name. Renaming a template, deactivating an item or renaming a
location therefore cannot rewrite what an old count says it counted. A
deactivated item disappears from *newly generated* inventories and stays fully
visible in every one that already counted it.

## Product master integration

`inventory_template_items.product_id` is **optional**, and that is the point:
raw materials, packaging and internal materials are legitimately not
commercial products, and forcing them into the catalogue would corrupt it.

The importer links **exact normalised name matches only** — 57 of 318 items.
The other 261 are imported as independent inventory items with `product_id`
NULL, for an admin to link by hand. Fuzzy matching was deliberately not used:
it would write wrong links into an audit record. No product row is ever
created or edited by the inventory importer.

## Orders integration

Deliberately none yet. No automatic stock deduction and no order calculation.
The schema carries `product_id` on both template and instance items so that
can be added later without rebuilding anything.

## Seed / import

```bash
npm run inventory:extract   # xlsx -> data/inventory.seed.json  (committed)
npm run inventory:seed      # json -> Supabase                  (idempotent)
```

Re-running never resets an admin's later edits to a schedule or to the
Inventory Digital switch, and never overwrites a product link set by hand. An
item that leaves the workbook is deactivated, never deleted.

## Scheduling and notifications

Inventories are materialised by the **existing** `/api/cron/generate` job
alongside task occurrences — one scheduler, not two — and on demand when the
inventory or dashboard screen loads. Generation is idempotent.

Alerts ride the **existing** web-push infrastructure through
`/api/cron/notify`: assigned today, deadline approaching, completed, Inventory
Digital pending, differences to review. Each `(inventory, kind)` is claimed
before sending, so an alert fires once. An unassigned inventory notifies
nobody. No email.

## Verification

```bash
npm run verify:inventory
```

89 checks against the live database, run as **real signed-in users through the
anon key**, so what is exercised is the path a browser takes: RLS actually
stopping an unassigned user, the 18:00 deadline, temporary permissions
starting and then stopping, derived stock resisting a client write, the
difference/status/resolution/history rules, and that the five imported
templates carry no fabricated instances. It creates three throwaway accounts
and a throwaway template, and removes them again.
