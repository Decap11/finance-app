# Supabase migrations

There is no migration tool wired up to this project. Every file here is applied **by hand**:
open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), paste the file
contents, and click **Run**.

Files are numbered in the order they should be applied. The numbering was reconstructed from git
history after the fact — the files originally sat unordered in the repo root, so treat the
sequence as "best known good order", not as a log of what actually ran against production.

## Applying these to a fresh database

Run **0001 through 0028 in numeric order, without stopping.**

Several mid-sequence files (0003, 0007, 0009, 0010) put the database into a deliberately
permissive state to unblock development — 0009 disables Row Level Security outright, and 0007 and
0010 replace it with `USING (true)` policies that leave every table readable and writable by anyone
holding the public anon key. **0015 is what reverses all of that.** A database left at 0014 is
fully exposed, so never stop the sequence early.

## Applying these to the existing production database

Run **0015, then 0016, then 0017, then 0018, then 0019, then 0020, then 0021, then 0022, then 0023, then 0024, then 0025, then 0026, then 0027, then 0028**. 0016 depends on 0015's `saccos_update_admin_only`
policy being in place — it narrows that policy's reach with column-level grants. 0017 depends on
0015's column-level `REVOKE UPDATE ON public.profiles`: its functions are `SECURITY DEFINER`
precisely because `role` and `status` are no longer writable by `authenticated` directly. 0018
depends on 0017's `admin_sacco_for_member` helper and replaces two of its functions. 0019 depends on
0015's policy names — it drops and rewrites three of them by name. 0020 depends on nothing;
it only touches the realtime publication, and is what makes the dashboard's live counters
update without a page reload. 0021 depends on nothing either, but it is what makes the
absence-fine feature able to write a row at all — see below.

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

**0021 repairs a feature that has never worked.** `transactions.category` allowed `'fine'`;
every caller writes `'fines'`, and the same insert also sent a `week_number` column that did not
exist. Confirmed on the live database 2026-08-03: two attendance weeks had been saved, each
assessing UGX 1,000 against one absentee, and the ledger held no fine of either spelling.
0021 also adds the `fines` account type, without which approving a fine aborts.

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
| 0021 | `repair-fines-category` | ✅ Makes a fine storable. Replaces the `transactions.category` check so it lists `'fines'` instead of `'fine'` (migrating any existing rows), adds `'fines'` to `accounts.account_type` and backfills the account for every member, and adds the `transactions.week_number` column the attendance manager has always tried to write. |
| 0022 | `fines-fund-pool` | ✅ Makes fines the fourth fund pool. Adds `transactions.fine_type` — `'absenteeism'` belongs to the attendance engine, everything else to the fines manager — plus `late_fine_amount` on `saccos`/`sacco_settings`. Rewrites `get_sacco_total_balances` to sum `'fines'` too, adds `levy_member_fine` / `waive_member_fine`, and drops 0015's `transactions_insert_staff_fines` policy now that no browser writes fines directly. |
| 0023 | `loan-lifecycle` | ✅ Application fee, guarantor minimum, installment repayment and late charges. Adds the three loan settings to `saccos`/`sacco_settings`, widens the `loans.status` check (`pending_fee`, `pending_guarantors`, `overdue`), adds `closed_at`/`total_repayable`/`installment_amount`/`late_fee_months_charged`, replaces `request_loan` (takes the guarantor array, enforces the minimum, raises the fee), and adds `confirm_loan_application_fee`, `record_loan_repayment` and `apply_loan_late_fees`. Extends `sync_loan_on_transaction_approval` so an approved repayment finally reduces `outstanding_balance` and writes a `loan_repayments` row. Depends on 0022 for `fine_type`. |
| 0024 | `fix-approval-account-mapping` | ✅ Stops `approve_member_transaction` inventing an account type from the category. Adds `account_type_for_category`; a category with no account behind it (`fee`, `dividend`, `adjustment`) now completes without touching `accounts` instead of failing the account_type CHECK. Also refuses to disburse a loan whose fee is unconfirmed or whose guarantors have not signed, and makes approving a loan fee advance the loan exactly as the dedicated button does. |
| 0025 | `concurrent-loan-types` | ✅ One open loan **per type**, not one open loan. A member repaying a normal loan may still take a Social Fund emergency advance; what they cannot do is stack two of the same kind. Replaces `request_loan` with the check scoped to `loan_type`, adds `loan_is_open(status)`, and adds a partial unique index on `(profile_id, loan_type)` over the open statuses — **the index is skipped with a warning if the data already has duplicates** (this database has several members holding multiple open normal loans from before the rule). Re-run the file once those are settled and the index appears. Depends on 0023. |
| 0026 | `loan-numbers` | ✅ Human-readable loan references — `BYS-022-001`: SACCO acronym from `saccos.group_code`, the borrower's `member_number` digits, and which loan this is for that member. Adds `loans.loan_number` (unique) alongside the UUID primary key, which is untouched. Stamped by a `BEFORE INSERT` trigger rather than inside `request_loan`, so the admin manual-contribution path gets one too; the `UPDATE` branch holds an issued number still. Numbering runs per prefix, not per member, because two HTS-5050 members share `MEM-022` and would otherwise both be handed `-001`. Backfills existing loans oldest-first. Depends on 0025. |
| 0027 | `capital-weekly-trend` | ✅ Puts a real number behind the "Total SACCO Assets" card's trend line, which was a hardcoded `+0.0%` and a hardcoded upward arrow. Adds `get_sacco_capital_trend`, returning the pot at Monday 00:00 plus the signed movement in this week and last. The card shows this week's growth against the opening balance, and turns the arrow down and the figure red when it is negative. Sums the same four categories the card totals (`shares`, `development_fund`, `social_fund`, `fines`) and deliberately **not** `savings`, which `/api/sacco-balances` drops from its response — a percentage over a wider set than the figure above it would not reconcile. Weeks are ISO (Monday), not the SACCO's `meeting_day`. The API treats a missing definition as non-fatal, so the other cards survive an unapplied 0027. Depends on nothing. |
| 0028 | `historical-onboarding` | ✅ **Makes Historical Onboarding work at all.** The feature has never written a row: `/api/admin/manual-contribution` runs under the anon key, so RLS applied to every statement, and the only `transactions` INSERT policy (0019) demands `profile_id = auth.uid()` and `status = 'pending'` while `loans` and `accounts` have no write policy whatsoever. Adds `log_historical_record`, one `SECURITY DEFINER` function that does the lot in a single transaction — contributions, fines, loans issued, repayments and dividends — and critically sets `created_at` / `approved_at` / `completed_at` to **the date the event actually happened** rather than today, which is what puts a backfilled record on the right meeting in every view. Also writes `week_number` (never previously written), resolves accounts through 0024's `account_type_for_category` with the identical balance arithmetic to `approve_member_transaction`, does the loan side effects by hand because `on_transaction_approval` is an `AFTER UPDATE OF status` trigger that never fires for a row inserted already `completed`, and authorizes via `is_sacco_staff(the member's own SACCO)` — closing a hole where an admin of one SACCO could write records against another's member. Backdating requires `is_historical_mode` to be on in Configuration Settings, enforced in the function rather than only in the form. Rows carry `reference = 'HISTORICAL'`. Adds `meeting_week_of` and `get_member_open_loans`. Depends on 0019 (`is_sacco_staff`), 0024 (`account_type_for_category`) and 0025 (`loan_is_open`). |

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
| `approve_transaction` / `reject_transaction` | 0002, 0011 | 0024 (approve) / 0015 (reject) |
| `calculate_dividend_preview`, `execute_dividend_payout` | 0013 | 0015 |
| `process_guarantor_response` | 0014 | 0015 |
| `get_sacco_total_balances` | 0002, 0015 | 0022 |
| `get_sacco_capital_trend` | — | 0027 |
| `log_historical_record`, `get_member_open_loans`, `meeting_week_of` | — | 0028 |
| `request_loan` | 0002, 0023, 0025 | 0026 |
| `initialize_member_accounts` | 0001 | 0021 |
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
