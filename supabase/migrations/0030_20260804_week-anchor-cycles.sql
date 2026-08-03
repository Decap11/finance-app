-- ====================================================================================
-- 0030: the week number a SACCO actually counts
--
-- WHY THIS FILE EXISTS
--
-- A SACCO that backfills its paper records through the Historical Onboarding tab ends up
-- with a correct ledger and a meaningless week counter. There were two week numbers in
-- this database and neither was the one the group counts:
--
--   1. sacco_settings.current_week (mirrored on saccos.current_week) is a number an admin
--      TYPES BY HAND into "Active Week Number" in Configuration Settings. Nothing in the
--      application ever advanced it. It sat at whatever was last typed while real meetings
--      came and went.
--
--   2. transactions.week_number, for a backfilled row, came from 0028's meeting_week_of()
--      -- the Nth occurrence of the meeting day within that date's own CALENDAR YEAR. A
--      record from 5 Aug 2026 is "week 31" because it is the 31st Wednesday of 2026, which
--      says nothing about how long the SACCO has been running.
--
-- What a SACCO actually counts is weeks from its own first meeting, in cycles of 52. This
-- file makes that the definition.
--
-- THE ANCHOR
--
-- One new column carries the whole idea: week_anchor_date, the meeting date that is Week 1
-- of the current cycle. Everything else is derived from it, which is what makes the week
-- advance on its own -- the old counter could not, because there was nothing to derive it
-- from.
--
--     elapsed     = (snap(today) - snap(anchor)) / 7 + 1
--     active week = LEAST(52, elapsed)
--
-- snap() moves a date forward to its meeting day. That is the convention the rest of the
-- app already uses everywhere -- getForthcomingMeetingDate in src/utils/meetingDateUtils.js
-- -- so a Monday entry and the Wednesday meeting it belongs to land on the same week. All
-- arithmetic is on DATE, so there is no DST hour to lose.
--
-- A NULL anchor means "never onboarded": every reader falls back to the typed current_week
-- exactly as before. Nothing changes for a SACCO that does not use this.
--
-- WHY THE ROW NUMBERS ARE NOT CLAMPED
--
-- The active week clamps at 52 and holds there until an admin starts a new cycle. Applying
-- that same clamp to stored row numbers would be destructive: a SACCO with three years of
-- paper records would have every row older than 52 weeks squashed to 52, losing the
-- position the weekly report and the attendance manager both filter on. So rows are
-- stamped ((elapsed - 1) mod 52) + 1 -- a true 1-52 position within their own cycle.
--
-- finalize_historical_onboarding advances the anchor forward in whole 52-week blocks until
-- today sits inside one. Because the blocks are whole cycles, every row's position mod 52
-- is identical whether measured from the earliest record or from the advanced anchor -- so
-- the advance costs nothing and keeps the active week inside 1-52 without a clamp having
-- to bite.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the anchor column, on both tables
--
-- sacco_settings and saccos carry duplicated settings and are written together everywhere
-- else in this codebase; breaking that habit here would just mean one more place they can
-- drift. sacco_settings is the one that is read first.
-- ====================================================================================
ALTER TABLE public.sacco_settings ADD COLUMN IF NOT EXISTS week_anchor_date DATE;
ALTER TABLE public.saccos         ADD COLUMN IF NOT EXISTS week_anchor_date DATE;

COMMENT ON COLUMN public.sacco_settings.week_anchor_date IS
  'The meeting date that is Week 1 of the current 52-week cycle. NULL means the SACCO has never finished historical onboarding, and current_week is read as a typed value instead.';


-- ====================================================================================
-- STEP 2: day-of-week arithmetic
--
-- meeting_dow is 0028's CASE lifted out verbatim. It was inline there, and this file needs
-- the identical mapping -- two copies of a day-name table is exactly the kind of thing that
-- silently disagrees about Sunday. meeting_week_of is re-declared below to call it, so the
-- calendar-year rule and the anchor rule cannot drift apart on what "Wednesday" means.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.meeting_dow(p_meeting_day TEXT)
RETURNS INTEGER AS $$
  SELECT CASE lower(btrim(COALESCE(p_meeting_day, 'wednesday')))
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

-- The forward snap. A date already on the meeting day is returned unchanged; anything else
-- moves forward to the meeting that week's activity belongs to.
CREATE OR REPLACE FUNCTION public.meeting_day_on_or_after(p_on DATE, p_meeting_day TEXT)
RETURNS DATE AS $$
  SELECT p_on + ((public.meeting_dow(p_meeting_day) - EXTRACT(DOW FROM p_on)::INTEGER + 7) % 7);
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION public.meeting_day_on_or_after(DATE, TEXT) IS
  'The SACCO meeting date on or after p_on. Mirrors getForthcomingMeetingDate in src/utils/meetingDateUtils.js.';

-- 0028's rule, unchanged in behaviour, now sharing the day table above. Still used for
-- records typed before a SACCO has an anchor to count from.
CREATE OR REPLACE FUNCTION public.meeting_week_of(p_on DATE, p_meeting_day TEXT)
RETURNS INTEGER AS $$
  SELECT GREATEST(COUNT(*), 1)::INTEGER
  FROM generate_series(
    date_trunc('year', p_on::TIMESTAMP),
    p_on::TIMESTAMP,
    INTERVAL '1 day'
  ) AS d
  WHERE EXTRACT(DOW FROM d)::INTEGER = public.meeting_dow(p_meeting_day);
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION public.meeting_dow(TEXT)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_day_on_or_after(DATE, TEXT) TO authenticated;


-- ====================================================================================
-- STEP 3: a date's position in its cycle
--
-- Both endpoints are snapped to the meeting day first, so their difference is always an
-- exact multiple of 7 and the integer division below cannot truncate anything real.
--
-- The doubled modulo is for dates BEFORE the anchor: Postgres % keeps the sign of the
-- left operand, so a single % 52 would return a negative week for a record in an earlier
-- cycle. (x % 52 + 52) % 52 lands every date, past or future, in 0..51.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.sacco_week_of(p_on DATE, p_anchor DATE, p_meeting_day TEXT)
RETURNS INTEGER AS $$
  SELECT CASE
    WHEN p_on IS NULL OR p_anchor IS NULL THEN NULL::INTEGER
    ELSE (
      ((
        (public.meeting_day_on_or_after(p_on,     p_meeting_day)
         - public.meeting_day_on_or_after(p_anchor, p_meeting_day)) / 7
      ) % 52 + 52) % 52
    ) + 1
  END;
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION public.sacco_week_of(DATE, DATE, TEXT) IS
  'Which week of its own 52-week cycle a date falls in, counted from the anchor. Always 1-52, for dates before the anchor as well as after.';

GRANT EXECUTE ON FUNCTION public.sacco_week_of(DATE, DATE, TEXT) TO authenticated;


-- ====================================================================================
-- STEP 4: reading a SACCO's week configuration
--
-- sacco_settings is keyed by group_code, and its sacco_id has been nullable since 0005, so
-- a settings row genuinely may not be reachable by id. Both lookups live here rather than
-- being repeated at every call site.
--
-- The OUT parameters carry a cfg_ prefix because two of the three would otherwise share a
-- name with a column being selected, and PL/pgSQL resolves that collision by raising
-- `column reference is ambiguous` rather than by guessing.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.sacco_week_config(
  p_sacco_id  UUID,
  OUT cfg_anchor_date DATE,
  OUT cfg_meeting_day TEXT,
  OUT cfg_stored_week INTEGER
) AS $$
BEGIN
  SELECT ss.week_anchor_date, ss.meeting_day, ss.current_week
    INTO cfg_anchor_date, cfg_meeting_day, cfg_stored_week
  FROM public.sacco_settings ss
  WHERE ss.sacco_id = p_sacco_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT ss.week_anchor_date, ss.meeting_day, ss.current_week
      INTO cfg_anchor_date, cfg_meeting_day, cfg_stored_week
    FROM public.sacco_settings ss
    JOIN public.saccos s ON s.group_code ILIKE ss.group_code
    WHERE s.id = p_sacco_id
    LIMIT 1;
  END IF;

  -- A SACCO registered before sacco_settings existed carries these only on `saccos`.
  IF cfg_anchor_date IS NULL THEN
    SELECT s.week_anchor_date INTO cfg_anchor_date FROM public.saccos s WHERE s.id = p_sacco_id;
  END IF;

  IF cfg_stored_week IS NULL THEN
    SELECT s.current_week INTO cfg_stored_week FROM public.saccos s WHERE s.id = p_sacco_id;
  END IF;

  cfg_meeting_day := COALESCE(NULLIF(btrim(cfg_meeting_day), ''), 'Wednesday');
  cfg_stored_week := GREATEST(COALESCE(cfg_stored_week, 1), 1);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.sacco_week_config(UUID) TO authenticated;


-- ====================================================================================
-- STEP 5: the active week
--
-- The one authority for "what week is it now". Clamped at 52: past that the SACCO is owed
-- a new cycle, and start_new_sacco_cycle below is how it gets one. Falls back to the typed
-- current_week when there is no anchor, which is what keeps every SACCO that has never run
-- historical onboarding behaving exactly as it did before this file.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.sacco_active_week(p_sacco_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_anchor  DATE;
  v_day     TEXT;
  v_stored  INTEGER;
  v_elapsed INTEGER;
BEGIN
  SELECT * INTO v_anchor, v_day, v_stored FROM public.sacco_week_config(p_sacco_id);

  IF v_anchor IS NULL THEN
    RETURN v_stored;
  END IF;

  v_elapsed := (public.meeting_day_on_or_after(current_date, v_day)
              - public.meeting_day_on_or_after(v_anchor, v_day)) / 7 + 1;

  RETURN GREATEST(1, LEAST(52, v_elapsed));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.sacco_active_week(UUID) IS
  'The SACCO''s current week, derived from week_anchor_date so it advances by itself each meeting day. Clamps at 52. Falls back to the typed current_week when the SACCO has no anchor.';

GRANT EXECUTE ON FUNCTION public.sacco_active_week(UUID) TO authenticated;


-- ====================================================================================
-- STEP 6: which SACCO is the caller staff of
--
-- finalize and start_new_cycle are both called from the admin's own settings screen with
-- no id, so both need this. Same resolution order the rest of the app uses: membership
-- first, ownership second.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.staff_sacco_for_caller(p_sacco_id UUID DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  v_sacco_id UUID := p_sacco_id;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_sacco_id IS NULL THEN
    SELECT sm.sacco_id INTO v_sacco_id
    FROM public.sacco_memberships sm
    WHERE sm.profile_id = auth.uid()
      AND sm.role IN ('admin', 'loan_officer')
      AND sm.status = 'active'
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.saccos s WHERE s.admin_profile_id = auth.uid() LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'No SACCO is associated with this account';
  END IF;

  IF NOT public.is_sacco_staff(v_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may change its week settings';
  END IF;

  RETURN v_sacco_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.staff_sacco_for_caller(UUID) TO authenticated;


-- ====================================================================================
-- STEP 7: writing the anchor
--
-- Both RPCs below end the same way, and the write is fiddlier than it looks: a settings
-- row may be unreachable by sacco_id (nullable since 0005), may be stored under a
-- differently-cased group_code (the API upserts uppercase, every read uses ILIKE), or may
-- not exist at all. Getting that wrong would either lose the anchor silently or create a
-- second settings row for the same SACCO.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.apply_sacco_week_anchor(
  p_sacco_id   UUID,
  p_anchor     DATE,
  p_week       INTEGER,
  p_meeting_day TEXT
) RETURNS VOID AS $$
DECLARE
  v_group_code TEXT;
BEGIN
  SELECT s.group_code INTO v_group_code FROM public.saccos s WHERE s.id = p_sacco_id;

  UPDATE public.sacco_settings ss
  SET week_anchor_date   = p_anchor,
      current_week       = p_week,
      is_historical_mode = false,
      sacco_id           = COALESCE(ss.sacco_id, p_sacco_id),
      updated_at         = now()
  WHERE ss.sacco_id = p_sacco_id
     OR (v_group_code IS NOT NULL AND ss.group_code ILIKE v_group_code);

  IF NOT FOUND AND v_group_code IS NOT NULL THEN
    INSERT INTO public.sacco_settings (
      group_code, sacco_id, week_anchor_date, current_week, meeting_day, is_historical_mode
    ) VALUES (
      upper(btrim(v_group_code)), p_sacco_id, p_anchor, p_week, p_meeting_day, false
    )
    ON CONFLICT (group_code) DO UPDATE
    SET week_anchor_date   = EXCLUDED.week_anchor_date,
        current_week       = EXCLUDED.current_week,
        is_historical_mode = false,
        updated_at         = now();
  END IF;

  UPDATE public.saccos
  SET week_anchor_date   = p_anchor,
      current_week       = p_week,
      is_historical_mode = false,
      updated_at         = now()
  WHERE id = p_sacco_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Internal only. This is SECURITY DEFINER and asks no questions about the caller -- the two
-- RPCs below check staff membership before reaching it, and they PERFORM it as the function
-- owner, so it needs no grant of its own. Postgres grants EXECUTE to PUBLIC on a new
-- function by default, which here would be a hole: any authenticated user could re-anchor
-- any SACCO's entire week numbering.
REVOKE ALL ON FUNCTION public.apply_sacco_week_anchor(UUID, DATE, INTEGER, TEXT)
  FROM PUBLIC, authenticated, anon;


-- ====================================================================================
-- STEP 8: finalize_historical_onboarding
--
-- The button at the end of a backfill. One transaction: either the SACCO comes out of this
-- entirely on the new scale, or it stays entirely on the old one. A half-applied re-stamp
-- would leave the weekly report and the attendance register pointing at different weeks
-- with no way to tell which rows had moved.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.finalize_historical_onboarding(p_sacco_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_sacco_id      UUID;
  v_anchor        DATE;
  v_day           TEXT;
  v_stored        INTEGER;
  v_earliest      DATE;
  v_first_meeting DATE;
  v_today_meeting DATE;
  v_cycles        INTEGER;
  v_week          INTEGER;
  v_tx_count      INTEGER := 0;
  v_att_count     INTEGER := 0;
BEGIN
  v_sacco_id := public.staff_sacco_for_caller(p_sacco_id);

  SELECT * INTO v_anchor, v_day, v_stored FROM public.sacco_week_config(v_sacco_id);

  -- ---------------------------------------------------------------------------------
  -- Week 1 is the oldest record on file. Pending rows are excluded deliberately: an
  -- unapproved request is not yet a thing that happened, and letting one set the anchor
  -- would move every other week number in the SACCO.
  -- ---------------------------------------------------------------------------------
  SELECT MIN(t.created_at) INTO v_earliest
  FROM public.transactions t
  WHERE t.sacco_id = v_sacco_id
    AND t.status IN ('completed', 'approved');

  -- Nothing backfilled yet -- fall back to the day the SACCO registered, so finishing
  -- onboarding on an empty ledger still produces a sane Week 1 rather than an error.
  IF v_earliest IS NULL THEN
    SELECT s.created_at::DATE INTO v_earliest FROM public.saccos s WHERE s.id = v_sacco_id;
  END IF;

  v_earliest := COALESCE(v_earliest, current_date);

  v_first_meeting := public.meeting_day_on_or_after(v_earliest, v_day);
  v_today_meeting := public.meeting_day_on_or_after(current_date, v_day);

  -- How many 52-week cycles the records span, and the start of the one today is in. See
  -- the header: advancing by whole cycles leaves every row's position mod 52 unchanged,
  -- so this costs nothing and keeps the active week inside 1-52.
  v_cycles := GREATEST(((v_today_meeting - v_first_meeting) / 7) / 52 + 1, 1);
  v_anchor := v_first_meeting + ((v_cycles - 1) * 52 * 7);

  v_week := GREATEST(1, LEAST(52, (v_today_meeting - v_anchor) / 7 + 1));

  -- ---------------------------------------------------------------------------------
  -- Re-stamp the ledger.
  --
  -- The trailing "| Week N" in the description is rewritten alongside the column. 0028
  -- writes that suffix, and calendarHeatMap and saccoSettings both still regex it out as
  -- a fallback for rows that predate the column -- so leaving it saying Week 31 next to a
  -- column saying Week 10 would put a visible contradiction in front of the admin.
  -- ---------------------------------------------------------------------------------
  UPDATE public.transactions t
  SET week_number = public.sacco_week_of(t.created_at, v_anchor, v_day),
      description = CASE
        WHEN t.description ~ '\|\s*Week\s*\d+\s*$'
          THEN regexp_replace(
                 t.description, '\|\s*Week\s*\d+\s*$',
                 '| Week ' || public.sacco_week_of(t.created_at, v_anchor, v_day)
               )
        ELSE t.description
      END
  WHERE t.sacco_id = v_sacco_id;

  GET DIAGNOSTICS v_tx_count = ROW_COUNT;

  -- ---------------------------------------------------------------------------------
  -- Re-stamp the attendance registers. Not optional: WeeklyAttendanceManager finds a
  -- saved week by matching metadata.week_number against the active week, so a register
  -- left on the old scale is not merely mislabelled -- it becomes unreachable, and the
  -- admin sees a blank sheet for a meeting they already recorded.
  --
  -- Derived from each event's own created_at, which is the only date these rows carry.
  -- ---------------------------------------------------------------------------------
  UPDATE public.audit_events ae
  SET metadata = jsonb_set(
        COALESCE(ae.metadata, '{}'::jsonb),
        '{week_number}',
        to_jsonb(public.sacco_week_of(ae.created_at::DATE, v_anchor, v_day))
      )
  WHERE ae.sacco_id = v_sacco_id
    AND ae.entity_type = 'sacco_attendance';

  GET DIAGNOSTICS v_att_count = ROW_COUNT;

  PERFORM public.apply_sacco_week_anchor(v_sacco_id, v_anchor, v_week, v_day);

  -- Re-scaling every week number in a SACCO is exactly the kind of act that should leave
  -- a trace.
  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'sacco', v_sacco_id, 'finalize_historical_onboarding',
    json_build_object(
      'anchor_date',             v_anchor,
      'earliest_record',         v_earliest,
      'active_week',             v_week,
      'cycles_spanned',          v_cycles,
      'transactions_restamped',  v_tx_count,
      'attendance_restamped',    v_att_count,
      'previous_typed_week',     v_stored
    )::JSONB
  );

  RETURN json_build_object(
    'success',                true,
    'anchor_date',            v_anchor,
    'earliest_record',        v_earliest,
    'active_week',            v_week,
    'cycles_spanned',         v_cycles,
    'transactions_restamped', v_tx_count,
    'attendance_restamped',   v_att_count,
    'meeting_day',            v_day
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.finalize_historical_onboarding(UUID) IS
  'Ends a backfill: makes the oldest record Week 1, re-stamps every transaction and attendance register onto that scale, sets the active week and switches historical mode off. Atomic.';

GRANT EXECUTE ON FUNCTION public.finalize_historical_onboarding(UUID) TO authenticated;


-- ====================================================================================
-- STEP 9: start_new_sacco_cycle
--
-- The escape hatch the clamp requires. The active week stops at 52; without a way to
-- re-anchor, a SACCO that reaches the end of its cycle would be frozen there forever.
--
-- This week's meeting becomes Week 1. Records are NOT re-stamped -- they keep the position
-- they held in the cycle they happened in, which is the whole reason row numbers are not
-- clamped.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.start_new_sacco_cycle(p_sacco_id UUID DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  v_sacco_id  UUID;
  v_anchor    DATE;
  v_day       TEXT;
  v_stored    INTEGER;
  v_old       DATE;
BEGIN
  v_sacco_id := public.staff_sacco_for_caller(p_sacco_id);

  SELECT * INTO v_old, v_day, v_stored FROM public.sacco_week_config(v_sacco_id);

  v_anchor := public.meeting_day_on_or_after(current_date, v_day);

  PERFORM public.apply_sacco_week_anchor(v_sacco_id, v_anchor, 1, v_day);

  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'sacco', v_sacco_id, 'start_new_sacco_cycle',
    json_build_object('previous_anchor', v_old, 'new_anchor', v_anchor)::JSONB
  );

  RETURN json_build_object(
    'success',     true,
    'anchor_date', v_anchor,
    'active_week', 1,
    'meeting_day', v_day
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.start_new_sacco_cycle(UUID) IS
  'Begins a fresh 52-week cycle: this week''s meeting becomes Week 1. Existing records keep the week numbers of the cycle they happened in.';

GRANT EXECUTE ON FUNCTION public.start_new_sacco_cycle(UUID) TO authenticated;


-- ====================================================================================
-- STEP 10: log_historical_record, on the anchor
--
-- 0028's function, unchanged except for the week calculation. It also drops the redundant
-- second read of ss.meeting_day that file had -- the value was already in hand.
--
-- Records typed BEFORE the anchor exists still get calendar-year numbers, because there is
-- nothing yet to count from. That is not a gap: finalize_historical_onboarding re-stamps
-- every row when the anchor is set, which is precisely the case this is.
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
  v_anchor       DATE;
  v_stored_week  INTEGER;
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
  -- The SACCO's week configuration and whether historical onboarding is switched on.
  -- Read before validation because the date rule below depends on the flag.
  -- ---------------------------------------------------------------------------------
  SELECT * INTO v_anchor, v_meeting_day, v_stored_week
  FROM public.sacco_week_config(v_sacco_id);

  SELECT ss.is_historical_mode INTO v_historical
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
  -- Which week this record belongs to. Anchor-relative once the SACCO has finished
  -- historical onboarding; 0028's calendar-year rule until then.
  -- ---------------------------------------------------------------------------------
  IF v_anchor IS NOT NULL THEN
    v_week_number := public.sacco_week_of(p_occurred_on, v_anchor, v_meeting_day);
  ELSE
    v_week_number := public.meeting_week_of(p_occurred_on, v_meeting_day);
  END IF;

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
