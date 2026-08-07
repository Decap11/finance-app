import { useContext } from "react";
import { LoanAlertContext, LoanAlertContextType } from "./loanAlertContext";

/**
 * How many live loans need the admin's attention today -- an anniversary checkpoint
 * falling due, or a term already run out.
 *
 * Safe outside a provider: returns zeroes.
 */
export function useLoanAlerts(): LoanAlertContextType {
  return useContext(LoanAlertContext);
}
