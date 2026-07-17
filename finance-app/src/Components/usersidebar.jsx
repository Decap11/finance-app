"use client";

import "../UserSideBar.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/useSidebar";
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";

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

  useEffect(() => {
    async function checkRole() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

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
            return (
              <li key={item.to}>
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
                onClick={closeSidebar}
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
