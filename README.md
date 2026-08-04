# PEWOSA SACCO

A web application for running a Ugandan SACCO (Savings and Credit Cooperative Organisation).
Members log weekly share, development-fund and social-fund contributions; admins verify and approve
them; the app tracks savings balances, loans and repayments, meeting attendance and fines, annual
dividend distribution, and peer-guaranteed loan approvals.

## Stack

- **Next.js 16** (App Router, Turbopack) with **React 19**
- **Supabase** — Postgres, Auth, and Row Level Security
- **TypeScript** for pages and shared types; JSX for most components
- Plain CSS, one file per component/page under `src/styles/`
- `jspdf` + `jspdf-autotable` for report exports
- Deployed on **Vercel**

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3001> (note: port 3001, not the Next.js default).

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Development server on port 3001 |
| `npm run build` | Production build; also runs a full TypeScript check |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint over the `.js`/`.jsx` sources |
| `npm run check:secrets` | Scan staged changes for credentials; add `-- --all` for every tracked file |
| `npm run setup:hooks` | Enable the pre-commit secret guard — run once per clone |

## Environment

Copy [`.env.example`](.env.example) to `.env` and fill in real values:

```env
# Public — safe to expose to the browser
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# Server-only — must never be exposed to the browser
SUPABASE_SERVICE_ROLE_KEY=<service role key>
PLATFORM_ADMIN_EMAILS=you@example.com
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely. It is read only inside API route
handlers under `src/app/api/`, never in a component. `PLATFORM_ADMIN_EMAILS` is a comma-separated
allow-list controlling who can use the `/developer` platform console.

`NEXT_PUBLIC_SITE_URL` is optional — it sets the canonical URL used for Open Graph tags. Vercel
provides `VERCEL_URL` automatically, so this is only needed for a custom domain.

### Handling secrets

`.env` and every `.env.*` variant are gitignored; `.env.example` is the only one committed and it
holds placeholders. `scratch/` is gitignored in full — throwaway scripts there must still read
credentials from `process.env`, never from a literal, so that re-adding one can never leak.

Two guards enforce this, because the first one is bypassable:

```bash
npm run setup:hooks   # once per clone — points core.hooksPath at .githooks/
```

That installs a pre-commit hook running [`scripts/check-secrets.mjs`](scripts/check-secrets.mjs)
over staged content. CI runs the same scanner across every tracked file plus gitleaks across the
full history, so a commit made with `--no-verify`, or in a clone where nobody ran `setup:hooks`,
still fails the build.

If a credential does reach a commit, **rotate it first** — it should be treated as public from
that moment, and rewriting history does not un-publish what was already fetched or indexed.

## Database

Schema and policies live in [`supabase/migrations/`](supabase/migrations/), applied by hand through
the Supabase SQL Editor. There is no migration tool. See
[the migrations README](supabase/migrations/README.md) for the correct order and which files are
superseded — **this matters**, because several mid-sequence files intentionally leave the database
wide open and only the final migration reverses that.

For an existing database, migration `0015_20260802_security-hardening.sql` is idempotent and brings
it fully up to date on its own.

## How the app is organised

```
src/
  app/            Routes (App Router). Each folder is a URL; page.tsx is the entry.
    api/          Server-side route handlers — all privileged database work happens here
  Components/     Reusable UI, mostly client components
  views/          Page-level compositions rendered by app/*/page.tsx
  layout/         Admin and member shells
  context/        Sidebar and toast providers
  styles/         One CSS file per component or page
  utils/          Meeting-date maths, PDF export helpers
  supabaseClient.ts   Browser Supabase client (anon key)
supabase/migrations/  SQL, applied manually
```

### Routes

Public: `/` `/home` `/intro` `/onboarding` `/login` `/signup` `/register-sacco`

Member (requires sign-in): `/dashboard` `/savings` `/loans` `/payments` `/transactions` `/members`
`/settings`

Admin: `/admin` — tabbed into overview, verifications, members, dividends, payments and settings.

Platform operator: `/developer` — cross-tenant console, gated by `PLATFORM_ADMIN_EMAILS`.

## Security model

Money is involved, so a few rules are non-negotiable:

- **The browser only ever holds the anon key.** Row Level Security is what protects the data.
- **Balances are never written directly from the client.** Every balance change goes through a
  `SECURITY DEFINER` Postgres function that re-checks the caller's identity with `auth.uid()`.
- **API routes never trust client-supplied identity.** A `profile_id` in a request body is ignored;
  the authenticated user's ID from the `Authorization: Bearer` token is used instead.
- **RPCs are called with the caller's JWT forwarded**, not with the service-role key, so
  `auth.uid()` resolves correctly inside the function and its authorization check actually runs.
- **`transactions` is an audit trail.** Correct mistakes with reversing entries; don't edit history.

Amounts are displayed in UGX throughout.

## Contributing notes

- Match the existing structure: a route in `src/app/`, its composition in `src/views/`, its pieces
  in `src/Components/`, its styling in `src/styles/`.
- New database work needs a migration in `supabase/migrations/` alongside the code change, written
  to be safely re-runnable.
- Run `npm run build` before pushing — it type-checks the whole project.
