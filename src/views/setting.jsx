"use client";

import { useEffect, useState } from "react";
import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import { supabase } from "../supabaseClient.js";
import Loader from "../Components/loader.jsx";
import "../styles/settings.css";

export default function Settings({ isAdminView = false }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function loadUserProfile() {
      try {
        setLoading(true);
        setErrorMsg("");

        // 1. Get authenticated user session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setErrorMsg("User session not found. Please log in.");
          setLoading(false);
          return;
        }

        // 2. Query profile through local server-side proxy API
        const res = await fetch("/api/profile", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load settings profile.");
        }

        setProfile(data.profile);
        setEmail(data.profile.email || "");
        setPhone(data.profile.phone || "");

        // 3. Load avatar from database with local storage fallback
        if (data.profile) {
          const localAvatar = localStorage.getItem(`sacco_avatar_${data.profile.id}`);
          const avatar = data.profile.avatar_url || localAvatar || data.user?.user_metadata?.avatar_url || "";
          setAvatarUrl(avatar);
        }
      } catch (err) {
        console.warn("Error fetching user profile:", err);
        setErrorMsg("Failed to load settings profile: " + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadUserProfile();
  }, []);

  const compressImage = (file, maxWidth = 250, maxHeight = 250, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedDataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleAvatarUpload = async (e) => {
    try {
      setErrorMsg("");
      setSuccessMsg("");
      const file = e.target.files[0];
      if (!file) return;

      setUpdating(true);
      const compressedBase64 = await compressImage(file, 250, 250, 0.8);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setErrorMsg("Your session has expired. Please log in again.");
        setUpdating(false);
        return;
      }

      // 1. Save to local storage for instant local preview
      if (session.user?.id) {
        localStorage.setItem(`sacco_avatar_${session.user.id}`, compressedBase64);
      }

      // 2. Direct client-side update to public.profiles table
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ avatar_url: compressedBase64 })
        .eq('id', session.user.id);

      if (dbErr) {
        console.warn("Direct DB avatar update warning:", dbErr.message);
      }

      // 3. Persist to API route as secondary sync
      try {
        await fetch('/api/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            action: 'update_avatar',
            avatar_url: compressedBase64
          })
        });
      } catch (apiErr) {
        console.warn("API route avatar update warning:", apiErr.message);
      }

      setAvatarUrl(compressedBase64);
      setSuccessMsg("Avatar updated successfully across all devices!");
    } catch (err) {
      console.warn("Error uploading avatar:", err);
      setErrorMsg("Failed to upload avatar: " + err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setUpdating(true);
      setSuccessMsg("");
      setErrorMsg("");

      if (!profile) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("No active session found.");
      }

      // Save through local server-side API proxy
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "update_profile",
          email: email.trim(),
          phone: phone.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save changes.");
      }

      setSuccessMsg("Personal information updated successfully!");
    } catch (err) {
      console.warn("Error updating profile:", err);
      setErrorMsg("Failed to save changes: " + err.message);
    } finally {
      setUpdating(false);
    }
  };

  // Helper to split full name into first and last
  const names = (profile?.full_name || "").trim().split(" ");
  const firstName = names[0] || "";
  const lastName = names.slice(1).join(" ") || "";

  // Helper to format date
  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "N/A";

  const memberId = profile?.member_number || (profile?.id ? `MEM-${profile.id.substring(0, 4)}` : "N/A");

  if (loading) {
    if (isAdminView) {
      return (
        <div style={{ padding: "8rem 0", display: "flex", justifyContent: "center" }}>
          <Loader />
        </div>
      );
    }
    return (
      <MemberLayout>
        <div className="dashboard-body">
          <UserHeader />
          <div style={{ padding: "8rem 0", display: "flex", justifyContent: "center" }}>
            <Loader />
          </div>
        </div>
      </MemberLayout>
    );
  }

  const settingsContent = (
    <section className="settings-container">
          {/* Settings Sidebar */}
          <div
            className="settings-sidebar"
            style={{
              background: "var(--white)",
              borderRadius: "1.6rem",
              padding: "2rem",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div
              className="settings-profile-summary"
              style={{
                textAlign: "center",
                paddingBottom: "2rem",
                borderBottom: "0.1rem solid #f1f5f9",
                marginBottom: "2rem",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "10rem",
                  height: "10rem",
                  margin: "0 auto 1.5rem",
                  cursor: "pointer",
                }}
                onClick={() => document.getElementById("avatarInput").click()}
              >
                {/* Fallback to Initials Avatar if none uploaded */}
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile Avatar"
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "0.2rem solid white",
                      boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.1)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--primary-color) 0%, #3b82f6 100%)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "3.6rem",
                      fontWeight: 700,
                      border: "0.2rem solid white",
                      boxShadow: "0 0.5rem 1.5rem rgba(0,0,0,0.1)",
                    }}
                  >
                    {profile?.full_name ? (
                      (() => {
                        const parts = profile.full_name.trim().split(/\s+/);
                        const first = parts[0] || "";
                        return first ? first[0].toUpperCase() : "M";
                      })()
                    ) : "M"}
                  </div>
                )}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    background: "var(--primary-color)",
                    color: "white",
                    width: "3rem",
                    height: "3rem",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    border: "0.2rem solid white",
                  }}
                >
                  <i className="fa-solid fa-camera" />
                </div>
              </div>

              {/* Hidden file input */}
              <input
                id="avatarInput"
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                style={{ display: "none" }}
              />

              <h3
                style={{
                  fontSize: "1.8rem",
                  color: "var(--text-dark)",
                  marginBottom: "0.5rem",
                  fontWeight: 700,
                }}
              >
                {profile?.full_name || "Member User"}
              </h3>
              <p style={{ fontSize: "1.3rem", color: "var(--text-light)" }}>
                Mem ID: {memberId} • Joined {joinedDate}
              </p>
              <div style={{ marginTop: "0.8rem", display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap" }}>
                <span style={{
                  padding: "0.4rem 0.8rem",
                  background: "#e0f2fe",
                  color: "#0369a1",
                  borderRadius: "9999px",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  textTransform: "uppercase"
                }}>
                  {profile?.role || "member"}
                </span>
                {profile?.group_id && (
                  <span style={{
                    padding: "0.4rem 0.8rem",
                    background: "#f0fdf4",
                    color: "#166534",
                    borderRadius: "9999px",
                    fontSize: "1.1rem",
                    fontWeight: 600
                  }}>
                    Group: {profile.group_id}
                  </span>
                )}
              </div>
            </div>

            <ul
              className="settings-nav"
              style={{ listStyle: "none", padding: 0 }}
            >
              <li style={{ marginBottom: "0.5rem" }}>
                <a
                  href="#"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "1.2rem 1.5rem",
                    textDecoration: "none",
                    color: "var(--primary-color)",
                    background: "var(--bg-color)",
                    borderRadius: "1rem",
                    fontWeight: 600,
                    fontSize: "1.4rem",
                  }}
                >
                  <i
                    className="fa-solid fa-user-pen"
                    style={{ width: "2.5rem" }}
                  />
                  Edit Profile
                </a>
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                <a
                  href="#"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "1.2rem 1.5rem",
                    textDecoration: "none",
                    color: "var(--text-dark)",
                    fontWeight: 500,
                    fontSize: "1.4rem",
                    transition: "background 0.2s",
                    borderRadius: "1rem",
                  }}
                >
                  <i
                    className="fa-solid fa-shield-halved"
                    style={{ width: "2.5rem", color: "var(--text-light)" }}
                  />
                  Security
                </a>
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                <a
                  href="#"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "1.2rem 1.5rem",
                    textDecoration: "none",
                    color: "var(--text-dark)",
                    fontWeight: 500,
                    fontSize: "1.4rem",
                    transition: "background 0.2s",
                    borderRadius: "1rem",
                  }}
                >
                  <i
                    className="fa-solid fa-bell"
                    style={{ width: "2.5rem", color: "var(--text-light)" }}
                  />
                  Notifications
                </a>
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                <a
                  href="#"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "1.2rem 1.5rem",
                    textDecoration: "none",
                    color: "var(--text-dark)",
                    fontWeight: 500,
                    fontSize: "1.4rem",
                    transition: "background 0.2s",
                    borderRadius: "1rem",
                  }}
                >
                  <i
                    className="fa-solid fa-building-columns"
                    style={{ width: "2.5rem", color: "var(--text-light)" }}
                  />
                  Linked Accounts
                </a>
              </li>
            </ul>
          </div>

          {/* Settings Form Area */}
          <div
            className="settings-content"
            style={{
              background: "var(--white)",
              borderRadius: "1.6rem",
              padding: "3rem",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <h2
              style={{
                fontSize: "2rem",
                color: "var(--text-dark)",
                marginBottom: "2.5rem",
              }}
            >
              Personal Information
            </h2>

            {/* Notification Badges */}
            {successMsg && (
              <div
                style={{
                  background: "#d1e7dd",
                  color: "#0f5132",
                  padding: "1.2rem 1.5rem",
                  borderRadius: "0.8rem",
                  fontSize: "1.4rem",
                  marginBottom: "2rem",
                  fontWeight: 500,
                }}
              >
                <i className="fa-solid fa-circle-check" style={{ marginRight: "0.8rem" }} />
                {successMsg}
              </div>
            )}
            {errorMsg && (
              <div
                style={{
                  background: "#f8d7da",
                  color: "#842029",
                  padding: "1.2rem 1.5rem",
                  borderRadius: "0.8rem",
                  fontSize: "1.4rem",
                  marginBottom: "2rem",
                  fontWeight: 500,
                }}
              >
                <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.8rem" }} />
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="settings-form-grid">
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "1.3rem",
                      fontWeight: 600,
                      color: "var(--text-dark)",
                      marginBottom: "0.8rem",
                    }}
                  >
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    disabled
                    style={{
                      width: "100%",
                      padding: "1.2rem 1.5rem",
                      border: "0.1rem solid #e2e8f0",
                      borderRadius: "0.8rem",
                      fontSize: "1.4rem",
                      color: "var(--text-light)",
                      fontFamily: "inherit",
                      background: "#f8fafc",
                      cursor: "not-allowed",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "1.3rem",
                      fontWeight: 600,
                      color: "var(--text-dark)",
                      marginBottom: "0.8rem",
                    }}
                  >
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    disabled
                    style={{
                      width: "100%",
                      padding: "1.2rem 1.5rem",
                      border: "0.1rem solid #e2e8f0",
                      borderRadius: "0.8rem",
                      fontSize: "1.4rem",
                      color: "var(--text-light)",
                      fontFamily: "inherit",
                      background: "#f8fafc",
                      cursor: "not-allowed",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "1.3rem",
                    fontWeight: 600,
                    color: "var(--text-dark)",
                    marginBottom: "0.8rem",
                  }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "1.2rem 1.5rem",
                    border: "0.1rem solid #e2e8f0",
                    borderRadius: "0.8rem",
                    fontSize: "1.4rem",
                    color: "var(--text-dark)",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ marginBottom: "3rem" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "1.3rem",
                    fontWeight: 600,
                    color: "var(--text-dark)",
                    marginBottom: "0.8rem",
                  }}
                >
                  Phone Number
                </label>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <select
                    defaultValue="+256"
                    style={{
                      padding: "1.2rem",
                      border: "0.1rem solid #e2e8f0",
                      borderRadius: "0.8rem",
                      fontSize: "1.4rem",
                      color: "var(--text-dark)",
                      fontFamily: "inherit",
                      background: "white",
                    }}
                  >
                    <option value="+256">+256</option>
                  </select>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    style={{
                      flex: 1,
                      padding: "1.2rem 1.5rem",
                      border: "0.1rem solid #e2e8f0",
                      borderRadius: "0.8rem",
                      fontSize: "1.4rem",
                      color: "var(--text-dark)",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>

              <h2
                style={{
                  fontSize: "2rem",
                  color: "var(--text-dark)",
                  marginBottom: "2.5rem",
                  paddingTop: "2rem",
                  borderTop: "0.1rem solid #f1f5f9",
                }}
              >
                Preferences
              </h2>

              <div style={{ marginBottom: "3rem" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "1.5rem",
                  }}
                >
                  <div>
                    <h4
                      style={{
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      Monthly Statements
                    </h4>
                    <p
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--text-light)",
                      }}
                    >
                      Receive PDF statements of your pool balances via email.
                    </p>
                  </div>
                  <label
                    style={{
                      position: "relative",
                      display: "inline-block",
                      width: "4.8rem",
                      height: "2.4rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      defaultChecked
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        cursor: "pointer",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "var(--primary-color)",
                        transition: ".4s",
                        borderRadius: "3.4rem",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          height: "1.8rem",
                          width: "1.8rem",
                          left: "2.6rem",
                          bottom: "0.3rem",
                          backgroundColor: "white",
                          transition: ".4s",
                          borderRadius: "50%",
                        }}
                      />
                    </span>
                  </label>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <h4
                      style={{
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        marginBottom: "0.3rem",
                      }}
                    >
                      SMS Alerts
                    </h4>
                    <p
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--text-light)",
                      }}
                    >
                      Get instant texts when admin approves a contribution.
                    </p>
                  </div>
                  <label
                    style={{
                      position: "relative",
                      display: "inline-block",
                      width: "4.8rem",
                      height: "2.4rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      defaultChecked
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        cursor: "pointer",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "var(--primary-color)",
                        transition: ".4s",
                        borderRadius: "3.4rem",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          height: "1.8rem",
                          width: "1.8rem",
                          left: "2.6rem",
                          bottom: "0.3rem",
                          backgroundColor: "white",
                          transition: ".4s",
                          borderRadius: "50%",
                        }}
                      />
                    </span>
                  </label>
                </div>
              </div>

              <div
                style={{
                  textAlign: "right",
                  paddingTop: "2rem",
                  borderTop: "0.1rem solid #f1f5f9",
                }}
              >
                <button
                  type="button"
                  style={{
                    padding: "1.2rem 2.4rem",
                    background: "transparent",
                    border: "none",
                    color: "var(--text-light)",
                    fontWeight: 600,
                    fontSize: "1.4rem",
                    cursor: "pointer",
                    marginRight: "1rem",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  style={{
                    padding: "1.2rem 2.4rem",
                    background: "var(--primary-color)",
                    color: "white",
                    border: "none",
                    borderRadius: "0.8rem",
                    fontWeight: 600,
                    fontSize: "1.4rem",
                    cursor: updating ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.8rem",
                    opacity: updating ? 0.7 : 1,
                  }}
                >
                  {updating ? "Saving..." : "Save Changes"} <i className="fa-solid fa-check" />
                </button>
              </div>
            </form>
          </div>
        </section>
  );

  if (isAdminView) {
    return <div className="">{settingsContent}</div>;
  }

  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
        {settingsContent}
      </div>
    </MemberLayout>
  );
}
