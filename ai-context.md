# PEWOSA SACCO — engineering context

Reference document for anyone (human or AI) working on this codebase. It describes what is actually
here, not what was once planned.

## 1. What this is

A multi-tenant web application for running Ugandan SACCOs (savings and credit cooperatives). Each
SACCO is a tenant, identified by a unique **group code**. Members make weekly contributions split
across three funds, request and repay loans, and are fined for missing meetings. Admins verify
contributions, approve loans, run attendance, and distribute annual dividends.

Real money is tracked, so auditability and authorization are the primary design constraints.

## 2. Stack

- Next.js 16 (App Router, Turbopack), React 19
- Supabase — Postgres, Auth, Row Level Security, `SECURITY DEFINER` RPCs
- TypeScript for pages/types, JSX for most components (`strict: false`)
- Plain CSS, one file per component/page in `src/styles/`; Font Awesome and Inter via CDN in `layout.tsx`
- `jspdf` + `jspdf-autotable` for PDF report exports
- Deployed on Vercel

There is no state-management library, no CSS framework, and no test suite.

## 3. Commands

```bash
npm run dev     # dev server on port 3001
npm run build   # production build + full TypeScript check
npm run start   # serve the build
npm run lint    # ESLint over .js/.jsx
```

`npm run build` is the real gate — it type-checks the entire project. ESLint only covers `.js`/`.jsx`
(there is no TypeScript ESLint parser installed) and currently reports pre-existing unused-variable
and hook-ordering issues.

## 4. Layout

```
src/
  app/                    App Router. Folder = URL, page.tsx = entry point.
    api/                  Server route handlers. All privileged DB work lives here.
  Components/             Reusable UI. Mostly "use client".
  views/                  Page-level compositions that app/*/page.tsx renders.
  layout/                 AdminLayout / MemberLayout shells + global CSS.
  context/                Sidebar provider, toast provider.
  styles/                 One CSS file per component or page.
  types/                  sacco.ts — shared domain types.
  utils/                  meetingDateUtils.js, pdfExportUtils.js, subscriptionPlans.js
  supabaseClient.ts       Browser client, anon key only.
supabase/migrations/      Hand-applied SQL. See its README.
```

**Imports are extensionless** (`from "../../views/SignUp"`). Next resolves `.tsx` before `.jsx`, so
never let a `.jsx` and `.tsx` of the same name coexist — the `.jsx` becomes invisible dead code.

## 5. Routes

| Route | Audience | Notes |
|-------|----------|-------|
| `/`, `/home`, `/intro` | Public | Landing |
| `/onboarding` | Public | Explainer steps |
| `/signup` | Public | Member joins an existing SACCO by group code |
| `/register-sacco` | Public | Admin creates a new SACCO |
| `/login` | Public | Routes to `/admin` or `/dashboard` by role |
| `/dashboard` | Member | Summary cards, progress, contribution heatmap |
| `/savings`, `/payments`, `/transactions`, `/loans`, `/members`, `/settings` | Member | |
| `/admin` | Admin | Tabs via `?tab=`: overview, verifications, members, dividends, payments, settings |
| `/developer` | Platform operator | Cross-tenant console, gated by `PLATFORM_ADMIN_EMAILS` |

`Components/ProtectedRoute.tsx` wraps authenticated pages: it requires a session, redirects
non-admins away from `/admin`, and sends users with no SACCO membership to `/signup?orphan=1`.

It is also the only place that enforces two revocations the auth session cannot express:

- **Deleted account.** `getSession()` reads the cached JWT and makes no network call, so it
  keeps succeeding for the token's full lifetime after the account is gone. A `getUser()`
  call revalidates against the auth server; a 401/403 signs the user out to
  `/login?removed=1`. Other errors are ignored so an offline user is not ejected.
- **Unapproved member.** `set_member_approval` writes `profiles.status = 'pending'` and
  leaves the auth account intact, so `status` is the only signal. Any value other than
  `active` renders the `MembershipRevoked` lockout instead of the page. Re-checked on tab
  focus so a member revoked mid-session does not keep a live dashboard.

## 6. API routes

Every handler except `/api/register-sacco` requires an `Authorization: Bearer <supabase access
token>` header and resolves the caller with `supabase.auth.getUser()`.

| Route | Verbs | Authorization |
|-------|-------|---------------|
| `/api/profile` | GET, POST | Own profile only |
| `/api/group-members` | GET | Members of the caller's own SACCO |
| `/api/user-balances` | GET | Own account balances |
| `/api/sacco-balances` | GET | Via `get_sacco_total_balances` RPC |
| `/api/user-transactions` | GET, POST | Own transactions; POST logs pending contributions |
| `/api/contribution-habits` | GET | Own data; `?memberId=` requires admin/loan_officer of that member's SACCO |
| `/api/loans` | GET, POST, PATCH | Own loan; POST calls `request_loan` / `record_loan_repayment`; PATCH is staff-only (`confirm_fee`, `apply_late_fees`) |
| `/api/loans/guarantors` | GET, POST | Nominate only for own loan; respond only if you are the nominated guarantor |
| `/api/user-vaults` | GET, POST | Own vaults; client-supplied `profile_id` is ignored |
| `/api/sacco-settings` | GET, POST | GET is public; POST requires SACCO admin |
| `/api/dues` | GET | Outstanding weekly mandatory funds. Scoped by RLS — a member gets their own row, staff get one per member |
| `/api/admin/join-dates` | POST | Admin — sets `profiles.joined_on` for one member, or fills every blank at once |
| `/api/admin/dividends` | GET, POST | Admin of the target SACCO |
| `/api/admin/manual-contribution` | POST | Admin — backfills historical contributions/loans |
| `/api/admin/fines` | GET, POST, PATCH | Admin/loan officer — list, levy, collect, waive. The only write path for fines |
| `/api/subscription-plans` | GET | Public — the price list, served from `utils/subscriptionPlans.js` |
| `/api/subscription-checkout` | POST | SACCO admin — records a plan request; takes no payment and activates nothing |
| `/api/register-sacco` | POST | Unauthenticated by design (signup entry point) |
| `/api/platform` | GET, POST | Email must be in `PLATFORM_ADMIN_EMAILS` |

`sacco-settings/route.js` also exports `getActiveSaccoSettings()`, imported directly by
`contribution-habits` and `dues`. It falls back to a local `settings.json` file when no database row
exists — that fallback is a development convenience and is not reliable on serverless.

## 7. Data model

| Table | Purpose |
|-------|---------|
| `profiles` | One row per auth user. Holds `role` (`member`/`loan_officer`/`admin`), `group_id` (the SACCO's group code), `member_number`, and `joined_on` — the date an admin states the member joined the SACCO, which is what arrears are counted from. NULL means not stated. Distinct from `sacco_memberships.joined_at` and from `created_at`, both of which record when the row/account was made — for a backfilled SACCO that is the day everyone was typed in, not the day they joined. |
| `saccos` | Tenants. `group_code` unique, `admin_profile_id`, fund defaults, `week_anchor_date`, `current_week`. |
| `sacco_memberships` | Join table, and **the authoritative source for role checks**. |
| `accounts` | One row per member per `account_type`: savings, shares, development_fund, social_fund, fines, loan. Holds the balance. |
| `transactions` | Immutable ledger + approval queue. `status`: pending → completed/rejected. |
| `loans` | Loan lifecycle, `outstanding_balance`, `guarantor_status`. |
| `loan_repayments` | Repayment records against a loan. |
| `sacco_settings` | Per-SACCO share price, fund amounts, meeting day, and `week_anchor_date` — the meeting date that is Week 1 of the current 52-week cycle. The active week is **derived** from it on every read (migration 0030), so it advances by itself each meeting day; `current_week` is only a cache of that value for callers reading the table directly. A NULL anchor means the SACCO never finished historical onboarding and `current_week` is a number an admin typed. |
| `audit_events` | General event log. Also carries **broadcasts** (`entity_type='broadcast'`) and **attendance snapshots** (`entity_type='sacco_attendance'`). |
| `dividend_cycles` / `dividend_allocations` | Annual dividend runs and per-member payouts. |
| `savings_vaults` | Member goal-based savings ("piggybanks"). |
| `loan_guarantors` | Peer sign-off requests for a loan. |

Note that `profiles.group_id` stores a **group code string**, while most tables key off `sacco_id`
(a UUID). Resolving one to the other via `saccos.group_code` is a very common pattern in this code.

### Fund pools

Four pools, each with a fixed colour used consistently in the UI:

| Fund | Category | Colour |
|------|----------|--------|
| Shares | `shares` | `#253b8e` |
| Development fund | `development_fund` | `#10b981` |
| Social fund (mandatory weekly **minimum**; a member may give more) | `social_fund` | `#ef4444` |
| Fines (collected penalties) | `fines` | `#8b5cf6` |
| Aggregate | — | `#f59e0b` |

The first three are contributions. **Fines are not**, and the distinction is load-bearing:

- A fine is levied by staff, never declared by the member, so it never enters the
  Contribution Approvals queue or its dashboard counter.
- Fines count toward the **SACCO's** total capital (the group holds that cash) but never
  toward a **member's** — a penalty is not a stake, and dividends are share-proportional
  regardless.
- **Absence is not a general fine.** `transactions.fine_type` separates `'absenteeism'`,
  owned end to end by the attendance engine, from every other reason, owned by
  `MemberFinesManager`. They share one pool because the money is real either way and has
  to sit somewhere; every column, banner and total a human reads keeps them apart. The
  weekly report and the PDF each carry an **Absent** column and a separate **Fines** one.

### Weekly mandatory funds and arrears

Development fund and social fund are owed **every meeting week**, by every member, from
`sacco_settings.devt_fund` / `social_fund`. Shares are not (1–10, the member's choice) and fines are
not (levied for a reason, not on a schedule) — those two funds are the only ones that can fall into
arrears.

The two differ in one respect: **`social_fund` is a minimum, not a fixed figure.** A member meets the
week by giving that amount or any amount above it, and the surplus is credited in full; anything
below it is refused by both `WeeklyContributions` and the `POST /api/user-transactions` route, which
re-checks the floor because the form is not the only way to reach it. The admin **manual
contribution log deliberately does not enforce this** — it only warns — because a backfill has to be
able to record a week a member genuinely came up short. Note that a surplus feeds the running total
below, so giving extra in one week does reduce what is expected in later ones.

Arrears are **derived on every read, never stored** — `src/utils/duesEngine.js` is the single
definition, served by `/api/dues` and rendered by `MemberDuesCard` (admin) and
`MemberDuesAlertBanner` (member). There is no scheduler in this app to write a "week passed" row
each meeting day, and a derived number self-heals: backfill a record that was missing and the
shortfall corrects itself on the next load. Three rules decide the figures:

- Counting starts at `profiles.joined_on` — the date an admin **states** the member joined (migration
  0031). Without one it falls back to the member's **own earliest record**, so a late joiner is not
  charged for weeks before they existed in the group; and with neither, to the SACCO's Week 1. The
  row carries `startSource` (`stated` / `first_record` / `assumed`) and every surface labels the last
  two as inference. The first-record rule exists because it never falsely accuses, but it cannot tell
  *"joined in week 20"* from *"was here since week 1 and paid nothing until week 20"* — stating the
  join date is what closes that, and the Members tab has a one-click bulk setter for cohort SACCOs.
- Payments are a **running total**, not judged week by week, so a lump-sum catch-up clears the weeks
  it covers.
- The **current, in-progress week is excluded** from what is expected but included in what was paid.

The arithmetic works in date differences, never in `week_number`: cycle week numbers wrap at 52, so
a SACCO with three years of history has three separate rows numbered "week 7". It therefore does not
depend on migration 0030 — the anchor is only the fallback start.

`devt_fund` / `social_fund` are **current-rate only**; there is no history of past rates, so changing
the weekly amount re-prices the whole backlog. There is also no way to waive a due — the only way to
clear one is to record a payment.

## 8. Database functions

All are `SECURITY DEFINER`, meaning **they bypass RLS** and must therefore check `auth.uid()`
themselves. Migration `0015` added those checks; do not remove them.

- `register_new_sacco` — requires `auth.uid() = p_admin_profile_id`; refuses to reassign a SACCO that already has a different admin.
- `process_transaction` — creates a pending transaction for the caller.
- `approve_member_transaction` / `reject_member_transaction` (aliased as `approve_transaction` / `reject_transaction`) — admin or loan officer **of that transaction's SACCO**.
- `request_loan` — creates the loan, its guarantor rows and its application fee for the caller, in one call. Enforces the SACCO's guarantor minimum and one open loan per member.
- `confirm_loan_application_fee`, `apply_loan_late_fees` — staff of that loan's SACCO. `record_loan_repayment` — the borrower only.
- `process_guarantor_response` — only the nominated guarantor may respond.
- `calculate_dividend_preview` / `execute_dividend_payout` — admin of the target SACCO only.
- `get_sacco_total_balances` — self, or staff of that member's SACCO. Sums the four pools.
- `levy_member_fine` / `waive_member_fine` — staff of the target member's SACCO, via `is_sacco_staff`. `0022` retired the browser-side fine INSERT policy in favour of these.
- `set_member_approval`, `make_member_admin`, `delete_member_entirely`, `demote_sacco_admin` — existing admin of the same SACCO, resolved by the shared `admin_sacco_for_member` helper. These four back the buttons on the admin Members tab. You cannot unapprove, delete or demote yourself.
- `set_member_join_date` / `set_all_member_join_dates` — write `profiles.joined_on`. The first is guarded by `admin_sacco_for_member`; the second is admin-only (not staff — it re-bases every member's arrears at once) and fills blanks only, so re-running it never undoes a correction.

**The SACCO owner** is `saccos.admin_profile_id`, the account that created the group. Any admin may
promote a member, but only the owner may `demote_sacco_admin`, and the owner cannot themselves be
demoted, unapproved or deleted by anyone else. Without that asymmetry a freshly promoted admin could
remove the founder and take the group over. Demotion also refuses to remove the last admin. When
`admin_profile_id` is `NULL` — deleting the owner clears it, and pre-0009 SACCOs never set it — any
admin may demote, or those groups could never demote at all; the admin Members tab mirrors that
fallback so it never offers a button the database would reject.

Triggers: `handle_new_user` (on `auth.users`, creates the profile — always as `member`),
`initialize_member_accounts`, `sync_transaction_full_name`, `sync_loan_on_transaction_approval`,
and the `sacco_memberships` name-sync triggers.

## 9. Core workflows

**Contribution.** Member submits amounts per fund with a payment reference → row in `transactions`
with `status='pending'` → admin sees it in the verifications queue → approval calls
`approve_member_transaction`, which updates `accounts.balance` and marks the transaction completed.
Balances are never written from the browser.

**Loan.** Member checks eligibility (derived from savings) and submits a request naming **at least
`saccos.loan_min_guarantors` guarantors** (default 3) — `request_loan` creates the loan, its
guarantor rows and the application-fee charge in one call, and rejects the request outright if
there are too few or if any nominee is not a member of the same SACCO.

```
pending_fee → pending_guarantors → pending → issued → completed
     |               |                |
admin confirms   all guarantors   admin approves
the fee          approve          the disbursement
```

The **application fee** is a flat per-application amount (`saccos.loan_application_fee`), raised as
a pending `category='fee'` transaction and confirmed by `confirm_loan_application_fee`. It is
marked collected directly rather than through `approve_member_transaction`, which would look for a
non-existent `fee` account type. Fines and fees are both kept out of the Contribution Approvals
queue for that reason.

**Repayment is by installment.** `record_loan_repayment` creates a pending `loan_repayment`
transaction (capped at outstanding minus anything already submitted but unapproved); approving it
runs through `sync_loan_on_transaction_approval`, which is the single place that reduces
`outstanding_balance`, writes the `loan_repayments` row, and closes the loan at zero.
`loans.total_repayable` fixes principal-plus-interest when the loan is requested, so a later
settings change cannot re-price an agreed loan.

**Overdue loans** are charged a flat amount per whole month past `due_date`
(`saccos.loan_late_fee_amount`) by `apply_loan_late_fees`, levied as a fine of type
`'loan_default'` so it lands in the fines pool. `loans.late_fee_months_charged` makes it
idempotent — re-running it never double-charges.

**Attendance.** Admin records presence per member for a meeting week. Absentees get a pending
`category='fines'` transaction, `direction='credit'` — the pool grows when the fine is collected,
and the debt while it is unpaid is carried by the `pending` status, not by a negative balance
(`accounts.balance` is constrained non-negative). Collecting one goes through
`approve_member_transaction` like any other transaction, which is what moves the money into the
member's `fines` account. A snapshot is written to `audit_events`.

Fines are deliberately excluded from the Contribution Approvals queue and its dashboard counter:
they are pending, but nobody is claiming to have paid them, so they are not contributions to
verify. Migration `0021` is what made any of this storable — see the migrations README.

**Other fines.** `MemberFinesManager` on the admin dashboard issues late-arrival and any other
penalty through `/api/admin/fines`, which is the only write path for fines of any kind — the
attendance engine posts to it too. Behind it are `levy_member_fine` and `waive_member_fine`;
collecting reuses `approve_member_transaction`. Waiving marks the row `rejected` and records who
and why, never deleting it.

**Subscription.** The payments section (member `/payments`, admin `?tab=payments`) renders the
three plans from `src/utils/subscriptionPlans.js` — Basic (free, onboarding month), Standard
(UGX 60,000/month, discounted from 75,000) and Premium (UGX 200,000 per 3 months). A card links
to `/payments/checkout?plan=<id>`, which collects MTN Mobile Money or Airtel Money plus a number.

**No collection gateway is wired up.** Checkout records an `audit_events` row
(`entity_type='subscription_payment_intent'`) with a reference and returns it; a platform
operator confirms activation. It deliberately does not touch `saccos.subscription_plan` —
migration `0016` revoked the tenant admin's UPDATE grant on every subscription column so a SACCO
cannot promote itself, and `'standard'` is not in that column's CHECK constraint anyway. The
amount is read from the catalogue by plan id and never from the request body.

**Dividends.** Admin enters a profit pool → preview shows each member's share-proportional payout →
executing writes a `dividend_cycles` row, per-member `dividend_allocations`, credits accounts, and
logs completed `dividend` transactions.

## 10. Security invariants

These are load-bearing. Breaking one re-opens a vulnerability that was specifically fixed:

1. **The browser only holds the anon key.** RLS is the protection boundary.
2. **`SUPABASE_SERVICE_ROLE_KEY` is read only inside `src/app/api/`.** It bypasses RLS completely.
3. **Never trust identity from the request.** A `profile_id` in a query string or body is ignored;
   use the ID from the verified token. Pass it explicitly only for staff-viewing-a-member reads, and
   authorize that case separately.
4. **Forward the caller's JWT into RPCs** that check `auth.uid()` — construct a client with the
   caller's token rather than using the service-role client, or `auth.uid()` is `NULL` inside the
   function and its authorization check cannot run.
5. **No direct client writes to `accounts`, `transactions` status, or `loans`.** Those go through
   RPCs. RLS deliberately grants no write policy on `accounts`.
6. **`role` is never accepted from client input.** Signup always creates a `member`. Elevation
   happens only through `register_new_sacco` (self, at SACCO creation) or `make_member_admin`;
   the only way back down is `demote_sacco_admin`, which the SACCO owner alone may call.
7. **`transactions` is an audit trail.** Reverse with a new entry; don't rewrite history.

## 11. Migrations

`supabase/migrations/`, applied by hand in the Supabase SQL Editor — there is no migration tool.
Read [that README](supabase/migrations/README.md) before touching the database: files 0003, 0007,
0009 and 0010 deliberately leave the database wide open, and only 0015 reverses that. `0015` is
idempotent and is the authority for all RLS policies and function definitions, except the
`sacco_memberships` / `transactions` / `loans` policies, which `0019` supersedes.

An RLS policy on `sacco_memberships` may never query `sacco_memberships` — that is what caused the
`infinite recursion detected in policy` failures 0019 fixes. Ask the role question through
`is_sacco_member` / `is_sacco_staff` / `is_sacco_admin` / `can_transact_in_sacco` instead; they are
`SECURITY DEFINER`, so the lookup runs outside RLS. Prefer them in other tables' policies too.

New migrations go in the same folder as `00NN_YYYYMMDD_description.sql` and must be safely
re-runnable.

Live counters across the app use `supabase.channel(...).on('postgres_changes', ...)`. Those only
fire for tables in the `supabase_realtime` publication — `0020` is what puts them there. A
subscription on an unpublished table reports `SUBSCRIBED` and then silently never delivers, so if
a number stops updating without a reload, check the publication before the component.

## 12. Environment variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key for the browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS; API routes only |
| `PLATFORM_ADMIN_EMAILS` | **Server only** | Comma-separated allow-list for `/developer` |
| `NEXT_PUBLIC_SITE_URL` | Public, optional | Canonical URL for Open Graph tags |
| `VERCEL_URL` | Auto | Provided by Vercel; used as the OG fallback |

Legacy `VITE_*` variants are still read as fallbacks in some files, left over from a Vite era.

## 13. Known gaps

- No automated tests and no CI. `npm run build` is the only gate.
- ESLint reports pre-existing unused-variable and hook-ordering issues; `.ts`/`.tsx` are not linted.
- `audit_events` doubles as the broadcast and attendance-snapshot store rather than having
  purpose-built tables.
- Broadcast read state and member avatars are partly kept in `localStorage`, so they don't follow a
  user across devices.
- The `settings.json` file fallback in `sacco-settings` won't persist on serverless.
- `sacco_settings` and `saccos` both carry fund/week values and are written together; they can drift.
- `current_week` on both tables is a cache of a derived value, not a setting. Only
  `finalize_historical_onboarding` and `start_new_sacco_cycle` may move it; read the week through
  `/api/sacco-settings` (or `sacco_active_week()` in SQL), never from the column.
- Loan interest is a flat rate applied in application code, not amortised in the database.

## 14. Working notes

- Check whether a component reads from an API route, the browser Supabase client, or props before
  refactoring — all three patterns are in use.
- When adding a privileged endpoint, copy the pattern in `src/app/api/admin/dividends/route.js`:
  verify the token, verify the caller's role against the target SACCO, then act.
- Any schema or policy change needs a migration file alongside the code, plus an update to the
  supersession table in the migrations README if it redefines an existing policy or function.
- Keep UI operational rather than marketing-style: readable tables, obvious statuses, confirmation
  on destructive or financial actions, and explicit loading/empty/error states.
- Amounts are UGX throughout.
