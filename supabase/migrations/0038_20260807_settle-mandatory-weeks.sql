-- ====================================================================================
-- MIGRATION 0038: Registering an arrears payment against the week it settles
-- ====================================================================================
--
-- Until now there was no way to record WHICH week a late payment cleared.
--
-- Arrears are derived, never stored (src/utils/duesEngine.js). `owed` is expected minus
-- paid as a running total, so a member four weeks behind who hands over four weeks' money
-- goes to zero and the debt disappears -- correctly, as a total. What vanished with it was
-- any record of what the money was for. The contribution heatmap keys a payment to the
-- meeting it was RECEIVED at, so the missed week stayed blank forever while the arrears
-- card read "all members are current". Two screens, both right, permanently disagreeing,
-- and nothing in the schema connecting them.
--
-- The same running total had a second and worse consequence in the other direction: a
-- member who paid AHEAD built credit that silently answered for weeks they later skipped.
-- No banner, no row on the admin's card, nothing to chase. The arrears alarm could be
-- switched off in advance simply by overpaying, which the social fund form actively
-- invites ("give more if you wish").
--
-- This function is the missing statement of intent. It writes one completed transaction
-- per week being settled, each stamped with `week_number`, which duesEngine's allocator
-- treats as outranking any inference it would otherwise make. The heatmap, once it prefers
-- week_number over created_at, then draws the money on the meeting it was owed at.
--
-- WHY ONE ROW PER WEEK, not one row for the lump sum.
--
--   Each row is a single week's obligation being met, which is what it actually is. It
--   keeps `amount` equal to the weekly rate, so nothing downstream has to divide a total
--   by a rate that may have changed since. It also means a mistake is reversible one week
--   at a time rather than all or nothing. transactions.week_number has existed since 0021
--   and is already read this way by the fines manager and the manual log, so this adds no
--   column and no table.
--
-- WHY created_at IS TODAY, not the settled week's meeting date.
--
--   Because that is when the money arrived, and the ledger should say so. Backdating
--   created_at is what Historical Onboarding exists for (0028) and it is deliberately
--   gated -- routine arrears collection must not require switching a SACCO into a mode
--   meant for copying a paper book. week_number carries the attribution instead, which is
--   precisely the separation this migration is adding: WHEN the cash landed and WHAT it
--   was for are two different facts and now have two different fields.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the settlement itself
--
-- Authorization mirrors log_historical_record (0028): the SACCO is resolved from the
-- MEMBER, never from the caller, and the caller is then checked against that SACCO. That
-- ordering is what stops an admin of one group writing rows into another.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.settle_mandatory_weeks(
  p_member_id UUID,
  p_category  TEXT,
  p_weeks     INTEGER[],
  p_note      TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_sacco_id     UUID;
  v_rate         NUMERIC;
  v_account_id   UUID;
  v_week         INTEGER;
  v_weeks        INTEGER[];
  v_tx_id        UUID;
  v_ids          UUID[] := '{}';
  v_total        NUMERIC := 0;
  v_description  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Only the two funds that are owed on a schedule. Shares are the member's own choice
  -- of 1-10 and fines are levied for a reason, so neither can be "a week in arrears" and
  -- neither belongs here. duesEngine.MANDATORY_FUNDS is the same list.
  IF p_category NOT IN ('development_fund', 'social_fund') THEN
    RAISE EXCEPTION 'Only development_fund and social_fund are owed weekly (got %).', p_category;
  END IF;

  IF p_weeks IS NULL OR array_length(p_weeks, 1) IS NULL THEN
    RAISE EXCEPTION 'Name at least one week to settle';
  END IF;

  -- Deduplicated and ordered. Passing the same week twice would otherwise write two rows
  -- against one obligation and overpay the member's account by a week.
  SELECT array_agg(DISTINCT w ORDER BY w) INTO v_weeks
  FROM unnest(p_weeks) AS w
  WHERE w BETWEEN 1 AND 52;

  IF v_weeks IS NULL THEN
    RAISE EXCEPTION 'Week numbers must be between 1 and 52';
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
    RAISE EXCEPTION 'That member does not belong to a SACCO';
  END IF;

  IF NOT public.is_sacco_staff(v_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may register a payment';
  END IF;

  -- The weekly rate, read from the SACCO's settings and falling back to the saccos row
  -- the way every other rate lookup in this schema does.
  SELECT CASE WHEN p_category = 'development_fund' THEN ss.devt_fund ELSE ss.social_fund END
    INTO v_rate
  FROM public.sacco_settings ss
  WHERE ss.sacco_id = v_sacco_id
  LIMIT 1;

  IF v_rate IS NULL THEN
    SELECT CASE WHEN p_category = 'development_fund' THEN s.devt_fund ELSE s.social_fund END
      INTO v_rate
    FROM public.saccos s
    WHERE s.id = v_sacco_id;
  END IF;

  IF COALESCE(v_rate, 0) <= 0 THEN
    RAISE EXCEPTION 'This SACCO has no weekly amount set for %', p_category;
  END IF;

  -- The member's account for this fund, created if this is the first money it has ever
  -- held. Same resolution approve_member_transaction uses, via the 0024 mapping.
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = p_member_id
    AND sacco_id = v_sacco_id
    AND account_type = public.account_type_for_category(p_category)
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
    VALUES (v_sacco_id, p_member_id, public.account_type_for_category(p_category), 0)
    RETURNING id INTO v_account_id;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- One row per week. Refusing a week that is already settled rather than writing a
  -- second row for it: this function is reachable twice from a double-tapped button, and
  -- the second call must not quietly double the member's credit.
  -- ---------------------------------------------------------------------------------
  FOREACH v_week IN ARRAY v_weeks LOOP
    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE profile_id = p_member_id
        AND sacco_id   = v_sacco_id
        AND category   = p_category
        AND week_number = v_week
        AND status IN ('completed', 'approved')
        AND reference  = 'SETTLEMENT'
    ) THEN
      CONTINUE;
    END IF;

    v_description := 'Arrears settlement: Week ' || v_week
      || COALESCE(' - ' || NULLIF(btrim(p_note), ''), '')
      || ' | Week ' || v_week;

    INSERT INTO public.transactions (
      sacco_id, profile_id, account_id, amount, direction, category,
      status, description, reference, week_number,
      requested_by, approved_by, approved_at, completed_at
    ) VALUES (
      v_sacco_id, p_member_id, v_account_id, v_rate, 'credit', p_category,
      'completed', v_description, 'SETTLEMENT', v_week,
      auth.uid(), auth.uid(), now(), now()
    )
    RETURNING id INTO v_tx_id;

    v_ids   := v_ids || v_tx_id;
    v_total := v_total + v_rate;
  END LOOP;

  IF v_total > 0 THEN
    UPDATE public.accounts
    SET balance = balance + v_total, updated_at = now()
    WHERE id = v_account_id;
  END IF;

  -- Who registered what, for whom, and for which weeks. approved_by on each row already
  -- names the admin; this records the act as one decision rather than N unrelated ones.
  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'transaction', p_member_id, 'settle_mandatory_weeks',
    json_build_object(
      'category', p_category,
      'weeks', v_weeks,
      'rate', v_rate,
      'total', v_total,
      'transactions', v_ids,
      'note', NULLIF(btrim(p_note), '')
    )
  );

  RETURN json_build_object(
    'success', true,
    -- Weeks ASKED for versus weeks WRITTEN differ whenever one was already settled. The
    -- caller reports the difference rather than claiming to have banked money it skipped.
    'requested_weeks', v_weeks,
    'settled_weeks', array_length(v_ids, 1),
    'rate', v_rate,
    'total', v_total,
    'transaction_ids', v_ids
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.settle_mandatory_weeks(UUID, TEXT, INTEGER[], TEXT) IS
  'Registers a member''s arrears payment against the specific weeks it clears. Writes one completed transaction per week, stamped with week_number so the dues ledger and the contribution heatmap agree on what the money was for. Dated today, because that is when the cash arrived.';

REVOKE ALL ON FUNCTION public.settle_mandatory_weeks(UUID, TEXT, INTEGER[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_mandatory_weeks(UUID, TEXT, INTEGER[], TEXT) TO authenticated;


-- ====================================================================================
-- STEP 2: make the duplicate guard above cheap
--
-- The EXISTS runs once per week settled. Without this it is a sequential scan of the
-- whole transactions table each time, on the one table that grows fastest.
-- ====================================================================================
CREATE INDEX IF NOT EXISTS transactions_member_week_category_idx
  ON public.transactions (profile_id, category, week_number)
  WHERE week_number IS NOT NULL;


-- ====================================================================================
-- Verify, after running:
--
--   -- As an admin of the member's SACCO, settle weeks 10 and 12 of the social fund:
--   SELECT public.settle_mandatory_weeks(
--     '<member-uuid>'::uuid, 'social_fund', ARRAY[10, 12], 'Paid cash at the 12th meeting'
--   );
--
--   -- Two rows, each one week's rate, each carrying its week:
--   SELECT week_number, amount, status, reference, created_at::date
--   FROM public.transactions
--   WHERE profile_id = '<member-uuid>' AND reference = 'SETTLEMENT'
--   ORDER BY week_number;
--
--   -- Running it again settles nothing and banks nothing:
--   SELECT public.settle_mandatory_weeks('<member-uuid>'::uuid, 'social_fund', ARRAY[10]);
--   -- => settled_weeks: null, total: 0
--
-- Until this migration is applied the settlement endpoint returns 501 and the admin card
-- shows the outstanding weeks read-only -- the ledger is derived, so it is correct with or
-- without this function. What is missing without it is the ability to answer back.
-- ====================================================================================
