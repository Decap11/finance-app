-- ====================================================================================
-- 0028: historical onboarding -- backfilling a SACCO's paper records
--
-- WHY THIS FILE EXISTS
--
-- The Historical Onboarding tab has never written a single row. /api/admin/manual-
-- contribution builds its Supabase client with the ANON key plus the caller's JWT, so it
-- runs as `authenticated` and RLS applies to every statement it issues. Against the
-- policies this database actually has:
--
--   * transactions INSERT -- the only policy is 0019's
--     `transactions_insert_own_pending_contribution`, which demands
--     profile_id = auth.uid() AND status = 'pending' AND approved_by IS NULL AND
--     category IN (shares, development_fund, social_fund). Backfilling writes another
--     member's profile_id with status 'completed'. Refused on several counts at once.
--   * loans INSERT -- no INSERT policy exists at all (0002 and 0019 define SELECT only).
--     Refused.
--   * accounts UPDATE -- no UPDATE policy exists either; 0015 dropped 0010's permissive
--     `accounts_all_policy` and replaced it with SELECT only. Refused.
--
-- So the feature failed at its first write and surfaced as a generic 500. Routing the
-- whole operation through one SECURITY DEFINER function is what makes it possible at
-- all, and it fixes four other things in the same move:
--
--   1. ATOMICITY. The old route issued three or four separate HTTP round trips. A
--      failure partway left a loan with no transaction, or a transaction with no balance
--      change. A plpgsql function is one transaction: it all lands or none of it does.
--      That mattered most for loans -- an orphaned 'issued' loan trips 0025's one-open-
--      loan-per-type rule and permanently blocks that member from borrowing again.
--   2. THE DATE IT HAPPENED. The old route never set created_at, so every backfilled
--      row was stamped with today's date and the whole point was lost. See below.
--   3. CROSS-TENANT WRITES. The old route checked `role = 'admin'` on the caller's own
--      profile and then accepted any member id at all, so an admin of one SACCO could
--      write records against a member of another. Authorization here is
--      `is_sacco_staff(the member's own sacco)`, which is both checks in one.
--   4. week_number was never written, so backfilled rows were invisible to every query
--      that filters on it, and consumers had to regex the week back out of the
--      description text.
--
-- THE DATE IT HAPPENED
--
-- transactions.created_at is a plain DATE with a default, not a generated column, so it
-- can simply be set -- and it is the field every consumer already treats as "when this
-- happened": the heatmap buckets by it, meetingDateUtils reads
-- completed_at || approved_at || created_at, and the trend RPC in 0027 sums by it.
-- All three are set to the supplied date, because leaving completed_at at today's date
-- would put the right money on the wrong meeting.
--
-- Loans carry their own timestamps (requested_at / approved_at / disbursed_at) and get
-- the same treatment, so a loan issued in March 2024 reports as issued in March 2024 and
-- its due date is computed from then rather than from the day it was typed in.
--
-- WHAT COUNTS AS A RECORD
--
-- Every category the ledger already understands and that a SACCO could plausibly have on
-- paper: the four contribution pools, fines, loans issued, loan repayments, and
-- dividends already paid out. Account movement is resolved through 0024's
-- account_type_for_category and applied with exactly the arithmetic
-- approve_member_transaction uses, so a backfilled record and an approved live one move
-- money identically. Categories with no account behind them (dividend, fee, adjustment)
-- record the event and touch no balance -- again matching 0024.
--
-- Rows written here carry reference = 'HISTORICAL', which is what makes a backfill
-- identifiable after the fact without having to parse the description.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: which meeting week a date falls in
--
-- The application's sense of a "week" is the Nth occurrence of the SACCO's meeting day
-- within that date's own calendar year -- the same rule the week picker in the admin
-- form uses. Extracted here so the number stored on the row and the number shown in the
-- UI cannot drift apart.
--
-- Deliberately per-year rather than continuous: week_number has always been a
-- within-year index, and the fines and attendance managers compare it against
-- sacco_settings.current_week, which resets the same way.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.meeting_week_of(p_on DATE, p_meeting_day TEXT)
RETURNS INTEGER AS $$
  SELECT GREATEST(COUNT(*), 1)::INTEGER
  FROM generate_series(
    date_trunc('year', p_on::TIMESTAMP),
    p_on::TIMESTAMP,
    INTERVAL '1 day'
  ) AS d
  WHERE EXTRACT(DOW FROM d) = CASE lower(COALESCE(p_meeting_day, 'wednesday'))
    WHEN 'sunday'    THEN 0
    WHEN 'monday'    THEN 1
    WHEN 'tuesday'   THEN 2
    WHEN 'wednesday' THEN 3
    WHEN 'thursday'  THEN 4
    WHEN 'friday'    THEN 5
    WHEN 'saturday'  THEN 6
    ELSE 3
  END;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION public.meeting_week_of(DATE, TEXT) IS
  'Nth occurrence of the SACCO meeting day within the date''s own calendar year. Minimum 1, for a date falling before the year''s first meeting day.';

GRANT EXECUTE ON FUNCTION public.meeting_week_of(DATE, TEXT) TO authenticated;


-- ====================================================================================
-- STEP 2: log_historical_record
--
-- One record per call. The admin form loops for a batch; keeping the unit small means a
-- single bad row is rejected with a message naming what was wrong with it, rather than
-- failing a whole evening's typing.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.log_historical_record(
  p_member_id     UUID,
  p_category      TEXT,
  p_amount        NUMERIC,
  p_occurred_on   DATE,
  p_description   TEXT    DEFAULT NULL,
  p_fine_type     TEXT    DEFAULT NULL,
  p_loan_id       UUID    DEFAULT NULL,
  p_loan_type     TEXT    DEFAULT 'normal',
  p_term_months   INTEGER DEFAULT 1,
  p_purpose       TEXT    DEFAULT NULL,
  p_interest_rate NUMERIC DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_sacco_id     UUID;
  v_meeting_day  TEXT;
  v_historical   BOOLEAN;
  v_week_number  INTEGER;
  v_account_type TEXT;
  v_account_id   UUID;
  v_direction    TEXT;
  v_label        TEXT;
  v_description  TEXT;
  v_tx_id        UUID;
  v_loan         public.loans;
  v_loan_id      UUID;
  v_loan_type    TEXT;
  v_term         INTEGER;
  v_rate         NUMERIC;
  v_total        NUMERIC;
  v_new_balance  NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- ---------------------------------------------------------------------------------
  -- Whose SACCO is this? Resolved from the MEMBER, never from the caller. The caller is
  -- then checked against that SACCO, which is what stops an admin of one group writing
  -- into another.
  -- ---------------------------------------------------------------------------------
  SELECT sm.sacco_id INTO v_sacco_id
  FROM public.sacco_memberships sm
  WHERE sm.profile_id = p_member_id AND sm.status = 'active'
  LIMIT 1;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.profiles p
    JOIN public.saccos s ON s.group_code = p.group_id
    WHERE p.id = p_member_id
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to a SACCO';
  END IF;

  IF NOT public.is_sacco_staff(v_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may backfill its records';
  END IF;

  -- ---------------------------------------------------------------------------------
  -- The SACCO's own settings: which day it meets, and whether historical onboarding is
  -- switched on. Read before validation because the date rule below depends on the flag.
  -- ---------------------------------------------------------------------------------
  SELECT ss.meeting_day, ss.is_historical_mode
    INTO v_meeting_day, v_historical
  FROM public.sacco_settings ss
  WHERE ss.sacco_id = v_sacco_id
  LIMIT 1;

  -- sacco_settings is the row the settings screen writes, but a SACCO registered before
  -- that table existed carries the flag only on `saccos`. Falling back matters: treating
  -- a missing settings row as "switched off" would block backfilling for exactly the
  -- oldest groups, which are the ones most likely to have paper records.
  IF v_historical IS NULL THEN
    SELECT s.is_historical_mode INTO v_historical
    FROM public.saccos s WHERE s.id = v_sacco_id;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- Validation. Every message is written to be shown to the admin as-is.
  -- ---------------------------------------------------------------------------------
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF p_occurred_on IS NULL THEN
    RAISE EXCEPTION 'A historical record must say what date it happened on';
  END IF;

  -- The whole feature is for events that already happened. A future date is always a
  -- typo, and it would land the row in a meeting that has not taken place.
  IF p_occurred_on > current_date THEN
    RAISE EXCEPTION 'That date (%) is in the future. Historical records must be dated on or before today.', p_occurred_on;
  END IF;

  IF p_occurred_on < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'That date (%) looks wrong -- it is before the year 2000.', p_occurred_on;
  END IF;

  -- Backdating is what the historical onboarding switch governs. With it off this
  -- function still serves the ordinary current-week logging path, so a record dated
  -- today is fine and anything earlier is refused.
  --
  -- Enforced here rather than only in the form: the switch decides whether a SACCO's
  -- ledger may be written retroactively at all, and a check that lives only in the
  -- browser is not a rule, it is a suggestion.
  IF p_occurred_on < current_date AND NOT COALESCE(v_historical, false) THEN
    RAISE EXCEPTION 'Historical onboarding is switched off for this SACCO. Turn it on in Configuration Settings before recording a backdated entry.';
  END IF;

  IF p_category NOT IN (
    'shares', 'development_fund', 'social_fund', 'savings',
    'fines', 'loan_disbursement', 'loan_repayment', 'dividend'
  ) THEN
    RAISE EXCEPTION 'Cannot backfill a record of type "%"', p_category;
  END IF;

  IF p_category = 'fines' AND (p_fine_type IS NULL OR btrim(p_fine_type) = '') THEN
    RAISE EXCEPTION 'A fine must say what it was for';
  END IF;

  -- One entry per member, per pool, per day. Fines, repayments and dividends are
  -- deliberately exempt: a member can genuinely be fined twice in one day for different
  -- reasons, and can make more than one repayment.
  IF p_category IN ('shares', 'development_fund', 'social_fund', 'savings') THEN
    IF EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.profile_id = p_member_id
        AND t.sacco_id   = v_sacco_id
        AND t.category   = p_category
        AND t.status IN ('completed', 'approved')
        AND t.created_at = p_occurred_on
    ) THEN
      RAISE EXCEPTION 'A % entry is already recorded for that member on %.', p_category, p_occurred_on;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- Meeting week for the date's own year.
  -- ---------------------------------------------------------------------------------
  SELECT ss.meeting_day INTO v_meeting_day
  FROM public.sacco_settings ss
  WHERE ss.sacco_id = v_sacco_id
  LIMIT 1;

  v_week_number := public.meeting_week_of(p_occurred_on, COALESCE(v_meeting_day, 'Wednesday'));

  -- ---------------------------------------------------------------------------------
  -- The member's account for this category, created if this is their first such record.
  -- Mirrors approve_member_transaction; dividend and fee map to NULL and move nothing.
  -- ---------------------------------------------------------------------------------
  v_account_type := public.account_type_for_category(p_category);

  IF v_account_type IS NOT NULL THEN
    SELECT a.id INTO v_account_id
    FROM public.accounts a
    WHERE a.profile_id = p_member_id
      AND a.sacco_id   = v_sacco_id
      AND a.account_type = v_account_type
    LIMIT 1;

    IF v_account_id IS NULL THEN
      INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
      VALUES (v_sacco_id, p_member_id, v_account_type, 0)
      RETURNING id INTO v_account_id;
    END IF;
  END IF;

  -- Money into the SACCO is a credit; money out to the member is a debit.
  v_direction := CASE
    WHEN p_category IN ('loan_disbursement', 'dividend') THEN 'debit'
    ELSE 'credit'
  END;

  v_label := CASE p_category
    WHEN 'shares'            THEN 'Shares'
    WHEN 'development_fund'  THEN 'Development Fund'
    WHEN 'social_fund'       THEN 'Social Fund'
    WHEN 'savings'           THEN 'Savings'
    WHEN 'fines'             THEN 'Fine (' || btrim(p_fine_type) || ')'
    WHEN 'loan_disbursement' THEN 'Loan disbursed'
    WHEN 'loan_repayment'    THEN 'Loan repayment'
    WHEN 'dividend'          THEN 'Dividend paid'
  END;

  -- The trailing "| Week N" is kept even though week_number is now written properly:
  -- calendarHeatMap and meetingDateUtils both still fall back to regexing it out of the
  -- description, and older rows have nothing else. Cheap belt and braces.
  v_description := v_label
    || COALESCE(' - ' || NULLIF(btrim(p_description), ''), '')
    || ' | Week ' || v_week_number;

  -- ---------------------------------------------------------------------------------
  -- A loan being issued: the loan row comes first so the transaction can point at it.
  -- ---------------------------------------------------------------------------------
  IF p_category = 'loan_disbursement' THEN
    v_loan_type := COALESCE(NULLIF(btrim(p_loan_type), ''), 'normal');

    IF v_loan_type NOT IN ('normal', 'social_fund') THEN
      RAISE EXCEPTION 'Unknown loan type "%"', v_loan_type;
    END IF;

    -- Same rule as 0025: one open loan per type, not one open loan overall.
    IF EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.profile_id = p_member_id
        AND l.loan_type = v_loan_type
        AND public.loan_is_open(l.status)
    ) THEN
      RAISE EXCEPTION 'That member already has an open % loan. Record its repayments first, or close it.',
        CASE WHEN v_loan_type = 'social_fund' THEN 'Social Fund emergency' ELSE 'normal' END;
    END IF;

    v_term := GREATEST(COALESCE(p_term_months, 1), 1);
    v_rate := CASE WHEN v_loan_type = 'social_fund' THEN 0 ELSE COALESCE(p_interest_rate, 5) END;
    -- Flat interest across the term, identical to request_loan in 0025.
    v_total := ROUND(p_amount * (1 + (v_rate / 100.0) * v_term), 2);

    -- guarantor_status is left at its 'not_required' default on purpose: a loan that was
    -- issued years ago on paper is not waiting for anybody to sign for it.
    INSERT INTO public.loans (
      sacco_id, profile_id, amount_requested, amount_approved, outstanding_balance,
      interest_rate, term_months, purpose, loan_type, status,
      requested_at, approved_by, approved_at, disbursed_at, due_date,
      total_repayable, installment_amount
    ) VALUES (
      v_sacco_id, p_member_id, p_amount, p_amount, v_total,
      v_rate, v_term, COALESCE(NULLIF(btrim(p_purpose), ''), 'Historical loan (pre-onboarding)'),
      v_loan_type, 'issued',
      p_occurred_on, auth.uid(), p_occurred_on, p_occurred_on,
      (p_occurred_on + (v_term || ' months')::INTERVAL)::DATE,
      v_total, ROUND(v_total / v_term, 2)
    )
    RETURNING id INTO v_loan_id;

  -- ---------------------------------------------------------------------------------
  -- A repayment against a loan that already exists.
  -- ---------------------------------------------------------------------------------
  ELSIF p_category = 'loan_repayment' THEN
    IF p_loan_id IS NULL THEN
      RAISE EXCEPTION 'Say which loan this repayment was against';
    END IF;

    SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'That loan no longer exists';
    END IF;

    IF v_loan.profile_id <> p_member_id THEN
      RAISE EXCEPTION 'That loan belongs to a different member';
    END IF;

    IF v_loan.sacco_id <> v_sacco_id THEN
      RAISE EXCEPTION 'That loan belongs to a different SACCO';
    END IF;

    -- A repayment cannot predate the money being handed over.
    IF v_loan.disbursed_at IS NOT NULL AND p_occurred_on < v_loan.disbursed_at::DATE THEN
      RAISE EXCEPTION 'That repayment (%) is dated before the loan was issued (%).',
        p_occurred_on, v_loan.disbursed_at::DATE;
    END IF;

    IF p_amount > v_loan.outstanding_balance THEN
      RAISE EXCEPTION 'That is more than is left to pay on the loan. Outstanding is %.',
        v_loan.outstanding_balance;
    END IF;

    v_loan_id := p_loan_id;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- The ledger row. created_at / approved_at / completed_at all carry the real date --
  -- this is what puts the record on the right meeting in every view.
  -- ---------------------------------------------------------------------------------
  INSERT INTO public.transactions (
    sacco_id, profile_id, account_id, loan_id, amount, direction, category,
    fine_type, status, description, reference, week_number,
    requested_by, approved_by, created_at, approved_at, completed_at
  ) VALUES (
    v_sacco_id, p_member_id, v_account_id, v_loan_id, p_amount, v_direction, p_category,
    CASE WHEN p_category = 'fines' THEN btrim(p_fine_type) ELSE NULL END,
    'completed', v_description, 'HISTORICAL', v_week_number,
    auth.uid(), auth.uid(), p_occurred_on, p_occurred_on, p_occurred_on
  )
  RETURNING id INTO v_tx_id;

  -- ---------------------------------------------------------------------------------
  -- Balance movement -- the same four branches as approve_member_transaction, in the
  -- same order, so a backfilled record and an approved live one are indistinguishable
  -- in their effect. A debit that would take a fund below zero is left to fail loudly on
  -- the balance >= 0 constraint rather than being clamped, exactly as it does there.
  -- ---------------------------------------------------------------------------------
  IF v_account_id IS NOT NULL THEN
    IF p_category = 'loan_disbursement' THEN
      UPDATE public.accounts SET balance = balance + p_amount, updated_at = now()
      WHERE id = v_account_id;
    ELSIF p_category = 'loan_repayment' THEN
      UPDATE public.accounts SET balance = GREATEST(balance - p_amount, 0), updated_at = now()
      WHERE id = v_account_id;
    ELSIF v_direction = 'credit' THEN
      UPDATE public.accounts SET balance = balance + p_amount, updated_at = now()
      WHERE id = v_account_id;
    ELSE
      UPDATE public.accounts SET balance = balance - p_amount, updated_at = now()
      WHERE id = v_account_id;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- Loan side effects. on_transaction_approval is an AFTER UPDATE OF status trigger, so
  -- it does NOT fire for a row inserted already 'completed' -- everything it would have
  -- done has to be done here, with the historical date instead of now().
  -- ---------------------------------------------------------------------------------
  IF p_category = 'loan_repayment' THEN
    v_new_balance := GREATEST(COALESCE(v_loan.outstanding_balance, 0) - p_amount, 0);

    UPDATE public.loans
    SET outstanding_balance = v_new_balance,
        status    = CASE WHEN v_new_balance = 0 THEN 'completed' ELSE loans.status END,
        closed_at = CASE WHEN v_new_balance = 0 THEN p_occurred_on::TIMESTAMPTZ ELSE loans.closed_at END
    WHERE id = v_loan_id;

    INSERT INTO public.loan_repayments (loan_id, transaction_id, amount, paid_at, source_account_id)
    VALUES (v_loan_id, v_tx_id, p_amount, p_occurred_on::TIMESTAMPTZ, v_account_id)
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;

  -- Backfilling money is exactly the kind of act that should leave a trace.
  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'transaction', v_tx_id, 'historical_backfill',
    json_build_object(
      'member_id',   p_member_id,
      'category',    p_category,
      'amount',      p_amount,
      'occurred_on', p_occurred_on,
      'week_number', v_week_number,
      'loan_id',     v_loan_id
    )::JSONB
  );

  RETURN json_build_object(
    'success',        true,
    'transaction_id', v_tx_id,
    'loan_id',        v_loan_id,
    'week_number',    v_week_number,
    'occurred_on',    p_occurred_on,
    'category',       p_category,
    'amount',         p_amount,
    'moved_balance',  v_account_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.log_historical_record(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, NUMERIC) IS
  'Backfills one pre-onboarding SACCO record (contribution, fine, loan, repayment or dividend) with the date it actually happened. Caller must be staff of the member''s own SACCO. Atomic: ledger row, balance and loan side effects all land together or not at all.';

GRANT EXECUTE ON FUNCTION public.log_historical_record(UUID, TEXT, NUMERIC, DATE, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, NUMERIC) TO authenticated;


-- ====================================================================================
-- STEP 3: the member's open loans, for the repayment picker
--
-- The admin form has to offer "which loan was this repayment against". Members' loans
-- are readable by staff under 0019's loans_select_own_or_staff, but that policy resolves
-- staff through sacco_memberships, and the form needs the SAME set the RPC above will
-- accept -- including loans of a member whose membership row is missing but whose
-- profile still carries the group code. Returning it from one place keeps the picker and
-- the validation in agreement.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.get_member_open_loans(p_member_id UUID)
RETURNS TABLE (
  id                  UUID,
  loan_number         TEXT,
  loan_type           TEXT,
  status              TEXT,
  amount_approved     NUMERIC,
  outstanding_balance NUMERIC,
  disbursed_at        TIMESTAMPTZ
) AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT sm.sacco_id INTO v_sacco_id
  FROM public.sacco_memberships sm
  WHERE sm.profile_id = p_member_id AND sm.status = 'active'
  LIMIT 1;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.profiles p
    JOIN public.saccos s ON s.group_code = p.group_id
    WHERE p.id = p_member_id
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.is_sacco_staff(v_sacco_id) AND p_member_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized to view this member''s loans';
  END IF;

  RETURN QUERY
  SELECT l.id, l.loan_number, l.loan_type, l.status,
         l.amount_approved, l.outstanding_balance, l.disbursed_at
  FROM public.loans l
  WHERE l.profile_id = p_member_id
    AND l.sacco_id = v_sacco_id
    AND public.loan_is_open(l.status)
  ORDER BY l.disbursed_at NULLS LAST, l.requested_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_member_open_loans(UUID) TO authenticated;
