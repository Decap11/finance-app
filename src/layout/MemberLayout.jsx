import { SidebarProvider } from "../context/SidebarProvider";
import UserSideBar from "../Components/usersidebar";
import "./layout.css";
import "./responsive.css";

export default function MemberLayout({ children, className = "" }) {
  const containerClass = ["dashboard-container", className]
    .filter(Boolean)
    .join(" ");

  return (
    <SidebarProvider>
      <div className={containerClass}>
        <UserSideBar />
        <div className="main-content">{children}</div>
      </div>
    </SidebarProvider>
  );
}
