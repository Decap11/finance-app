-- ====================================================================
-- MIGRATION: Peer Guarantor Loan Approval System
-- Branch: Additional-features
-- ====================================================================

-- 1. Add guarantor_status column to loans table if it doesn't exist
ALTER TABLE public.loans 
ADD COLUMN IF NOT EXISTS guarantor_status TEXT DEFAULT 'not_required' 
CHECK (guarantor_status IN ('not_required', 'pending_guarantors', 'guarantors_approved', 'guarantors_rejected'));

-- 2. Create Loan Guarantors Table
CREATE TABLE IF NOT EXISTS public.loan_guarantors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  borrower_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guarantor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  guaranteed_amount NUMERIC NOT NULL DEFAULT 0 CHECK (guaranteed_amount >= 0),
  notes TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id, guarantor_profile_id)
);

-- Enable RLS on loan_guarantors
ALTER TABLE public.loan_guarantors ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view loan guarantors" ON public.loan_guarantors;
DROP POLICY IF EXISTS "Guarantors can update their status" ON public.loan_guarantors;
DROP POLICY IF EXISTS "Admins can manage loan guarantors" ON public.loan_guarantors;

-- Create RLS Policies
CREATE POLICY "Users can view loan guarantors" 
  ON public.loan_guarantors FOR SELECT USING (true);

CREATE POLICY "Guarantors can update their status" 
  ON public.loan_guarantors FOR UPDATE USING (true);

CREATE POLICY "Admins can manage loan guarantors" 
  ON public.loan_guarantors FOR ALL USING (true);

-- 3. Stored Procedure: Process Guarantor Response
CREATE OR REPLACE FUNCTION public.process_guarantor_response(
  p_guarantor_id UUID,
  p_response TEXT -- 'approved' or 'rejected'
) RETURNS JSON AS $$
DECLARE
  v_rec RECORD;
  v_pending_count INTEGER := 0;
  v_rejected_count INTEGER := 0;
  v_all_approved BOOLEAN := false;
BEGIN
  -- Fetch guarantor record
  SELECT * INTO v_rec FROM public.loan_guarantors WHERE id = p_guarantor_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Guarantor record not found.';
  END IF;

  -- Update guarantor record
  UPDATE public.loan_guarantors 
  SET status = p_response, responded_at = now() 
  WHERE id = p_guarantor_id;

  -- Check remaining guarantors for this loan
  SELECT COUNT(*) INTO v_pending_count 
  FROM public.loan_guarantors 
  WHERE loan_id = v_rec.loan_id AND status = 'pending';

  SELECT COUNT(*) INTO v_rejected_count 
  FROM public.loan_guarantors 
  WHERE loan_id = v_rec.loan_id AND status = 'rejected';

  IF v_rejected_count > 0 THEN
    -- If any guarantor rejects, loan guarantor status becomes rejected
    UPDATE public.loans 
    SET guarantor_status = 'guarantors_rejected', status = 'rejected' 
    WHERE id = v_rec.loan_id;

    RETURN json_build_object(
      'success', true,
      'loan_status', 'rejected',
      'message', 'Loan guarantee rejected. Loan request declined.'
    );
  ELSIF v_pending_count = 0 THEN
    -- All guarantors approved! Escalate to pending admin approval
    UPDATE public.loans 
    SET guarantor_status = 'guarantors_approved', status = 'pending' 
    WHERE id = v_rec.loan_id;

    RETURN json_build_object(
      'success', true,
      'loan_status', 'pending_admin_approval',
      'message', 'All guarantors have approved! Loan escalated for Admin final approval.'
    );
  ELSE
    RETURN json_build_object(
      'success', true,
      'loan_status', 'pending_guarantors',
      'message', format('Response recorded. %s more guarantor(s) pending.', v_pending_count)
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.process_guarantor_response(UUID, TEXT) TO authenticated;
