"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSidebar } from "../context/useSidebar";
import { supabase } from "../supabaseClient.js";
import Search from "./Search";
import "../styles/userHeader.css";

export default function UserHeader() {
  const [showDropdown, setShowDropdown] = useState(false);
  const { isOpen, toggleSidebar } = useSidebar();
  const router = useRouter();

  const [profile, setProfile] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");

  // Notifications states
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedNotification, setSelectedNotification] = useState(null);
  
  const notifRef = useRef(null);

  useEffect(() => {
    async function loadHeaderProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const token = session.access_token;
        const headers = (token && token.length < 3000) ? { "Authorization": `Bearer ${token}` } : {};

        // Automatic repair: If token is bloated (> 3000 bytes), clear auth metadata
        if (token && token.length >= 3000) {
          supabase.auth.updateUser({ data: { avatar_url: null } }).then(() => {});
        }

        const res = await fetch("/api/profile", { headers });
        const text = await res.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn("Profile fetch non-JSON response:", text);
          return;
        }
        if (!res.ok) throw new Error(data.error);

        if (data.profile) {
          setProfile(data.profile);
          const localAvatar = localStorage.getItem(`sacco_avatar_${data.profile.id}`) || localStorage.getItem(`sacco_avatar_${session.user.id}`);
          const avatar = data.profile.avatar_url || localAvatar || data.user?.user_metadata?.avatar_url || "";
          setAvatarUrl(avatar);

          // Auto-sync to database profiles table if missing
          if (!data.profile.avatar_url && avatar) {
            supabase
              .from("profiles")
              .update({ avatar_url: avatar })
              .eq("id", data.profile.id)
              .then(() => {});
          }

          // Fetch broadcasts for this SACCO Group
          await fetchBroadcasts(data.profile, session.user.id);
        }
      } catch (err) {
        console.warn("Failed to load header profile:", err);
      }
    }

    loadHeaderProfile();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        const localAvatar = localStorage.getItem(`sacco_avatar_${session.user.id}`);
        if (localAvatar) {
          setAvatarUrl(localAvatar);
          return;
        }
      }
      if (session?.user?.user_metadata?.avatar_url) {
        setAvatarUrl(session.user.user_metadata.avatar_url);
      } else {
        setAvatarUrl("");
      }
    });

    const handleAvatarBroadcast = (event) => {
      if (event.detail?.avatarUrl) {
        setAvatarUrl(event.detail.avatarUrl);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_avatar_updated", handleAvatarBroadcast);
    }

    return () => {
      authListener.subscription?.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_avatar_updated", handleAvatarBroadcast);
      }
    };
  }, []);

  // Fetch broadcasts matching user Sacco
  const fetchBroadcasts = async (userProfile, userId) => {
    try {
      if (!userProfile?.group_id) return;

      // 1. Get Sacco UUID from group_code
      const { data: sacco } = await supabase
        .from('saccos')
        .select('id')
        .eq('group_code', userProfile.group_id)
        .single();

      if (!sacco) return;

      // 2. Fetch broadcasts from public.audit_events
      const { data: events } = await supabase
        .from('audit_events')
        .select('*')
        .eq('sacco_id', sacco.id)
        .eq('entity_type', 'broadcast')
        .order('created_at', { ascending: false });

      if (!events) return;

      // 3. Load read list from localStorage
      const readKey = `sacco_read_broadcasts_${userId}`;
      const readIds = JSON.parse(localStorage.getItem(readKey) || "[]");

      // 4. Map events to notifications
      let unreads = 0;
      const mapped = events.map(evt => {
        const isRead = readIds.includes(evt.id);
        if (!isRead) unreads++;

        const date = new Date(evt.created_at);
        const minDiff = Math.floor((Date.now() - date.getTime()) / 60000);
        let timeStr = `${minDiff} min ago`;
        if (minDiff > 59) {
          const hours = Math.floor(minDiff / 60);
          timeStr = hours > 23 ? `${Math.floor(hours / 24)} days ago` : `${hours} hours ago`;
        }

        return {
          id: evt.id,
          title: evt.metadata?.title || "SACCO Announcement",
          content: evt.metadata?.content || "No details provided.",
          unread: !isRead,
          time: timeStr
        };
      });

      setNotifications(mapped);
      setUnreadCount(unreads);

    } catch (err) {
      console.warn("Failed to fetch announcements:", err);
    }
  };

  const toggleProfileDropdown = (event) => {
    event.stopPropagation();
    setShowDropdown((prev) => !prev);
    setShowNotifications(false);
  };

  const handleLogout = async (event) => {
    event.preventDefault();
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Sign out failed:", err);
    }
    router.push("/login");
  };

  const getFirstNameInitial = (nameStr) => {
    if (!nameStr) return "M";
    const parts = nameStr.trim().split(/\s+/);
    const firstName = parts[0] || "";
    return firstName ? firstName[0].toUpperCase() : "M";
  };

  // Notification action handlers
  const handleNotificationClick = async (notif) => {
    setSelectedNotification(notif);
    setShowNotifications(false);

    if (notif.unread) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const readKey = `sacco_read_broadcasts_${session.user.id}`;
        const readIds = JSON.parse(localStorage.getItem(readKey) || "[]");
        
        if (!readIds.includes(notif.id)) {
          readIds.push(notif.id);
          localStorage.setItem(readKey, JSON.stringify(readIds));
        }

        // Refresh count & list status in state
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, unread: false } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch (err) {
        console.warn("Error marking notification read:", err);
      }
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const readKey = `sacco_read_broadcasts_${session.user.id}`;
      const allIds = notifications.map(n => n.id);
      localStorage.setItem(readKey, JSON.stringify(allIds));

      setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
      setUnreadCount(0);
    } catch (err) {
      console.warn("Failed to mark all as read:", err);
    }
  };

  const profileRef = useRef(null);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const memberId = profile?.member_number || (profile?.id ? `MEM-${profile.id.substring(0, 4)}` : "");
  const displayName = profile?.full_name || "Member";

  return (
    <>
      <header style={{ position: "relative" }}>
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
            <p>
              Welcome back, {profile?.full_name ? profile.full_name.split(" ")[0] : "Joseph"}! Complete your mandatory weekly obligations.
            </p>
          </div>
        </div>

        <div className="header-actions">
          <Search />

          {/* Dynamic Notification Bell Container */}
          <div 
            ref={notifRef}
            className="notification-bell"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowDropdown(false);
            }}
            style={{ position: "relative" }}
          >
            <i className="fa-regular fa-bell" />
            {unreadCount > 0 && (
              <span className="notification-bell-badge">{unreadCount}</span>
            )}

            {/* Notification Dropdown Panel */}
            {showNotifications && (
              <div className="notification-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="notification-dropdown-header">
                  <span className="notification-dropdown-title">SACCO Announcements</span>
                  {unreadCount > 0 && (
                    <button onClick={handleMarkAllRead} className="btn-clear-notifications">
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notification-empty">
                      <i className="fa-solid fa-bell-slash" style={{ color: "var(--text-light)" }} />
                      <span>No broadcasts received yet.</span>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        className={`notification-item ${n.unread ? "unread" : ""}`}
                        onClick={() => handleNotificationClick(n)}
                      >
                        <div className="notification-item-icon broadcast">
                          <i className="fa-solid fa-bullhorn" />
                        </div>
                        <div className="notification-item-details">
                          <span className="notification-item-title">{n.title}</span>
                          <span className="notification-item-preview">{n.content}</span>
                          <span className="notification-item-time">{n.time}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="user-profile" ref={profileRef} onClick={toggleProfileDropdown}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="User Avatar" />
            ) : (
              <div className="header-avatar-initials">
                {getFirstNameInitial(displayName)}
              </div>
            )}
            <div className="user-info">
              <span className="name">{displayName}</span>
              <span className="role">Member ID: {memberId}</span>
            </div>

            <div
              className={`profile-dropdown${showDropdown ? " show" : ""}`}
              id="profileDropdown"
            >
              {(((profile?.role || "").trim().toLowerCase() === "admin" || (profile?.role || "").trim().toLowerCase() === "super_admin") || (typeof window !== "undefined" && localStorage.getItem("is_admin_user") === "true")) && (
                <>
                  <Link href="/admin" className="dropdown-item" style={{ fontWeight: 600, color: "var(--primary-color)" }}>
                    <i className="fa-solid fa-user-shield" /> Switch to Admin Mode
                  </Link>
                  <div className="dropdown-divider" />
                </>
              )}
              <Link href="/settings" className="dropdown-item">
                <i className="fa-solid fa-user" /> My Profile Settings
              </Link>
              <div className="dropdown-divider" />
              <a href="#" className="dropdown-item" onClick={handleLogout}>
                <i className="fa-solid fa-right-from-bracket" /> Sign Out
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Broadcast Detail Modal Pop-up */}
      {selectedNotification && (
        <div className="notification-modal-overlay" onClick={() => setSelectedNotification(null)}>
          <div className="notification-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notification-modal-header">
              <i className="fa-solid fa-bullhorn" style={{ fontSize: "2.4rem", marginRight: "1rem" }} />
              <div className="notification-modal-title" style={{ fontSize: "1.7rem", fontWeight: 800 }}>
                {selectedNotification.title}
              </div>
            </div>
            <div className="notification-modal-body" style={{ margin: "1.5rem 0", color: "#334155", fontSize: "1.35rem" }}>
              {selectedNotification.content}
            </div>
            <div className="notification-modal-footer">
              <button 
                className="btn" 
                onClick={() => setSelectedNotification(null)}
                style={{ 
                  background: "var(--primary-color)", 
                  color: "var(--white)", 
                  padding: "1rem 2rem", 
                  border: "none", 
                  borderRadius: "1rem",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Close Announcement
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
