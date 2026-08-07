import { createContext } from "react";

export interface LoanAlertContextType {
  /** Live loans whose monthly checkpoint falls today. */
  dueToday: number;
  /** Live loans already past their final date. */
  overdue: number;
  /** Both together -- what the navigation dot counts. */
  needingAttention: number;
}

/**
 * Defaulted rather than undefined, for the same reason as GuarantorAlertContext: the admin
 * header and sidebar also render in places that have no reason to carry this provider, and
 * they mount above the route error boundary, so throwing would escalate to global-error.
 */
export const LoanAlertContext = createContext<LoanAlertContextType>({
  dueToday: 0,
  overdue: 0,
  needingAttention: 0
});
