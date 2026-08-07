"use client";

import "../UserSideBar.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/useSidebar";
import { useGuarantorAlerts } from "../context/useGuarantorAlerts";
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { MEMBER_VIEW_KEY } from "./ProtectedRoute";
import AlertDot from "./AlertDot";

const navItems = [
  { to: "/dashboard", icon: "fa-solid fa-house", label: "Dashboard" },
  { to: "/savings", icon: "fa-solid fa-wallet", label: "Pools & Funds" },
  { to: "/loans", icon: "fa-solid fa-hand-holding-dollar", label: "Loans" },
  { to: "/members", icon: "fa-solid fa-users", label: "Members" },
  { to: "/settings", icon: "fa-solid fa-gear", label: "Settings" },
];

export default function UserSideBar() {
  const { isOpen, closeSidebar } = useSidebar();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  // Guarantee requests are answered on the Loans page, so the dot goes on that link and
  // nowhere else -- a marker on a link that does not lead to the action is just noise.
  const { pendingCount } = useGuarantorAlerts();

  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        if (session.user?.user_metadata?.role === "admin") {
          setIsAdmin(true);
        }

        const res = await fetch("/api/profile", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.profile && data.profile.role === "admin") {
          setIsAdmin(true);
        }
      } catch (err) {
        console.warn("Failed to check admin role in sidebar:", err);
      }
    }
    checkRole();
  }, []);

  const handleImageError = (event) => {
    event.currentTarget.src =
      "https://placehold.co/40x40/253b8e/ffffff?text=S";
  };

  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? " active" : ""}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <aside className={`sidebar${isOpen ? " active" : ""}`}>
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
          <h2>SACCO</h2>
        </div>
        <ul className="nav-links">
          {navItems.map((item) => {
            const isActive = pathname === item.to;
            const alerts = item.to === "/loans" ? pendingCount : 0;

            return (
              <li key={item.to}>
                <Link
                  href={item.to}
                  className={isActive ? "active" : ""}
                  onClick={closeSidebar}
                >
                  <i className={item.icon} />
                  <span>{item.label}</span>
                  {/* Inline, pushed to the end of the row: over the icon it would land on
                      the label, and there is room on a full-width nav line to show the
                      number as well as the dot. */}
                  <AlertDot
                    count={alerts}
                    showCount
                    inline
                    label="Loan guarantee requests waiting for your decision"
                  />
                </Link>
              </li>
            );
          })}

          {isAdmin && (
            <li style={{ marginTop: "2rem", borderTop: "1px solid rgba(226, 232, 240, 0.4)", paddingTop: "2rem" }}>
              <Link
                href="/admin"
                className="admin-switch-btn"
                style={{
                  background: "var(--primary-light)",
                  color: "var(--primary-color)",
                  fontWeight: "700",
                }}
                onClick={() => {
                  // See userHeader.jsx: member view persists until this is cleared.
                  sessionStorage.removeItem(MEMBER_VIEW_KEY);
                  closeSidebar();
                }}
              >
                <i className="fa-solid fa-user-shield" />
                <span>Switch to Admin</span>
              </Link>
            </li>
          )}
        </ul>
      </aside>
    </>
  );
}
