import { createContext } from "react";

export interface GuarantorAlertContextType {
  /** How many guarantee requests are waiting on this member right now. */
  pendingCount: number;
  /** Re-read the count. Called after the member accepts or declines one. */
  refresh: () => void;
}

/**
 * Defaulted rather than left undefined, unlike SidebarContext, which throws when its
 * provider is missing.
 *
 * A sidebar with no provider is a bug -- nothing can open. A missing guarantee count is
 * not: the header and sidebar also render for an admin, and inside layouts that have no
 * reason to carry this provider. Throwing there would take down the whole app over a
 * decoration, and because these components mount above the route boundary it would
 * escalate to global-error.tsx rather than being caught by error.tsx.
 */
export const GuarantorAlertContext = createContext<GuarantorAlertContextType>({
  pendingCount: 0,
  refresh: () => {}
});
