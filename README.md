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
The recurrence engine turns a definition into *occurrences* — one per
recurrence period ("… — week of 2026-09-07"). Users act on occurrences;
only admins edit definitions. Editing or deactivating a definition never
alters or removes past occurrences.

```
Task definition  ->  Recurrence engine  ->  Task occurrence  ->  Dashboard
   (admin)            (src/domain)          (period_key)          (user)
```

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

`period_key` is the mechanism enforcing *one requirement per period*, backed
by `UNIQUE(task_id, period_key)` — the guarantee survives concurrent writers
and repeated generation.

| Frequency | period_key | Default schedule |
|---|---|---|
| daily | `2026-09-01` | every day (weekday restriction optional) |
| weekly | `2026-W36` (ISO week) | Tuesday; admin may change |
| biweekly | `BW-2026-09-08` | anchor + 14n — **no default, must be configured** |
| monthly | `2026-09` | last Thursday |
| semiannual | `2026-H2` | 30 June + 31 December |

**Weekly completion window:** a weekly task has one requirement per ISO week,
not an immutable Thursday requirement. Completing it on Tuesday resolves the
week; Thursday raises nothing further.

**Overrides:** `task_occurrences.due_date_override` moves a single occurrence
without touching the rule that produced it.

**Never invented:** a task whose schedule cannot be resolved generates
nothing and is surfaced to admins as *"Scheduling configuration required"*
with a direct link to fix it.

---

## Security

RLS is the boundary; frontend role checks are cosmetic.

- `profiles` — read own always (so a pending user learns they are pending);
  approved users read the team; only admins write role/status.
- `tasks`, `categories` — approved users read; only admins write.
- `task_occurrences` — approved users read. **No direct UPDATE for users.**
- `task_comments` — approved read; insert only as yourself.

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
| `/calendar` | approved | month grid of occurrences |
| `/admin` | admin | config health + pending approvals |
| `/admin/tasks` | admin | definitions, frequency-adaptive schedule editor |
| `/admin/users` | admin | approve / reject / deactivate, role changes |
| `/admin/history` | admin | occurrence record (rolling 180 days) |
| `/admin/statistics` | admin | completion by day/week/month/year, user, category, frequency |
| `/admin/settings` | admin | manual occurrence generation |
| `/api/cron/generate` | cron secret | nightly occurrence materialisation |

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
| `CRON_SECRET` | Vercel | Vercel Cron sends `Authorization: Bearer <value>` |
| `SUPABASE_ACCESS_TOKEN` | **local CLI only** | account-wide; never deploy |
| `SUPABASE_DB_PASSWORD` | **local CLI only** | never deploy |

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

`/api/cron/notify` is listed in `vercel.json` at `*/15 5-20 * * *`.

**Vercel's Hobby plan runs crons once daily**, so on Hobby that schedule is
not honoured. For a useful cadence, point an external scheduler
(cron-job.org, GitHub Actions, Upstash QStash) at the endpoint every 15
minutes with the header `Authorization: Bearer <CRON_SECRET>`.

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
