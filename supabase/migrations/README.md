# Supabase migrations

There is no migration tool wired up to this project. Every file here is applied **by hand**:
open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), paste the file
contents, and click **Run**.

Files are numbered in the order they should be applied. The numbering was reconstructed from git
history after the fact — the files originally sat unordered in the repo root, so treat the
sequence as "best known good order", not as a log of what actually ran against production.

## Applying these to a fresh database

Run **0001 through 0020 in numeric order, without stopping.**

Several mid-sequence files (0003, 0007, 0009, 0010) put the database into a deliberately
permissive state to unblock development — 0009 disables Row Level Security outright, and 0007 and
0010 replace it with `USING (true)` policies that leave every table readable and writable by anyone
holding the public anon key. **0015 is what reverses all of that.** A database left at 0014 is
fully exposed, so never stop the sequence early.

## Applying these to the existing production database

Run **0015, then 0016, then 0017, then 0018, then 0019, then 0020**. 0016 depends on 0015's `saccos_update_admin_only`
policy being in place — it narrows that policy's reach with column-level grants. 0017 depends on
0015's column-level `REVOKE UPDATE ON public.profiles`: its functions are `SECURITY DEFINER`
precisely because `role` and `status` are no longer writable by `authenticated` directly. 0018
depends on 0017's `admin_sacco_for_member` helper and replaces two of its functions. 0019 depends on
0015's policy names — it drops and rewrites three of them by name. 0020 depends on nothing;
it only touches the realtime publication, and is what makes the dashboard's live counters
update without a page reload.

**0019 is required for the app to function at all after 0015.** 0015's `sacco_memberships` policies
consult `sacco_memberships`, so every policy that asks "is this caller staff here?" aborts with
`infinite recursion detected in policy for relation "sacco_memberships"`. 0019 moves that lookup
into `SECURITY DEFINER` helpers, which is the only way to express a self-referential RLS rule in
Postgres.

0015 is written to be idempotent and self-contained: every `DROP POLICY` is
`IF EXISTS`, every function is `CREATE OR REPLACE`, and RLS is force-enabled as its first action.
It converges the database to the correct state regardless of which earlier files did or didn't run.

It is safe to re-run 0015 at any time — **but always follow it with 0019**, which is what makes its
`sacco_memberships` policies non-recursive. 0015 on its own leaves the database unusable.

## The files

| # | File | What it does |
|---|------|--------------|
| 0001 | `initial-schema` | Base tables: `profiles`, `saccos`, `sacco_memberships`, `accounts`, `transactions`, `loans`, `loan_repayments`, `audit_events`. Signup trigger v1. |
| 0002 | `rls-and-core-rpcs` | Correctly-scoped RLS baseline, plus `process_transaction`, `request_loan`, `make_member_admin`, `delete_member_entirely`, `get_sacco_total_balances`. |
| 0003 | `patch-rls-insert-policies` | ⚠️ Adds open `INSERT` policies to unblock signup. First `register_new_sacco`. |
| 0004 | `patch-signup-trigger` | Wraps the signup trigger in exception handling so a failure can't block account creation. |
| 0005 | `sacco-settings-table` | Adds `sacco_settings` (share price, fund amounts, meeting day, current week). |
| 0006 | `backfill-missing-saccos` | One-off data repair for members whose SACCO row was never created. |
| 0007 | `enable-rls-policies` | ⚠️ Re-enables RLS but with `USING (true)` for `anon` — no real protection. |
| 0008 | `drop-saccos-meeting-day` | Drops the duplicated `meeting_day` column from `saccos` (it lives on `sacco_settings`). |
| 0009 | `register-sacco-rpc` | ⚠️ **Disables RLS** on five tables and grants `ALL` to `anon`. `register_new_sacco` v2. |
| 0010 | `complete-setup` | ⚠️ Consolidated setup; re-adds wide-open policies. Signup trigger v3, `register_new_sacco` v3. |
| 0011 | `fix-approval-authorization` | Adds `approve_member_transaction` / `reject_member_transaction`. |
| 0012 | `add-membership-names` | Denormalized `member_full_name` / `sacco_name` on memberships, kept in sync by triggers. |
| 0013 | `dividends-and-vaults` | Adds `dividend_cycles`, `dividend_allocations`, `savings_vaults` and the dividend RPCs. |
| 0014 | `peer-guarantors` | Adds `loan_guarantors` and `process_guarantor_response`. |
| 0015 | `security-hardening` | ✅ **Current authority.** Rewrites all RLS and hardens every privileged function. |
| 0016 | `subscription-holds` | Adds the `on_hold` status and the subscription columns on `saccos`, restricts which `saccos` columns a tenant admin may update, and adds `enforce_sacco_access_state` — the trigger that blocks financial writes for suspended/held tenants. |
| 0017 | `member-management-rpcs` | Backs the admin Members tab. Adds `set_member_approval` and the `admin_sacco_for_member` helper, and rewrites `make_member_admin` / `delete_member_entirely` (see below). |
| 0018 | `demote-sacco-admin` | Adds `demote_sacco_admin`, the missing inverse of `make_member_admin`. Restricts demotion to the SACCO owner (`saccos.admin_profile_id`) and rewrites `set_member_approval` / `delete_member_entirely` so that owner cannot be revoked or deleted by another admin. |
| 0019 | `fix-membership-policy-recursion` | ✅ Breaks 0015's self-referential `sacco_memberships` policies with the `is_sacco_member` / `is_sacco_staff` / `is_sacco_admin` / `can_transact_in_sacco` helpers. Adds the missing member-side `transactions` INSERT policy, and fixes an ambiguous column that made the `transactions` / `loans` SELECT policies readable across every tenant. |
| 0020 | `enable-realtime-publication` | Adds the six tables the client subscribes to (`transactions`, `loans`, `profiles`, `accounts`, `saccos`, `sacco_settings`) to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` on them. Without this every `postgres_changes` subscription in the app subscribes successfully and then never receives an event. |

## Which definition is live

Several objects were redefined repeatedly across the sequence. `CREATE OR REPLACE` means only the
last one applied is live, which is why the earlier definitions are misleading to read in isolation.
For each of these, **only the version in the "Live version" column should be running** — 0015 for
everything the security audit touched, 0017 for the two member-management functions it missed:

| Object | Defined in | Live version |
|--------|-----------|--------------|
| RLS policies (all tables) | 0002, 0003, 0005, 0007, 0009, 0010, 0013, 0014 | 0015 |
| `sacco_memberships` policies | 0015 | 0019 |
| `transactions` / `loans` SELECT policies | 0002 | 0019 |
| `handle_new_user` (signup trigger) | 0001, 0004, 0010 | 0015 |
| `register_new_sacco` | 0003, 0009, 0010 | 0015 |
| `approve_transaction` / `reject_transaction` | 0002, 0011 | 0015 |
| `calculate_dividend_preview`, `execute_dividend_payout` | 0013 | 0015 |
| `process_guarantor_response` | 0014 | 0015 |
| `get_sacco_total_balances` | 0002 | 0015 |
| `make_member_admin` | 0002 | 0017 |
| `set_member_approval` | 0017 | 0018 |
| `delete_member_entirely` | 0002, 0017 | 0018 |

Concretely, 0015 fixes: RLS policies that read `USING (true)` on every table; `audit_events`
having no RLS at all; six `SECURITY DEFINER` functions with no authorization checks (most
seriously `execute_dividend_payout`, which let any member credit money into any SACCO); and a
signup trigger that read `role` from client-supplied metadata, letting anyone self-declare
`role: 'admin'` and take over an existing SACCO by guessing its group code.

## Ordering caveat

Files 0001–0004 were committed together in a repository restructure, so their individual authorship
timestamps are lost. Their relative order is inferred from content dependencies. The 0005+ ordering
comes from real commit timestamps and is reliable.

## Adding a new migration

Use the next number and today's date: `0016_YYYYMMDD_short-description.sql`. Write it to be
re-runnable (`IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE`) — with no migration tool tracking
what has been applied, assume any file may be run more than once.

If a change touches RLS policies or a `SECURITY DEFINER` function, update the supersession table
above so the next person can tell which definition is live.
