import "../UserSideBar.css";
import { NavLink } from "react-router-dom";
import { useSidebar } from "../context/useSidebar";

const navItems = [
  { to: "/dashboard", icon: "fa-solid fa-house", label: "Dashboard" },
  { to: "/savings", icon: "fa-solid fa-wallet", label: "Savings" },
  { to: "/loans", icon: "fa-solid fa-hand-holding-dollar", label: "Loans" },
  { to: "/members", icon: "fa-solid fa-users", label: "Members" },
  { to: "/settings", icon: "fa-solid fa-gear", label: "Settings" },
];

export default function UserSideBar() {
  const { isOpen, closeSidebar } = useSidebar();

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
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} onClick={closeSidebar}>
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
