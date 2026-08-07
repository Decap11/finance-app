import { SidebarProvider } from "../context/SidebarProvider";
import { LoanAlertProvider } from "../context/LoanAlertProvider";
import SideBar from "../Components/SideBar";

import "./layout.css";
import "./responsive.css";

export default function AdminLayout({ children }) {
  return (
    <SidebarProvider>
      {/* Wraps the sidebar and the page together: Header renders inside {children} and
          carries the hamburger, so the count has to cross that boundary. */}
      <LoanAlertProvider>
        <div className="dashboard-container admin-dashboard">
          <SideBar />
          <div className="main-content admin-main-content">{children}</div>
        </div>
      </LoanAlertProvider>
    </SidebarProvider>
  );
}
