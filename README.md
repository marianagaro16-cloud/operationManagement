# Operation Manager

Operations management backend built on [Supabase](https://supabase.com).

## Stack

- **Database:** Supabase (hosted Postgres)
- **Schema management:** Supabase CLI migrations, versioned in `supabase/migrations/`

## Schema

| Table | Purpose |
|---|---|
| `profiles` | App-level user data, mirrors `auth.users`, auto-created on signup |
| `clients` | Client records with contact details |
| `projects` | Projects, optionally linked to a client, with status and dates |
| `tasks` | Tasks belonging to a project, with status, priority and assignee |

Row Level Security is enabled on every table. Current model: any authenticated
user can read; writes are limited to the record owner/creator, plus task
assignees on their own tasks.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your values
```

Environment variables are documented in `.env.example`. The CLI ones
(`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) are local-only and must never
be added to a deployment.

## Working with the database

```bash
npm run db:link                    # link to the remote project
npm run db:migration <name>        # create a new migration file
npm run db:push                    # apply migrations to the remote
npm run db:pull                    # pull remote schema into a migration
npm run db:diff                    # diff local vs remote schema
```

Regenerate TypeScript types after a schema change:

```bash
npx supabase gen types typescript --linked > src/types/database.types.ts
```
