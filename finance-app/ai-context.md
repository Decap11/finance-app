# SACCO Finance Web Application Context

## 1. Project Overview

This project is a web-based Savings and Credit Cooperative Organization (SACCO) finance application. It supports member onboarding, dashboards, savings and shares tracking, loan requests, loan repayments, admin group member management, payment workflows, contribution approvals, broadcasts, attendance tracking, and administrative reporting.

The current application is a Next.js frontend with a localStorage-backed mock data layer and partial Supabase integration. The long-term target is a secure Supabase/PostgreSQL-backed SACCO ledger where financial balances are auditable, role-protected, and updated through controlled workflows.

Primary objective: deliver a secure, reliable, responsive SACCO management experience for members, administrators, and loan officers.

## 2. Current Tech Stack

- Frontend: Next.js, React 19, React DOM
- Routing/build tool: Next.js Pages Router
- Backend/data integration: Supabase client is configured, but most app state currently comes from localStorage mock data
- Mock API option: json-server using `data/data.json`
- Styling: plain CSS files organized by component/page
- Deployment config: Netlify config files are present
- Package manager: npm

## 3. Important Commands

Run commands from the `finance-app` directory.

```bash
npm install
npm run dev
npm run build
npm run lint
npm run start
npm run server
```

Command purposes:

- `npm run dev`: starts the Next.js development server.
- `npm run build`: creates a production Next.js build in `.next`.
- `npm run lint`: runs ESLint.
- `npm run start`: starts the built Next.js production server.
- `npm run server`: starts `json-server` on port `5000` using `data/data.json`.

## 4. Project Structure

```text
finance-app/
  ai-context.md
  package.json
  netlify.toml
  pages/
  public/
    _redirects
    images/
  data/
    data.json
  src/
    supabase-client.js
    Components/
    views/
    layout/
    context/
    styles/
    utils/
```

Key files:

- `pages/_app.jsx`: Next.js custom app, global CSS imports, and client-only mock state loader.
- `pages/*.jsx`: Next.js route wrappers.
- `src/supabase-client.js`: Supabase client initialization using Next.js public environment variables.
- `src/styles/App-stateV2.js`: current localStorage-backed SACCO state manager.
- `data/data.json`: mock json-server data source.
- `public/images/`: public visual assets used by auth/onboarding/landing flows.

## 5. Application Routes

Routes are defined in the root `pages/` directory.

| Route         | Purpose             |
| ------------- | ------------------- |
| `/`           | Landing page        |
| `/home`       | Landing page        |
| `/intro`      | Landing page        |
| `/onboarding` | Onboarding steps    |
| `/signup`     | Member signup       |
| `/login`      | Member login        |
| `/admin`      | Admin dashboard     |
| `/loader`     | Loader screen       |
| `/dashboard`  | Member dashboard    |
| `/savings`    | Member savings page |
| `/loans`      | Member loans page   |
| `/members`    | Group members page  |
| `/payments`   | Payments page       |
| `/settings`   | Settings page       |
| `*`           | Redirects to `/`    |

## 6. Current Data Flow

The app currently has two data paths:

1. Supabase signup insert:
   - `src/views/SignUp.jsx` imports `src/supabase-client.js`.
   - Signup inserts into a Supabase table named `MembersSignUpData`.
   - The signup form collects `FullName`, `Phone`, `MemberID`, `Email`, `GroupID`, `Password`, and `TermsAccepted`.

2. localStorage app state:
   - `src/styles/App-stateV2.js` seeds and manages mock SACCO data.
   - It exposes `window.SaccoState` globally.
   - It stores members, SACCO workspaces, transactions, loans, broadcasts, attendance logs, current user session, authentication state, and theme preference.

Important note: the current UI should not be treated as a complete production ledger. Most financial behavior is simulated locally. Production work should move financial writes into Supabase/PostgreSQL functions or controlled API actions.

## 7. Environment Variables

Supabase uses Next.js public environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Do not commit real secrets. The anon key is acceptable for frontend usage only when Row Level Security policies are correctly configured in Supabase.

## 8. Current Functional Areas

Member-facing:

- Landing and onboarding flow
- Signup and login screens
- Dashboard summary cards
- Savings overview
- Loan eligibility and loan request widgets
- Loan repayment widget
- Payments page
- Recent transactions
- Progress tracking
- Settings

Admin/group-facing:

- Admin dashboard
- Group member management
- Quick member management
- Contribution approvals
- Broadcast messages
- Fund distribution summaries
- Recent loan transactions
- Manual contribution logging
- Calendar heat map and activity visualization

Shared UI/layout:

- Admin and member layouts
- Sidebars
- Headers
- Loader
- Search
- Action cards

## 9. Current Mock State Model

The localStorage state layer stores data under keys such as:

- `registeredSaccos`
- `activeSacco`
- `members`
- `transactions`
- `loans`
- `broadcasts`
- `attendanceLogs`
- `currentUser`
- `isAuthenticated`
- `theme`

The exposed `window.SaccoState` API includes methods for:

- SACCO workspace management
- current user profile/session management
- member add/delete/update behavior
- transaction creation, approval, and rejection
- member balance updates
- loan creation, approval, rejection, and repayment
- broadcast creation
- attendance logging and penalty fines
- theme toggling

When changing existing pages, check whether the component reads from props, static data, `window.SaccoState`, `data/data.json`, or Supabase before refactoring.

## 10. Recommended Production Data Model

The schema below is a production-oriented blueprint. It improves on the original minimal schema by separating members, accounts, immutable ledger entries, loans, approvals, and audit metadata.

Use lowercase snake_case table and column names in Supabase/PostgreSQL.

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  member_number text unique not null,
  group_id text,
  role text not null default 'member'
    check (role in ('member', 'loan_officer', 'admin')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saccos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  acronym text not null,
  group_code text unique not null,
  admin_profile_id uuid references public.profiles(id),
  member_limit integer,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sacco_memberships (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('member', 'loan_officer', 'admin')),
  status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'removed')),
  joined_at timestamptz not null default now(),
  unique (sacco_id, profile_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  account_type text not null
    check (account_type in ('savings', 'shares', 'development_fund', 'social_fund', 'loan')),
  balance numeric(15, 2) not null default 0.00 check (balance >= 0),
  status text not null default 'active'
    check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sacco_id, profile_id, account_type)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  account_id uuid references public.accounts(id) on delete restrict,
  loan_id uuid,
  amount numeric(15, 2) not null check (amount > 0),
  direction text not null check (direction in ('credit', 'debit')),
  category text not null
    check (category in (
      'savings',
      'shares',
      'development_fund',
      'social_fund',
      'loan_disbursement',
      'loan_repayment',
      'fee',
      'fine',
      'dividend',
      'adjustment'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed', 'failed', 'reversed')),
  description text,
  reference text,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid not null references public.saccos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  amount_requested numeric(15, 2) not null check (amount_requested > 0),
  amount_approved numeric(15, 2) check (amount_approved >= 0),
  outstanding_balance numeric(15, 2) not null default 0.00 check (outstanding_balance >= 0),
  interest_rate numeric(5, 2) not null default 0.00 check (interest_rate >= 0),
  term_months integer check (term_months > 0),
  purpose text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'disbursed', 'active', 'completed', 'defaulted', 'cancelled')),
  requested_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  disbursed_at timestamptz,
  due_date date,
  closed_at timestamptz
);

alter table public.transactions
  add constraint transactions_loan_id_fkey
  foreign key (loan_id) references public.loans(id) on delete restrict;

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  transaction_id uuid unique references public.transactions(id) on delete restrict,
  amount numeric(15, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  source_account_id uuid references public.accounts(id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  sacco_id uuid references public.saccos(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

## 11. Ledger Rules

For production financial behavior:

- Treat `transactions` as the audit trail.
- Do not delete completed financial transactions.
- Reverse mistakes with reversal transactions instead of editing history.
- Update balances only inside database transactions or trusted backend functions.
- Keep `accounts.balance` synchronized with completed ledger entries.
- Record who requested, approved, rejected, completed, or reversed each financial action.
- Every transaction must belong to a SACCO and a member.
- Every account transaction should reference the affected account.
- Loan disbursements and repayments should reference the related loan.

## 12. Security Requirements

Before real users or money are involved:

- Enable Row Level Security on all Supabase tables.
- Members may only read their own profile, accounts, loans, and transactions unless policy says otherwise.
- Admins and loan officers may only access records for SACCOs they belong to.
- Only authorized admin/loan officer roles may approve loans or transactions.
- Signup must not store raw passwords in custom tables. Use Supabase Auth for passwords.
- Sensitive financial writes should be handled through RPC functions or backend endpoints, not direct unrestricted client updates.
- Validate all amounts server-side.
- Add audit logging for approvals, rejections, reversals, role changes, and member status changes.
- Avoid exposing service role keys to the frontend.

## 13. Supabase Migration Notes

Current signup uses `MembersSignUpData`, but the recommended production direction is:

1. Use Supabase Auth for account creation and login.
2. Store member profile details in `public.profiles`.
3. Store SACCO membership in `public.sacco_memberships`.
4. Store financial balances in `public.accounts`.
5. Store financial history in `public.transactions`.
6. Move loan workflows to `public.loans` and `public.loan_repayments`.
7. Replace localStorage mutations with Supabase reads/writes after RLS policies are ready.

## 14. UI/UX Principles

The application is a financial operations tool, so the UI should feel clear, trustworthy, and efficient.

- Prioritize readable tables, compact summaries, and obvious action states.
- Keep dashboards scannable for repeated daily use.
- Make pending, approved, rejected, completed, and failed statuses visually distinct.
- Avoid decorative layouts that obscure financial data.
- Keep member and admin workflows separate where permissions differ.
- Show amounts consistently in UGX.
- Confirm sensitive actions such as approvals, rejections, repayments, and deletions.
- Provide empty states, loading states, and error states for data-driven components.

## 15. Coding Guidelines

- Follow the existing React component and CSS organization unless doing a larger planned refactor.
- Prefer React state and props for new UI behavior.
- Avoid adding more global DOM manipulation when a React pattern is reasonable.
- Keep route changes in `pages/*.jsx`.
- Keep Supabase access behind small helper functions when behavior becomes reused.
- Avoid storing passwords or sensitive financial data in localStorage.
- Preserve existing user-created code unless a requested change requires editing it.
- Run `npm run lint` and `npm run build` after meaningful code changes when possible.

## 16. Known Gaps And Risks

- Authentication is incomplete. Login currently navigates to the dashboard without verifying credentials.
- Signup inserts form data into `MembersSignUpData`, including a password field. This should be replaced with Supabase Auth before production use.
- The app uses localStorage for financial state, which is useful for prototyping but not secure or reliable for real SACCO records.
- There are no database migrations in the repo at the time this context was written.
- The recommended SQL schema in this file is a blueprint, not confirmed applied database state.
- Some mock data shapes differ: `data/data.json` stores several contribution values as arrays, while `App-stateV2.js` often uses numeric totals.
- Financial balance updates currently happen in frontend JavaScript and should be moved to trusted server/database logic.

## 17. AI Assistant Working Notes

When helping with this project:

- Read the root `pages/` route wrappers first to understand routing.
- Check the target component and its CSS file before changing UI.
- Check whether the feature currently uses `window.SaccoState`, Supabase, hardcoded data, or `data/data.json`.
- Do not assume the SQL schema is already deployed.
- When adding production data behavior, propose or create migrations and RLS policies alongside frontend changes.
- When modifying financial workflows, preserve auditability and avoid silent balance mutations.
- When building UI, keep it operational and data-focused rather than marketing-style.

## 18. Definition Of Done For Production Features

A production-ready feature should include:

- Clear route or component integration.
- Valid loading, empty, success, and error states.
- Permission-aware behavior.
- Server-side validation for financial data.
- Audit logging for sensitive actions.
- Tests or manual verification notes where practical.
- Successful lint/build checks.
- Documentation updates when data contracts, routes, or workflows change.
