import { NavLink } from "react-router-dom";
import { useSidebar } from "../context/useSidebar";

const navItems = [
  {
    to: "/admin",
    icon: "fa-solid fa-chart-line",
    label: "Overview",
    end: true,
  },
  {
    to: "/admin",
    icon: "fa-solid fa-clipboard-check",
    label: "Verifications",
    end: false,
  },
  { to: "/members", icon: "fa-solid fa-users", label: "Members" },
  { to: "/settings", icon: "fa-solid fa-gear", label: "Settings" },
  { to: "/payments", icon: "fa-solid fa-credit-card", label: "Payments" },
];

export default function SideBar() {
  const { isOpen, closeSidebar } = useSidebar();

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
          {navItems.map((item) => (
            <li key={`${item.to}-${item.label}`}>
              <NavLink to={item.to} end={item.end} onClick={closeSidebar}>
                <i className={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
