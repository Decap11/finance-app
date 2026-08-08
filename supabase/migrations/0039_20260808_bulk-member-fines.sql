-- ====================================================================================
-- MIGRATION 0039: Levy a whole meeting's absence fines in one call
-- ====================================================================================
--
-- src/app/api/admin/fines/route.js issued fines like this:
--
--   for (const target of targets) {
--     await supabase.rpc('levy_member_fine', { ... });   -- one round trip each
--   }
--
-- Closing a register with thirty absentees was thirty sequential round trips from the
-- serverless function to Postgres, each paying full network latency, and each opening its
-- own transaction. At one user nobody notices. On a meeting day with several SACCOs
-- closing registers at once it is the slowest thing the app does, and it is slow for a
-- reason that has nothing to do with the work: the work is thirty rows.
--
-- Worse than the latency, it was not atomic. A failure on member nineteen left eighteen
-- fines standing and eleven never issued, with nothing to roll back to -- the route
-- reported a partial success and the admin had no way to tell which half had landed.
--
-- This does the whole set in one statement, in one transaction. Either the meeting's
-- fines are all issued or none are.
--
-- The per-member function stays exactly as it is. It is still the right call for a single
-- fine levied by hand, it is still what waive_member_fine pairs with, and rewriting the
-- single case in terms of the bulk one would buy nothing.
-- ====================================================================================


CREATE OR REPLACE FUNCTION public.levy_member_fines_bulk(
  p_profile_ids UUID[],
  p_amount      NUMERIC,
  p_fine_type   TEXT,
  p_description TEXT    DEFAULT NULL,
  p_week_number INTEGER DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_sacco_id  UUID;
  v_sacco_ids UUID[];
  v_ids       UUID[];
  v_issued    INTEGER := 0;
  v_tx_ids    UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A fine must be greater than zero';
  END IF;

  IF p_fine_type IS NULL OR btrim(p_fine_type) = '' THEN
    RAISE EXCEPTION 'A fine must say what it is for';
  END IF;

  -- Deduplicated. The same member named twice in one register is a UI slip, not an
  -- instruction to fine them twice for one meeting.
  SELECT array_agg(DISTINCT id) INTO v_ids
  FROM unnest(p_profile_ids) AS id
  WHERE id IS NOT NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Name at least one member to fine';
  END IF;

  -- ---------------------------------------------------------------------------------
  -- Authorization. The SACCO is resolved from the MEMBERS, never from the caller, and
  -- the caller is then checked against it -- the same ordering log_historical_record
  -- and settle_mandatory_weeks use, and the thing that stops an admin of one group
  -- writing into another.
  --
  -- Every member named must belong to ONE SACCO. A list spanning two groups is not a
  -- partially-valid request to be trimmed down; it means the caller has built the list
  -- from something other than a single register, and silently fining the subset it was
  -- allowed to would hide that.
  -- ---------------------------------------------------------------------------------
  SELECT array_agg(DISTINCT sm.sacco_id) INTO v_sacco_ids
  FROM public.sacco_memberships sm
  WHERE sm.profile_id = ANY(v_ids);

  IF v_sacco_ids IS NULL OR array_length(v_sacco_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Those members do not belong to a SACCO';
  END IF;

  IF array_length(v_sacco_ids, 1) > 1 THEN
    RAISE EXCEPTION 'Those members belong to different SACCOs; fines must be issued one group at a time';
  END IF;

  v_sacco_id := v_sacco_ids[1];

  IF NOT public.is_sacco_staff(v_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may issue a fine';
  END IF;

  -- Every member named must actually be in that SACCO. Without this a caller could pad
  -- the list with ids from elsewhere and have them fined against this group.
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) AS id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.sacco_memberships sm
      WHERE sm.profile_id = id AND sm.sacco_id = v_sacco_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more of those members is not in this SACCO';
  END IF;

  -- ---------------------------------------------------------------------------------
  -- One statement, one transaction. This is the whole point of the migration.
  -- ---------------------------------------------------------------------------------
  WITH inserted AS (
    INSERT INTO public.transactions (
      sacco_id, profile_id, direction, category, fine_type,
      amount, status, description, week_number, requested_by
    )
    SELECT
      v_sacco_id, id, 'credit', 'fines', btrim(p_fine_type),
      p_amount, 'pending', p_description, p_week_number, auth.uid()
    FROM unnest(v_ids) AS id
    RETURNING id AS tx_id
  )
  SELECT count(*)::INTEGER, array_agg(tx_id) INTO v_issued, v_tx_ids FROM inserted;

  RETURN json_build_object(
    'success', true,
    'issued', v_issued,
    'sacco_id', v_sacco_id,
    'amount', p_amount,
    'fine_type', btrim(p_fine_type),
    'transaction_ids', v_tx_ids
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.levy_member_fines_bulk(UUID[], NUMERIC, TEXT, TEXT, INTEGER) IS
  'Issues one fine to each of many members in a single statement and a single transaction. Replaces the per-member loop the fines route used, which cost one round trip per absentee and could leave a register half-fined on failure.';

REVOKE ALL ON FUNCTION public.levy_member_fines_bulk(UUID[], NUMERIC, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.levy_member_fines_bulk(UUID[], NUMERIC, TEXT, TEXT, INTEGER) TO authenticated;


-- ====================================================================================
-- Verify, after running:
--
--   -- As an admin, fine two members of your own SACCO for one meeting:
--   SELECT public.levy_member_fines_bulk(
--     ARRAY['<member-a>','<member-b>']::uuid[], 1000, 'absenteeism', 'Missed meeting', 12
--   );
--   -- => { "success": true, "issued": 2, ... }
--
--   -- Refused, rather than partially applied, when the list spans two groups:
--   SELECT public.levy_member_fines_bulk(
--     ARRAY['<member-in-sacco-a>','<member-in-sacco-b>']::uuid[], 1000, 'absenteeism'
--   );
--   -- => ERROR: those members belong to different SACCOs
--
-- The route falls back to the per-member loop when this function is absent, so a database
-- without this migration keeps working exactly as before -- just as slowly.
-- ====================================================================================
