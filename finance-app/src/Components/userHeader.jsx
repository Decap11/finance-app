import { useState } from "react";
import { Link } from "react-router-dom";
import { useSidebar } from "../context/useSidebar";
import Search from "./Search";
import "../styles/userHeader.css";

export default function UserHeader() {
  const [showDropdown, setShowDropdown] = useState(false);
  const { isOpen, toggleSidebar } = useSidebar();

  const toggleProfileDropdown = (event) => {
    event.stopPropagation();
    setShowDropdown((prev) => !prev);
  };

  return (
    <header>
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
          <h1>Member Overview</h1>
          <p>Welcome back! Complete your mandatory weekly obligations.</p>
        </div>
      </div>

      <div className="header-actions">
        {/* <div className="search-bar">
          <i className="fa-solid fa-magnifying-glass" />
          <input type="text" placeholder="Search transactions, loans..." />
        </div> */}
        <Search />

        <div className="notification-bell">
          <i className="fa-regular fa-bell" />
        </div>

        <div className="user-profile" onClick={toggleProfileDropdown}>
          <img src="https://i.pravatar.cc/150?img=11" alt="User Avatar" />
          <div className="user-info">
            <span className="name">Joseph S.</span>
            <span className="role">Member ID: 0042</span>
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
