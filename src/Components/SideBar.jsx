"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSidebar } from "../context/useSidebar";
import "../styles/adminsidebar.css";

const navItems = [
  { to: "/admin?tab=overview", icon: "fa-solid fa-chart-line", label: "Overview" },
  { to: "/admin?tab=verifications", icon: "fa-solid fa-clipboard-check", label: "Verifications" },
  { to: "/admin?tab=members", icon: "fa-solid fa-users", label: "Members" },
  { to: "/admin?tab=payments", icon: "fa-solid fa-credit-card", label: "Payments" },
  { to: "/admin?tab=settings", icon: "fa-solid fa-gear", label: "Settings" },
];

export default function SideBar() {
  const { isOpen, closeSidebar } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";

  const handleImageError = (event) => {
    event.currentTarget.src = "https://placehold.co/40x40/0f172a/ffffff?text=A";
  };

  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? " active" : ""}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <aside className={`sidebar admin-sidebar${isOpen ? " active" : ""}`}>
        <button
          type="button"
          className="sidebar-close-btn"
          onClick={closeSidebar}
          aria-label="Close navigation menu"
        >
          <i className="fa-solid fa-xmark" />
        </button>
        <div className="logo-container">
          <img
            src="images/sacco logo.png"
            alt="SACCO Logo"
            onError={handleImageError}
          />
          <h2>Admin</h2>
        </div>
        <ul className="nav-links">
          {navItems.map((item) => {
            const itemTab = item.to.split("tab=")[1] || "overview";
            const isActive = currentTab === itemTab;
            return (
              <li key={`${item.to}-${item.label}`}>
                <Link
                  href={item.to}
                  className={isActive ? "active" : ""}
                  onClick={closeSidebar}
                >
                  <i className={item.icon} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}

          <li style={{ marginTop: "2rem", borderTop: "1px solid rgba(226, 232, 240, 0.4)", paddingTop: "2rem" }}>
            <Link
              href="/dashboard"
              className="member-switch-btn"
              style={{
                background: "rgba(15, 23, 42, 0.05)",
                color: "var(--text-dark)",
                fontWeight: "700",
              }}
              onClick={closeSidebar}
            >
              <i className="fa-solid fa-user" />
              <span>Switch to Member View</span>
            </Link>
          </li>
        </ul>
      </aside>
    </>
  );
}
