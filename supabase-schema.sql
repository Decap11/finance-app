-- 1. Profiles Table
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
  updated_at timestamptz not null default now(),
  shares_target numeric(15, 2) default 50000.00,
  devt_target numeric(15, 2) default 10000.00,
  social_target numeric(15, 2) default 10000.00,
  avatar_url text
);

-- 2. SACCOs Table
create table public.saccos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  acronym text not null,
  group_code text unique not null,
  admin_profile_id uuid references public.profiles(id),
  member_limit integer,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  share_price numeric(15, 2) not null default 25000.00,
  devt_fund numeric(15, 2) not null default 1000.00,
  social_fund numeric(15, 2) not null default 2000.00,
  current_week integer not null default 1 check (current_week between 1 and 52),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. SACCO Memberships Table
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

-- 4. Accounts Table
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

-- 5. Transactions Table
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
  full_name text,
  reference text,
  requested_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at date,
  completed_at date,
  created_at date not null default current_date
);

-- 6. Loans Table
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
    check (status in ('pending', 'approved', 'rejected', 'disbursed', 'active', 'completed', 'defaulted', 'cancelled', 'issued')),
  requested_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  disbursed_at timestamptz,
  due_date date,
  loan_type text not null default 'normal' check (loan_type in ('normal', 'social_fund')),
  closed_at timestamptz
);

alter table public.transactions
  add constraint transactions_loan_id_fkey
  foreign key (loan_id) references public.loans(id) on delete restrict;

-- 7. Loan Repayments Table
create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  transaction_id uuid unique references public.transactions(id) on delete restrict,
  amount numeric(15, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  source_account_id uuid references public.accounts(id)
);

-- 8. Audit Events Table
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

-- 9. Trigger for New User Signup via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
BEGIN
  v_group_id := NEW.raw_user_meta_data->>'group_id';

  INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'member_number', 'MEMBER-' || substring(NEW.id::text, 1, 8)),
    v_group_id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    COALESCE(NEW.raw_user_meta_data->>'status', 'pending')
  );

  -- If a group_id is provided, try to find the matching SACCO and create a pending membership
  IF v_group_id IS NOT NULL AND v_group_id <> '' THEN
    SELECT id INTO v_sacco_id FROM public.saccos WHERE group_code = UPPER(v_group_id);
    IF v_sacco_id IS NOT NULL THEN
      INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
      VALUES (v_sacco_id, NEW.id, 'member', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger function to initialize accounts when a member joins a SACCO
CREATE OR REPLACE FUNCTION public.initialize_member_accounts()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
  VALUES 
    (NEW.sacco_id, NEW.profile_id, 'savings', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'shares', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'development_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'social_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'loan', 0.00)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_sacco_membership_created ON public.sacco_memberships;
CREATE TRIGGER on_sacco_membership_created
  AFTER INSERT ON public.sacco_memberships
  FOR EACH ROW EXECUTE PROCEDURE public.initialize_member_accounts();

-- 10. Sync Full Name and Account ID to Transactions Trigger
CREATE OR REPLACE FUNCTION public.sync_transaction_full_name()
RETURNS trigger AS $$
DECLARE
  v_account_type TEXT;
BEGIN
  -- Sync full_name from profiles
  SELECT full_name INTO NEW.full_name
  FROM public.profiles
  WHERE id = NEW.profile_id;

  -- Sync account_id if not provided
  IF NEW.account_id IS NULL THEN
    IF NEW.category = 'loan_disbursement' OR NEW.category = 'loan_repayment' THEN
      v_account_type := 'loan';
    ELSE
      v_account_type := NEW.category;
    END IF;

    SELECT id INTO NEW.account_id
    FROM public.accounts
    WHERE profile_id = NEW.profile_id 
      AND sacco_id = NEW.sacco_id 
      AND account_type = v_account_type
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_insert ON public.transactions;
CREATE TRIGGER on_transaction_insert
  BEFORE INSERT OR UPDATE OF profile_id ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.sync_transaction_full_name();
