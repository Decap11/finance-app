import { SidebarProvider } from "../context/SidebarProvider";
import { GuarantorAlertProvider } from "../context/GuarantorAlertProvider";
import UserSideBar from "../Components/usersidebar";
import "./layout.css";
import "./responsive.css";

export default function MemberLayout({ children, className = "" }) {
  const containerClass = ["dashboard-container", className]
    .filter(Boolean)
    .join(" ");

  return (
    <SidebarProvider>
      {/* Wraps both the sidebar and the page. userHeader renders inside {children} and
          carries the hamburger, so the count has to be visible on both sides of this
          boundary -- which is why it is a provider here rather than state in either one. */}
      <GuarantorAlertProvider>
        <div className={containerClass}>
          <UserSideBar />
          <div className="main-content">{children}</div>
        </div>
      </GuarantorAlertProvider>
    </SidebarProvider>
  );
}
