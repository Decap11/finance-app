import { SidebarProvider } from "../context/SidebarProvider";
import SideBar from "../Components/SideBar";

import "./layout.css";
import "./responsive.css";

export default function AdminLayout({ children }) {
  return (
    <SidebarProvider>
      <div className="dashboard-container admin-dashboard">
        <SideBar />
        <div className="main-content admin-main-content">{children}</div>
      </div>
    </SidebarProvider>
  );
}
