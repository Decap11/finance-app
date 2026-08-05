# Supabase migrations

There is no migration tool wired up to this project. Every file here is applied **by hand**:
open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql), paste the file
contents, and click **Run**.

Files are numbered in the order they should be applied. The numbering was reconstructed from git
history after the fact — the files originally sat unordered in the repo root, so treat the
sequence as "best known good order", not as a log of what actually ran against production.

## Checking the database against this repo

**`../verify-schema.sql` is how you find out what actually ran.** Paste it into the SQL editor and
run it; it reads the system catalog and returns one row per check, failures first. It only reads.

It exists because everything else in this directory is a claim and the catalog is the evidence.
Nothing here can tell you whether a file was applied, half-applied before erroring, or applied and
then undone by hand — and the consequence is not subtle: **0009 disables Row Level Security on five
tables and only 0015 turns it back on**, so a sequence that stopped in between leaves a database
that behaves completely normally through the app and is readable and writable by anyone holding the
public anon key. That state has no symptom. The script checks for it directly.

Run it after applying any migration, before trusting a database with real members' money, and
whenever a feature appears never to have worked — which in this project has three separate times
turned out to be an unapplied file rather than a bug (0021, 0028, 0029).

Check 14 is the one to read after applying `0033`: a `WARN` there means the share-consistency
constraint went on but existing rows disagree with it, and it names the query that lists them.

`0032` adds a `schema_migrations` ledger and `record_migration()`; call it as the last statement of
every new migration. The ledger is a convenience for reading recent history, **not** evidence — it
records what somebody said they ran. When the two disagree, the catalog is right.

## Applying these to a fresh database

Run **0001 through 0035 in numeric order, without stopping.**

Several mid-sequence files (0003, 0007, 0009, 0010) put the database into a deliberately
permissive state to unblock development — 0009 disables Row Level Security outright, and 0007 and
0010 replace it with `USING (true)` policies that leave every table readable and writable by anyone
holding the public anon key. **0015 is what reverses all of that.** A database left at 0014 is
fully exposed, so never stop the sequence early.

## Applying these to the existing production database

Run **0015, then 0016, then 0017, then 0018, then 0019, then 0020, then 0021, then 0022, then 0023, then 0024, then 0025, then 0026, then 0027, then 0028, then 0029, then 0030, then 0031, then 0032, then 0033, then 0034, then 0035**. 0016 depends on 0015's `saccos_update_admin_only`
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
| 0029 | `transactions-reference` | ✅ **Unblocks Historical Onboarding a second time.** Adds the missing `transactions.reference` column. 0028 tags every backfilled row `reference = 'HISTORICAL'`, but the column was declared only in 0001's `CREATE TABLE` and the live table predates that file, so every submission aborted on `column "reference" of relation "transactions" does not exist`. It aborted misleadingly: the API tested the message for `does not exist` alone, which an undefined *column* matches exactly as an undefined *function* does, so a schema gap was reported as an unapplied 0028 — and 0028 was re-run repeatedly with no effect. Fixed in the route to key on `PGRST202`/`42883` instead. Confirmed missing on the live database 2026-08-04, while every other column 0028 writes was present. Adds a partial index over the tagged rows. Depends on nothing. |
| 0030 | `week-anchor-cycles` | ✅ **Gives the week number a meaning.** There were two week numbers and neither was the one a SACCO counts: `sacco_settings.current_week` was typed by hand in Configuration Settings and nothing in the app ever advanced it, while 0028 stamped rows with the *Nth meeting day of that date's own calendar year* — so a record from 5 Aug 2026 was "week 31" because it was the 31st Wednesday of 2026, which says nothing about how long the group had been running. Adds `week_anchor_date` to `sacco_settings`/`saccos`: the meeting date that is Week 1 of the current 52-week cycle, from which the active week is **derived on every read**, so it advances by itself each meeting day. Adds `finalize_historical_onboarding` — the button at the end of a backfill — which makes the oldest record Week 1, re-stamps `transactions.week_number` (and the trailing `\| Week N` in the description) plus `audit_events.metadata.week_number` on every saved attendance register, sets the active week and switches historical mode off, all in one transaction. The attendance half is not cosmetic: `WeeklyAttendanceManager` finds a saved register by matching that field against the active week, so one left on the old scale becomes unreachable, not merely mislabelled. Row numbers are deliberately **not** clamped at 52 — that would squash a multi-year history — and instead carry a true 1–52 position within their own cycle, while the active week clamps and `start_new_sacco_cycle` re-anchors. Also replaces `log_historical_record` to use the anchor when one exists (falling back to 0028's calendar-year rule until then, since rows typed mid-backfill are renumbered by the finalize anyway), and adds `meeting_dow`, `meeting_day_on_or_after`, `sacco_week_of`, `sacco_active_week`, `sacco_week_config`, `staff_sacco_for_caller` and `apply_sacco_week_anchor`. Mirrored in JS by `getSaccoWeekOf` / `getActiveWeek` in `src/utils/meetingDateUtils.js`. Depends on 0019 (`is_sacco_staff`) and 0028. |
| 0031 | `member-join-dates` | ✅ **Closes the blind spot in arrears.** Adds `profiles.joined_on` — the date an admin *states* a member joined the SACCO — plus `set_member_join_date` and `set_all_member_join_dates`. Development and social fund are owed every meeting week, so what a member owes rests entirely on the week they started owing it; `src/utils/duesEngine.js` had to infer that from the member's earliest record, and that inference cannot tell "joined in week 20" from "was here since week 1 and paid nothing until week 20" — it forgives the unpaid weeks, being most generous to exactly the members the feature exists to surface. Precedence becomes `joined_on` → first record → SACCO Week 1, so a stated fact always beats the guess. The column is **nullable and starts NULL for everybody**: nothing changes on the day it is applied, and the numbers only move when an admin asserts a date. `set_all_member_join_dates` is what makes it usable at all — no admin types thirty dates — filling every blank with the SACCO's `week_anchor_date` in one call, and touching only members with no date set so re-running it never undoes a correction. Deliberately on `profiles` rather than `sacco_memberships`: bulk-added and pre-0009 members often have no membership row, and a date that silently could not be stored for those members would be worse than none. Distinct from `sacco_memberships.joined_at`, which is `default now()` and records when the membership *row* was created. Depends on 0030 (reads `saccos.week_anchor_date`) and 0017 (`admin_sacco_for_member`). |
| 0032 | `migration-ledger` | Adds `schema_migrations` and `record_migration()`, so a hand-applied file leaves a record. Backfilled **by evidence, not assumption**: a version is written only where an object that migration alone creates is actually present in the catalog, so the starting contents are an observation rather than a claim. Deliberately weaker than it looks — `../verify-schema.sql` checks the catalog itself and is the thing to trust when the two disagree. RLS on with no policy, so the table is invisible from a browser. Depends on nothing. |
| 0033 | `share-quantity-integrity` | ✅ **Makes a shares contribution mean one thing.** A shares contribution is a whole number of shares at the SACCO's share price, but the ledger stored only the product in `amount` — the count and the price lived nowhere except as prose in `description`. So every screen that needed a count divided the amount by whatever the price happened to be *at the moment of reading*, and the price itself was resolved separately by the member's browser (from a `localStorage` cache shared across every SACCO ever signed in on that device), by the API, and by the reporting screens — each falling back to a hardcoded 25,000 when its own lookup failed, and `UserProgressTracker` to 5,000. One request could therefore be a different figure on the member's screen, in the database, and in the admin's approval queue, and editing the share price silently rewrote how many shares every member had ever bought. Adds `transactions.share_count` and `transactions.unit_price` — the count and *the price actually charged*, which is not the same thing as the current one — recovers both for existing rows by parsing the `N share(s) @ Shs X` descriptions the API has always written (and only where they multiply back to the stored amount; rows that disagree are reported, not overwritten), and adds the `transactions_share_amount_consistent` CHECK so `amount = share_count * unit_price` is a database rule. Added `NOT VALID` then validated separately, so pre-existing bad rows are named by the migration's own `RAISE WARNING` rather than aborting the file — the constraint governs all new writes either way. `verify-schema.sql` check 14 reports the un-validated state. The application half is `src/utils/sharePricing.js` (the only place the multiplication happens) and `/api/user-transactions`, which now refuses a shares request it cannot price rather than guessing 25,000, refuses a non-integer or out-of-range quantity, and refuses one whose price disagrees with what the member's screen displayed (409 `SHARE_PRICE_CHANGED`). Depends on nothing. |
| 0034 | `lending-draws-capital` | ✅ **Makes a loan come from somewhere.** A disbursement has always been a real ledger row — `request_loan` writes a `loan_disbursement` debit and the admin's approval completes it — but every function that added capital up ignored both loan categories, so a SACCO could lend out its entire pot with no figure in the app moving by one shilling. There was nowhere to see where a loan came from, and nothing stopping an admin approving one the group could not fund. Capital becomes a **cash position** — `contributions + fines + repayments − principal disbursed` — in `sacco_capital_on_hand`, with `get_sacco_capital_position` returning the breakdown. Approving a loan now visibly draws the pot down, and repayments build it back **with their interest**, recognised when the money actually arrives rather than as the projected `principal × rate × term` the admin dashboard computed for itself. **Savings are excluded**: members' own money held on their behalf, a liability and not the SACCO's to lend. That also settles a standing disagreement — the admin dashboard summed savings in, the Pools & Funds ring never did, so the same SACCO had two different "total capital" figures on two screens. `approve_member_transaction` gains the guard that gives the number teeth: a `loan_disbursement` larger than `sacco_capital_on_hand` is refused with the shortfall named, and the `saccos` row is locked first so two admins approving two loans at the same moment cannot each read a balance that ignores the other. `get_sacco_capital_trend` extends to the same category set, since 0027 requires its percentage to reconcile against the figure it sits under. `on_hand` is returned **unclamped** — a negative pot means the SACCO has lent more than it ever collected, which is precisely the condition worth surfacing rather than flooring at zero. The application half is `src/utils/saccoCapital.js`, which both surfaces share so they cannot drift. `verify-schema.sql` check 15 catches a half-applied file, whose worst state leaves the new figure live while approval still disburses past zero. Depends on 0024 and 0027. |
| 0035 | `close-anonymous-reads` | 🔒 **Stops handing every member's name, phone and email to the public.** Measured against the live project, not inferred: a caller holding only the publishable anon key — which ships inside the client bundle — could read all 27 rows of `profiles` (`full_name`, `phone`, `email`, `member_number`, `role`), all 27 of `sacco_memberships`, and all 8 of `saccos` and `sacco_settings`, and could `PATCH` the last two. `transactions`, `accounts` and `loans` were already scoped and returned nothing, so the **money was never exposed — the people were.** The cause is 0015's own line 70, which kept SELECT open reasoning that "members need to see each other's names/member numbers within the app". The intent is right and is preserved here; what was missing is a `TO` clause, and a policy without one applies to every role including `anon` — so "members can see each other" was written as "the internet can see the members". The same omission on `sacco_settings_write_admin_only` is why an anonymous `PATCH` of the share price and fee schedule was accepted. Every policy on the four tables is **dropped by catalogue lookup rather than by name**, because the live set had already drifted from this directory: 0019 gave `sacco_memberships` a correctly scoped SELECT policy, yet anonymous callers still read all 27 rows, so something exists in the database that no file here creates. Naming what to drop assumes we know what is there. The rebuilt policies are scoped `TO authenticated` and to the caller's own SACCO through three new `SECURITY DEFINER` helpers — `my_group_code`, `is_my_sacco`, `shares_sacco_with` — which follow 0019's pattern of answering "which SACCO am I in?" outside RLS so a policy on `profiles` cannot recurse into `profiles`. Both notions of belonging are honoured, membership row **and** `profiles.group_id`, because 0018 records that a member matched by group code alone has no membership row at all. **Members still see each other's full contact details inside their own SACCO** — `Search.jsx` is unchanged; this migration redefines who counts as inside, not what they see. `lookup_sacco_for_signup` exists because signup reads `saccos` *before* `signUp()` runs, while the caller is still anonymous: it returns `id`, `group_code` and `name` for one match and never the fee schedule or `admin_profile_id`, keeping the code-then-name precedence so join-versus-auto-create behaviour is identical. STEP 9 revokes the table grants from `anon` outright, since `profiles` survived the anonymous write test only on a missing GRANT while its policy would have allowed it. `verify-schema.sql` check 16 fails on any policy or grant reaching `anon`, and on a half-applied file where access is closed but the signup lookup is missing — whose symptom is every new member silently auto-creating a duplicate SACCO. Depends on 0015 and 0019. |

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
| `approve_member_transaction` | 0011, 0015, 0024 | 0034 |
| `calculate_dividend_preview`, `execute_dividend_payout` | 0013 | 0015 |
| `process_guarantor_response` | 0014 | 0015 |
| `get_sacco_total_balances` | 0002, 0015 | 0022 |
| `get_sacco_capital_trend` | 0027 | 0034 |
| `sacco_capital_on_hand`, `get_sacco_capital_position` | — | 0034 |
| `profiles` / `saccos` / `sacco_settings` policies | 0002, 0007, 0010, 0015 | 0035 |
| `my_group_code`, `is_my_sacco`, `shares_sacco_with`, `is_sacco_admin_or_founder`, `lookup_sacco_for_signup` | — | 0035 |
| `get_member_open_loans` | — | 0028 |
| `log_historical_record`, `meeting_week_of` | 0028 | 0030 |
| `finalize_historical_onboarding`, `start_new_sacco_cycle`, `sacco_week_of`, `sacco_active_week` | — | 0030 |
| `set_member_join_date`, `set_all_member_join_dates` | — | 0031 |
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

Use the next number and today's date: `0036_YYYYMMDD_short-description.sql`. Write it to be
re-runnable (`IF EXISTS` / `IF NOT EXISTS` / `CREATE OR REPLACE`) — with no migration tool tracking
what has been applied, assume any file may be run more than once.

End it with `SELECT public.record_migration('0035', 'one line on what it does');` so the ledger
0032 introduced stays current.

If it adds a function, column or policy the app depends on, add it to the corresponding list in
`../verify-schema.sql`. That file is only as good as its coverage, and an object nobody added to it
is an object whose absence will be discovered by a member seeing the wrong number.

If a change touches RLS policies or a `SECURITY DEFINER` function, update the supersession table
above so the next person can tell which definition is live.
