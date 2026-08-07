"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSidebar } from "../context/useSidebar";
import { useGuarantorAlerts } from "../context/useGuarantorAlerts";
import { supabase } from "../supabaseClient";
import { MEMBER_VIEW_KEY } from "./ProtectedRoute";
import Search from "./Search";
import AlertDot from "./AlertDot";
import "../styles/userHeader.css";

export default function UserHeader() {
  const [showDropdown, setShowDropdown] = useState(false);
  const { isOpen, toggleSidebar } = useSidebar();
  // Safe without the provider -- returns 0. See guarantorAlertContext.ts.
  const { pendingCount } = useGuarantorAlerts();
  const router = useRouter();

  const [profile, setProfile] = useState(null);
  const [sessionUser, setSessionUser] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");

  // Notifications states
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedNotification, setSelectedNotification] = useState(null);
  
  const notifRef = useRef(null);
  // Wraps the avatar AND the menu it opens -- the dropdown is rendered inside
  // .user-profile, so one ref covers both and "outside" means what it says.
  const profileRef = useRef(null);

  useEffect(() => {
    // Declared inside the effect, above its only caller. It lived below the effect and was
    // reached only because an await sat between, which is a ReferenceError waiting for
    // someone to remove that await. Nothing else calls it, so it belongs in here.
    async function fetchBroadcasts(userProfile, userId) {
      try {
        if (!userProfile?.group_id) return;

        // 1. Get Sacco UUID from group_code
        const { data: sacco } = await supabase
          .from('saccos')
          .select('id')
          .eq('group_code', userProfile.group_id)
          .maybeSingle();

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
    }

    async function loadHeaderProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        setSessionUser(session.user);

        const res = await fetch("/api/profile", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.profile) {
          setProfile(data.profile);
          const localAvatar = localStorage.getItem(`sacco_avatar_${data.profile.id}`);
          if (localAvatar) {
            setAvatarUrl(localAvatar);
          } else if (data.profile.avatar_url) {
            setAvatarUrl(data.profile.avatar_url);
          } else if (data.user?.user_metadata?.avatar_url) {
            setAvatarUrl(data.user.user_metadata.avatar_url);
          }

          // Fetch broadcasts for this SACCO Group
          await fetchBroadcasts(data.profile, session.user.id);
        }
      } catch (err) {
        console.warn("Failed to load header profile:", err);
      }
    }

    loadHeaderProfile();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setSessionUser(session.user);
        const localAvatar = localStorage.getItem(`sacco_avatar_${session.user.id}`);
        if (localAvatar) {
          setAvatarUrl(localAvatar);
          return;
        }
        if (session.user.user_metadata?.avatar_url) {
          setAvatarUrl(session.user.user_metadata.avatar_url);
        }
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const toggleProfileDropdown = (event) => {
    event.stopPropagation();
    setShowDropdown((prev) => !prev);
    setShowNotifications(false);
  };

  const handleLogout = async (event) => {
    event.preventDefault();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const getInitials = (nameStr) => {
    if (!nameStr) return "U";
    const parts = nameStr.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

  // Close either menu when the tap or click lands anywhere else.
  //
  // pointerdown rather than mousedown: on a touch screen the browser only synthesises
  // mousedown once the tap has finished, so a menu dismissed on mousedown visibly lingers
  // under the finger. pointerdown fires for mouse, touch and pen alike, at the moment
  // contact is made, which is what makes this feel like every other app.
  //
  // Tapping the avatar itself is not an outside click -- it is inside profileRef, and
  // toggleProfileDropdown below is what closes an already-open menu. Were this to fire on
  // the avatar too, the two would cancel out and the menu would never open at all.
  useEffect(() => {
    function handlePointerOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerOutside);
    return () => {
      document.removeEventListener("pointerdown", handlePointerOutside);
    };
  }, []);

  const displayName = profile?.full_name || sessionUser?.user_metadata?.full_name || "Member";
  const memberId = profile?.member_number || sessionUser?.user_metadata?.member_number || (profile?.id ? `MEM-${profile.id.substring(0, 4).toUpperCase()}` : "MEM-001");
  const isAdmin = profile?.role === "admin" || sessionUser?.user_metadata?.role === "admin";

  return (
    <>
      <header style={{ position: "relative" }}>
        <div className="header-left">
          {/* The hamburger is the only navigation a member has on a phone, so a request
              waiting behind it is invisible until they happen to open the menu. The dot
              is what makes it visible without opening anything. Hidden once the sidebar
              is open -- at that point the marker on the Loans link is doing the work, and
              two dots for one request reads as two requests. */}
          <span className="alert-dot-anchor">
            <button
              type="button"
              className="menu-toggle"
              onClick={toggleSidebar}
              aria-label="Toggle navigation menu"
              aria-expanded={isOpen}
            >
              <i className={`fa-solid ${isOpen ? "fa-xmark" : "fa-bars"}`} />
            </button>
            {!isOpen && (
              <AlertDot
                count={pendingCount}
                label="Loan guarantee requests waiting for your decision"
              />
            )}
          </span>
          <div className="welcome-text">
            <h1>Member Overview</h1>
            <p>
              Welcome back, {displayName.split(" ")[0]}! Complete your mandatory weekly obligations.
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
                {getInitials(displayName)}
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
              {isAdmin && (
                <>
                  {/* Clearing the flag is what ends member view. Leave it set and the next
                      visit to /dashboard stays on the member screen instead of routing an
                      admin to their own. */}
                  <Link
                    href="/admin"
                    className="dropdown-item"
                    style={{ fontWeight: 600, color: "var(--primary-color)" }}
                    onClick={() => sessionStorage.removeItem(MEMBER_VIEW_KEY)}
                  >
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
