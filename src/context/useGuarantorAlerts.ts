import { useContext } from "react";
import { GuarantorAlertContext, GuarantorAlertContextType } from "./guarantorAlertContext";

/**
 * How many loan guarantee requests are waiting on the signed-in member.
 *
 * Safe outside a provider -- returns 0 -- so the header and sidebar can use it without
 * knowing which layout they are in. See guarantorAlertContext.ts for why this one does not
 * throw where useSidebar does.
 */
export function useGuarantorAlerts(): GuarantorAlertContextType {
  return useContext(GuarantorAlertContext);
}
