-- ====================================================================================
-- MIGRATION 0026: Human-readable loan numbers -- BYS-022-001
-- ====================================================================================
--
-- Requires 0025.
--
-- The UUID primary key stays exactly as it is. Every foreign key, RLS policy and RPC
-- signature keeps pointing at `loans.id`; this adds a label next to it, the same way
-- `profiles.member_number` sits next to the auth UUID it can never replace.
--
-- The format, in three parts:
--
--   BYS  -- the SACCO acronym, taken from the part of `saccos.group_code` before the
--           dash. Blessed Youth Sacco is already 'BYS-8240' in the database, so the
--           acronym is read rather than invented.
--   022  -- the borrower's number within the group, the digits of `member_number`
--           ('MEM-022'), zero-padded to three.
--   001  -- which loan this is for that member: their first, second, third.
--
-- Stamped by a BEFORE INSERT trigger rather than inside request_loan, because request_loan
-- is not the only thing that creates a loan -- the admin manual-contribution route inserts
-- rows directly when onboarding a historical loan. A trigger covers every write path,
-- including ones added later.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the column
--
-- Nullable, so the trigger can fill it and so a failure to derive one can never block a
-- loan from being recorded. Unique, because a reference a member quotes to an admin has
-- to point at one loan.
-- ====================================================================================
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS loan_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS loans_loan_number_key
  ON public.loans (loan_number)
  WHERE loan_number IS NOT NULL;


-- ====================================================================================
-- STEP 2: the prefix -- 'BYS-022'
--
-- Two fallbacks, both driven by what is actually in this database:
--
--   * A group_code with no dash yields the whole code as the acronym, rather than an
--     empty string.
--   * One profile carries 'MEM-6a1ab4d8' -- the signup trigger's UUID fallback, which has
--     no digits in it at all. Stripping non-digits there leaves nothing, so the first
--     three characters of the profile UUID are used instead. It keeps the width uniform
--     and stays stable for that member across all their loans.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.loan_number_prefix(
  p_sacco_id UUID,
  p_profile_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_acronym TEXT;
  v_member TEXT;
BEGIN
  SELECT UPPER(SPLIT_PART(group_code, '-', 1)) INTO v_acronym
  FROM public.saccos WHERE id = p_sacco_id;

  IF v_acronym IS NULL OR v_acronym = '' THEN
    v_acronym := 'SACCO';
  END IF;

  SELECT REGEXP_REPLACE(COALESCE(member_number, ''), '\D', '', 'g') INTO v_member
  FROM public.profiles WHERE id = p_profile_id;

  IF v_member IS NULL OR v_member = '' THEN
    v_member := UPPER(SUBSTRING(p_profile_id::TEXT, 1, 3));
  END IF;

  -- Padded, not truncated: a SACCO that grows past 999 members gets a wider number
  -- rather than two members sharing one.
  RETURN v_acronym || '-' || LPAD(v_member, 3, '0');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- ====================================================================================
-- STEP 3: the next free number for a member
--
-- Counting a member's loans would be the obvious way to get the '001', and for almost
-- every member it gives the same answer. It is not what this does, for a reason visible
-- in the live data: two members of HTS-5050 both hold 'MEM-022', so they share a prefix.
-- Numbering per member would hand both of them HTS-022-001 and the unique index would
-- reject the second.
--
-- So the series belongs to the prefix, and the highest one already issued decides the
-- next. Where member numbers are unique -- which is the intended state -- that is exactly
-- "this member's Nth loan". Where they are not, the two members share one series and
-- nobody gets a duplicate. Fixing the underlying member numbers makes the distinction
-- disappear.
--
-- The advisory lock is what makes concurrent requests safe. It is taken on the prefix, so
-- two members applying at the same moment only wait on each other if they would have
-- competed for the same number anyway.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.next_loan_number(
  p_sacco_id UUID,
  p_profile_id UUID
) RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_seq INTEGER;
  v_candidate TEXT;
  v_guard INTEGER := 0;
BEGIN
  v_prefix := public.loan_number_prefix(p_sacco_id, p_profile_id);

  PERFORM pg_advisory_xact_lock(hashtext('loan_number:' || v_prefix));

  -- MAX of what has been issued, not COUNT of what exists: a deleted or renumbered loan
  -- must not hand its number to somebody else.
  SELECT COALESCE(MAX(SUBSTRING(loan_number FROM '(\d+)$')::INTEGER), 0) + 1
    INTO v_seq
  FROM public.loans
  WHERE loan_number LIKE v_prefix || '-%';

  LOOP
    v_candidate := v_prefix || '-' || LPAD(v_seq::TEXT, 3, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.loans WHERE loan_number = v_candidate
    );

    v_seq := v_seq + 1;
    v_guard := v_guard + 1;

    IF v_guard > 1000 THEN
      RAISE EXCEPTION 'Could not allocate a loan number for prefix %', v_prefix;
    END IF;
  END LOOP;

  RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================================
-- STEP 4: stamp it on the way in, and hold it still afterwards
--
-- SECURITY DEFINER because the generator reads `saccos` and `profiles`, which the
-- borrower inserting their own loan cannot necessarily see in full under RLS.
--
-- The UPDATE branch is the part that matters over time: a loan number that a member has
-- quoted, or that appears on a printed statement, must keep pointing at the same loan. An
-- attempt to change one is put back rather than rejected, so it cannot break an unrelated
-- update that happens to carry the column along.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.set_loan_number()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.loan_number IS NULL OR NEW.loan_number = '' THEN
      NEW.loan_number := public.next_loan_number(NEW.sacco_id, NEW.profile_id);
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.loan_number IS NOT NULL AND NEW.loan_number IS DISTINCT FROM OLD.loan_number THEN
    NEW.loan_number := OLD.loan_number;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS loans_set_loan_number ON public.loans;

CREATE TRIGGER loans_set_loan_number
  BEFORE INSERT OR UPDATE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.set_loan_number();


-- ====================================================================================
-- STEP 5: backfill the loans that already exist
--
-- Ordered by requested_at within each prefix, so the oldest loan is -001 and the numbers
-- read as a history. Partitioned by prefix rather than by member for the same reason as
-- STEP 3 -- two members sharing 'MEM-022' would otherwise both be handed -001 here.
--
-- Guarded on loan_number IS NULL throughout, so re-running this file leaves already
-- numbered loans exactly as they are.
-- ====================================================================================
WITH unnumbered AS (
  SELECT
    l.id,
    l.requested_at,
    public.loan_number_prefix(l.sacco_id, l.profile_id) AS prefix
  FROM public.loans l
  WHERE l.loan_number IS NULL
),
-- Where a prefix already has numbers -- a re-run, or an interrupted first run -- carry on
-- from the highest rather than starting at 001 and colliding with it.
starting_point AS (
  SELECT
    u.prefix,
    COALESCE(
      (SELECT MAX(SUBSTRING(x.loan_number FROM '(\d+)$')::INTEGER)
       FROM public.loans x
       WHERE x.loan_number LIKE u.prefix || '-%'),
      0
    ) AS offset_from
  FROM (SELECT DISTINCT prefix FROM unnumbered) u
),
numbered AS (
  SELECT
    u.id,
    u.prefix,
    s.offset_from + ROW_NUMBER() OVER (PARTITION BY u.prefix ORDER BY u.requested_at, u.id) AS seq
  FROM unnumbered u
  JOIN starting_point s ON s.prefix = u.prefix
)
UPDATE public.loans l
SET loan_number = n.prefix || '-' || LPAD(n.seq::TEXT, 3, '0')
FROM numbered n
WHERE l.id = n.id;


-- ====================================================================================
-- STEP 6: request_loan returns the number it just issued
--
-- Identical to 0025 apart from the two lines that read the generated number back and put
-- it in the response, so the member is told "BYS-022-001" instead of being handed a UUID
-- or nothing at all.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.request_loan(
  p_sacco_id UUID,
  p_amount NUMERIC,
  p_term_months INTEGER,
  p_purpose TEXT,
  p_loan_type TEXT,
  p_interest_rate NUMERIC,
  p_due_date DATE,
  p_guarantors UUID[] DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_loan_id UUID;
  v_loan_number TEXT;
  v_account_id UUID;
  v_fee NUMERIC;
  v_min_guarantors INTEGER;
  v_guarantors UUID[];
  v_total NUMERIC;
  v_guarantor UUID;
  v_type TEXT;
  v_type_label TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_sacco_member(p_sacco_id) THEN
    RAISE EXCEPTION 'You are not a member of this SACCO';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A loan must be greater than zero';
  END IF;

  IF p_term_months IS NULL OR p_term_months < 1 THEN
    RAISE EXCEPTION 'Choose how long you need to repay this loan';
  END IF;

  v_type := COALESCE(p_loan_type, 'normal');

  IF v_type NOT IN ('normal', 'social_fund') THEN
    RAISE EXCEPTION 'Unknown loan type: %', v_type;
  END IF;

  IF v_type = 'social_fund' AND p_amount > 50000 THEN
    RAISE EXCEPTION 'Social Fund loan amount cannot exceed Shs 50,000';
  END IF;

  v_type_label := CASE v_type
    WHEN 'social_fund' THEN 'Social Fund emergency'
    ELSE 'normal'
  END;

  -- One live loan of each type. A member repaying a normal loan may still take a Social
  -- Fund emergency advance, and the reverse; what they cannot do is stack two of the
  -- same kind, which would put their guarantors behind more than they agreed to.
  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE profile_id = auth.uid()
      AND loan_type = v_type
      AND public.loan_is_open(status)
  ) THEN
    RAISE EXCEPTION 'You already have a % loan in progress. Settle it before requesting another.',
      v_type_label;
  END IF;

  SELECT COALESCE(loan_application_fee, 5000), COALESCE(loan_min_guarantors, 3)
    INTO v_fee, v_min_guarantors
  FROM public.saccos WHERE id = p_sacco_id;

  -- Deduplicate, and drop the borrower if they nominated themselves.
  SELECT COALESCE(ARRAY_AGG(DISTINCT g), ARRAY[]::UUID[]) INTO v_guarantors
  FROM UNNEST(COALESCE(p_guarantors, ARRAY[]::UUID[])) AS g
  WHERE g <> auth.uid();

  IF COALESCE(ARRAY_LENGTH(v_guarantors, 1), 0) < v_min_guarantors THEN
    RAISE EXCEPTION 'This loan needs at least % guarantors from your SACCO. You selected %.',
      v_min_guarantors, COALESCE(ARRAY_LENGTH(v_guarantors, 1), 0);
  END IF;

  -- Every guarantor must be an active member of the same SACCO. Checked here rather
  -- than in the browser because the browser list is only a suggestion.
  FOREACH v_guarantor IN ARRAY v_guarantors LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.sacco_memberships sm
      WHERE sm.sacco_id = p_sacco_id AND sm.profile_id = v_guarantor
    ) THEN
      RAISE EXCEPTION 'One of the guarantors you selected is not a member of this SACCO';
    END IF;
  END LOOP;

  -- Flat interest across the term, matching how the application has always quoted it.
  v_total := ROUND(p_amount * (1 + (COALESCE(p_interest_rate, 0) / 100.0) * p_term_months), 2);

  INSERT INTO public.loans (
    sacco_id, profile_id, amount_requested, term_months, purpose, status,
    loan_type, interest_rate, due_date, guarantor_status,
    application_fee, total_repayable, installment_amount
  )
  VALUES (
    p_sacco_id, auth.uid(), p_amount, p_term_months, p_purpose, 'pending_fee',
    v_type, COALESCE(p_interest_rate, 0), p_due_date, 'pending_guarantors',
    v_fee, v_total, ROUND(v_total / p_term_months, 2)
  )
  RETURNING id, loan_number INTO v_loan_id, v_loan_number;

  INSERT INTO public.loan_guarantors (
    loan_id, sacco_id, borrower_profile_id, guarantor_profile_id, status, guaranteed_amount
  )
  SELECT v_loan_id, p_sacco_id, auth.uid(), g, 'pending',
         ROUND(p_amount / ARRAY_LENGTH(v_guarantors, 1), 2)
  FROM UNNEST(v_guarantors) AS g;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = auth.uid() AND sacco_id = p_sacco_id AND account_type = 'loan'
  LIMIT 1;

  -- The disbursement sits pending from the outset, as before, so the admin approval that
  -- issues the loan is the same action it has always been. 0024 stops that approval
  -- landing before the fee and the guarantors have cleared.
  INSERT INTO public.transactions (
    sacco_id, profile_id, account_id, loan_id, amount, direction,
    category, status, description, requested_by
  )
  VALUES (
    p_sacco_id, auth.uid(), v_account_id, v_loan_id, p_amount, 'debit',
    'loan_disbursement', 'pending',
    'Loan ' || COALESCE(v_loan_number, '') || ': ' || COALESCE(p_purpose, 'general')
      || ' | ' || p_term_months || ' month(s)',
    auth.uid()
  );

  -- The application fee, owed immediately and confirmed by an admin before the
  -- guarantors are asked for anything.
  IF v_fee > 0 THEN
    INSERT INTO public.transactions (
      sacco_id, profile_id, loan_id, amount, direction,
      category, status, description, requested_by
    )
    VALUES (
      p_sacco_id, auth.uid(), v_loan_id, v_fee, 'credit',
      'fee', 'pending', 'Loan application fee (' || COALESCE(v_loan_number, 'loan') || ')',
      auth.uid()
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'loan_id', v_loan_id,
    'loan_number', v_loan_number,
    'loan_type', v_type,
    'application_fee', v_fee,
    'total_repayable', v_total,
    'installment_amount', ROUND(v_total / p_term_months, 2),
    'guarantors', ARRAY_LENGTH(v_guarantors, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.request_loan(UUID, NUMERIC, INTEGER, TEXT, TEXT, NUMERIC, DATE, UUID[]) TO authenticated;


-- ====================================================================================
-- Two members of HTS-5050 both hold 'MEM-022' (Simon Kasozi and Jane Nabwire), so they
-- share one loan-number series. Nothing breaks, but their numbers will not read as
-- "my first loan" once both have borrowed. To find any others:
--
--   SELECT group_id, member_number, COUNT(*), STRING_AGG(full_name, ' / ')
--   FROM public.profiles
--   GROUP BY group_id, member_number
--   HAVING COUNT(*) > 1;
-- ====================================================================================
