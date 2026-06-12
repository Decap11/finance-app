import { useState } from "react";
import { Link } from "react-router-dom";
import { useSidebar } from "../context/useSidebar";
import "../styles/Header.css";

export default function Header() {
  const [showDropdown, setShowDropdown] = useState(false);
  const { isOpen, toggleSidebar } = useSidebar();

  const toggleProfileDropdown = (event) => {
    event.stopPropagation();
    setShowDropdown((prev) => !prev);
  };

  return (
    <header className="header-container admin-header">
      <div className="header-left">
        <button
          type="button"
          className="menu-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
        >
          <i className={`fa-solid ${isOpen ? "fa-xmark" : "fa-bars"}`} />
        </button>
        <div className="welcome-text">
          <h1>Admin Overview</h1>
          <p>System statistics and pending actions.</p>
        </div>
      </div>
      <div className="header-actions">
        <div className="search-bar">
          <i className="fa-solid fa-magnifying-glass" />
          <input type="text" placeholder="Search member, ID, or loan..." />
        </div>
        <div className="notification-bell">
          <i className="fa-regular fa-bell" />
        </div>
        <div className="user-profile" onClick={toggleProfileDropdown}>
          <img src="https://i.pravatar.cc/150?img=60" alt="Admin Avatar" />
          <div className="user-info">
            <span className="name">Administrator</span>
            <span className="role">System Access</span>
          </div>
          <div
            className={`profile-dropdown${showDropdown ? " show" : ""}`}
            id="profileDropdown"
          >
            <Link to="/settings" className="dropdown-item">
              <i className="fa-solid fa-user-gear" /> Account Settings
            </Link>
            <a href="#" className="dropdown-item">
              <i className="fa-solid fa-lock" /> Privacy & Security
            </a>
            <div className="dropdown-divider" />
            <Link
              to="/home"
              className="dropdown-item"
              style={{ color: "var(--danger)" }}
            >
              <i
                className="fa-solid fa-arrow-right-from-bracket"
                style={{ color: "var(--danger)" }}
              />
              Sign Out
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
