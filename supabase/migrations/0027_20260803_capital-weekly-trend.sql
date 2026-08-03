-- ====================================================================================
-- 0027: week-on-week movement of the SACCO's total capital
--
-- The "Total SACCO Assets" card on Pools & Funds has always ended in a hardcoded
-- "+0.0% this week" with a hardcoded upward arrow. This is the number behind it.
--
-- WHAT THE PERCENTAGE MEANS
-- How much the pot grew (or shrank) during the current week, measured against what the
-- pot was worth when the week opened:
--
--     pct = current_week_net / opening_capital * 100
--
-- So "+4.2% this week" reads as "the SACCO holds 4.2% more than it did on Monday".
-- previous_week_net is returned alongside it because the same three numbers also answer
-- "did we collect more this week than last week", and a caller that wants that framing
-- should not need a second round trip or a second function.
--
-- WHICH CATEGORIES COUNT
-- Deliberately the four the card itself adds up -- shares, development_fund,
-- social_fund, fines -- and NOT 'savings'. get_sacco_total_balances does return
-- 'savings', but /api/sacco-balances drops it on the floor when it builds its response,
-- so the total printed on the card has never included it. A percentage computed over a
-- wider set than the figure it sits under would not reconcile against that figure, and
-- the card is where anyone will check the arithmetic. If savings is ever added back to
-- that response, add it here in the same commit.
--
-- WHERE THE WEEK STARTS
-- Monday, via date_trunc('week', ...), which is Postgres' ISO week. Note that a SACCO
-- also has a `meeting_day` setting, so its own sense of "this week" may well run
-- Thursday-to-Thursday. Aligning to that is a defensible change, but it is a different
-- and larger one -- it would have to decide what happens to a SACCO that moves its
-- meeting day mid-cycle -- and it is not what this function claims to do.
--
-- Reads nothing but transactions the caller's own SACCO owns. Safe to re-run.
-- ====================================================================================

CREATE OR REPLACE FUNCTION public.get_sacco_capital_trend(p_profile_id UUID)
RETURNS TABLE (
  opening_capital NUMERIC,
  current_week_net NUMERIC,
  previous_week_net NUMERIC,
  week_start DATE
) AS $$
DECLARE
  v_sacco_id UUID;
  v_week_start DATE := date_trunc('week', current_date)::date;
  v_prev_start DATE := (date_trunc('week', current_date) - INTERVAL '7 days')::date;
BEGIN
  -- Same authorization preamble as get_sacco_total_balances, and load-bearing for the
  -- same reason: without it any authenticated user could aim this at any profile id and
  -- read another SACCO's position. Kept identical so the two cannot drift into
  -- disagreeing about who may see a group's money.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized to view balances for this member.';
  END IF;

  IF p_profile_id <> auth.uid() AND NOT EXISTS (
    SELECT 1
    FROM public.sacco_memberships caller_sm
    JOIN public.sacco_memberships target_sm ON target_sm.sacco_id = caller_sm.sacco_id
    WHERE caller_sm.profile_id = auth.uid()
      AND caller_sm.role IN ('admin', 'loan_officer')
      AND target_sm.profile_id = p_profile_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized to view balances for this member.';
  END IF;

  SELECT sacco_id INTO v_sacco_id
  FROM public.sacco_memberships
  WHERE profile_id = p_profile_id AND status = 'active'
  LIMIT 1;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.profiles p
    JOIN public.saccos s ON s.group_code = p.group_id
    WHERE p.id = p_profile_id
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(m.signed_amount) FILTER (WHERE m.moved_on < v_week_start), 0)::NUMERIC,
    COALESCE(SUM(m.signed_amount) FILTER (WHERE m.moved_on >= v_week_start), 0)::NUMERIC,
    COALESCE(SUM(m.signed_amount) FILTER (
      WHERE m.moved_on >= v_prev_start AND m.moved_on < v_week_start
    ), 0)::NUMERIC,
    v_week_start
  FROM (
    SELECT
      t.created_at AS moved_on,
      CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END AS signed_amount
    FROM public.transactions t
    WHERE t.sacco_id = v_sacco_id
      AND t.status IN ('completed', 'approved')
      AND t.category IN ('shares', 'development_fund', 'social_fund', 'fines')
  ) m;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.get_sacco_capital_trend(UUID) IS
  'Week-on-week movement of a SACCO''s total capital. opening_capital is the pot at Monday 00:00; current_week_net and previous_week_net are the signed movements in those two weeks. Categories match the Total SACCO Assets card exactly.';

GRANT EXECUTE ON FUNCTION public.get_sacco_capital_trend(UUID) TO authenticated;
