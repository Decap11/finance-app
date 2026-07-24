"use client";

import { useEffect, useState } from "react";
import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import { supabase } from "../supabaseClient.js";
import Loader from "../Components/loader.jsx";
import CustomSelect from "../Components/CustomSelect.jsx";
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

  const [activeTab, setActiveTab] = useState("profile");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordUpdating, setPasswordUpdating] = useState(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState("");
  const [passwordErrorMsg, setPasswordErrorMsg] = useState("");

  const handlePasswordReset = async (e) => {
    e.preventDefault();
    try {
      setPasswordUpdating(true);
      setPasswordSuccessMsg("");
      setPasswordErrorMsg("");

      if (!newPassword || newPassword.length < 6) {
        throw new Error("Password must be at least 6 characters long.");
      }

      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirm password do not match.");
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordSuccessMsg("Your password has been updated successfully!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.warn("Error resetting password:", err);
      setPasswordErrorMsg(err.message || "Failed to reset password.");
    } finally {
      setPasswordUpdating(false);
    }
  };

  useEffect(() => {
    async function loadUserProfile() {
      try {
        setLoading(true);
        setErrorMsg("");

        // 1. Get authenticated user session
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const headers = (token && token.length < 3000) ? { "Authorization": `Bearer ${token}` } : {};

        // Automatic repair: If token is bloated (> 3000 bytes), clear auth metadata
        if (token && token.length >= 3000) {
          supabase.auth.updateUser({ data: { avatar_url: null } }).then(() => {});
        }

        // 2. Query profile through local server-side proxy API
        const res = await fetch("/api/profile", { headers });
        const text = await res.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error(text || "Server returned a non-JSON profile response.");
        }

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

  const processAvatarImage = (file, max = 300) => {
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
            if (width > max) {
              height = Math.round((height * max) / width);
              width = max;
            }
          } else {
            if (height > max) {
              width = Math.round((width * max) / height);
              height = max;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          canvas.toBlob(
            (blob) => resolve({ blob, dataUrl }),
            "image/jpeg",
            0.85
          );
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleAvatarUpload = async (e) => {
    try {
      setErrorMsg("");
      setSuccessMsg("");
      const file = e.target.files[0];
      if (!file) return;

      setUpdating(true);
      const { blob, dataUrl } = await processAvatarImage(file, 300);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setErrorMsg("Your session has expired. Please log in again.");
        setUpdating(false);
        return;
      }

      const userId = session.user.id;
      let finalUrl = dataUrl;

      // 1. Try uploading file blob to Supabase Storage bucket 'avatars' (WhatsApp / Industry Standard)
      const filePath = `${userId}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { upsert: true, contentType: "image/jpeg" });

      if (!uploadErr) {
        const { data: urlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(filePath);
        if (urlData?.publicUrl) {
          // Add timestamp query parameter to bypass browser caching when updated
          finalUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        }
      } else {
        console.warn("Supabase Storage bucket upload warning:", uploadErr.message);
      }

      // 2. Save CDN URL or fallback data URL to public.profiles table
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: finalUrl })
        .eq("id", userId);

      if (dbErr) {
        console.warn("Database profiles table avatar_url update warning:", dbErr.message);
      }

      // 3. Save to auth user metadata (only if short HTTPS URL, to prevent bloated JWT tokens)
      if (finalUrl && !finalUrl.startsWith("data:image")) {
        try {
          await supabase.auth.updateUser({
            data: { avatar_url: finalUrl }
          });
        } catch (e) {
          // Ignore metadata update errors
        }
      }

      // 4. Save locally for instant UI update
      localStorage.setItem(`sacco_avatar_${userId}`, finalUrl);

      setAvatarUrl(finalUrl);

      // 5. Broadcast avatar update event to all active header and directory components
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_avatar_updated", {
          detail: { avatarUrl: finalUrl, userId }
        }));
      }

      setSuccessMsg("Profile avatar updated successfully!");
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
                <button
                  type="button"
                  onClick={() => setActiveTab("profile")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "1.2rem 1.5rem",
                    border: "none",
                    textDecoration: "none",
                    color: activeTab === "profile" ? "var(--primary-color)" : "var(--text-dark)",
                    background: activeTab === "profile" ? "var(--bg-color)" : "transparent",
                    borderRadius: "1rem",
                    fontWeight: activeTab === "profile" ? 600 : 500,
                    fontSize: "1.4rem",
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                >
                  <i
                    className="fa-solid fa-user-pen"
                    style={{ width: "2.5rem" }}
                  />
                  Edit Profile
                </button>
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setActiveTab("security")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    padding: "1.2rem 1.5rem",
                    border: "none",
                    textDecoration: "none",
                    color: activeTab === "security" ? "var(--primary-color)" : "var(--text-dark)",
                    background: activeTab === "security" ? "var(--bg-color)" : "transparent",
                    borderRadius: "1rem",
                    fontWeight: activeTab === "security" ? 600 : 500,
                    fontSize: "1.4rem",
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                >
                  <i
                    className="fa-solid fa-shield-halved"
                    style={{ width: "2.5rem", color: activeTab === "security" ? "var(--primary-color)" : "var(--text-light)" }}
                  />
                  Security & Password
                </button>
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
            {activeTab === "profile" && (
              <>
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
                      <CustomSelect
                        value="+256"
                        options={[
                          { value: "+256", label: "+256" },
                          { value: "+254", label: "+254" },
                          { value: "+255", label: "+255" },
                          { value: "+250", label: "+250" }
                        ]}
                        onChange={() => {}}
                        minWidth="100px"
                      />
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

                  <div
                    style={{
                      textAlign: "right",
                      paddingTop: "2rem",
                      borderTop: "0.1rem solid #f1f5f9",
                    }}
                  >
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
              </>
            )}

            {activeTab === "security" && (
              <div>
                <h2
                  style={{
                    fontSize: "2rem",
                    color: "var(--text-dark)",
                    marginBottom: "0.8rem",
                  }}
                >
                  Security & Password Reset
                </h2>
                <p style={{ fontSize: "1.3rem", color: "var(--text-light)", marginBottom: "2.5rem" }}>
                  Reset and update your login password to secure your SACCO member account.
                </p>

                {passwordSuccessMsg && (
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
                    {passwordSuccessMsg}
                  </div>
                )}
                {passwordErrorMsg && (
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
                    {passwordErrorMsg}
                  </div>
                )}

                <form onSubmit={handlePasswordReset}>
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
                      New Password
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password (at least 6 characters)"
                        required
                        minLength={6}
                        style={{
                          width: "100%",
                          padding: "1.2rem 4rem 1.2rem 1.5rem",
                          border: "0.1rem solid #e2e8f0",
                          borderRadius: "0.8rem",
                          fontSize: "1.4rem",
                          color: "var(--text-dark)",
                          fontFamily: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        style={{
                          position: "absolute",
                          right: "1.2rem",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#64748b",
                          fontSize: "1.4rem",
                          padding: "0.4rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                        title={showNewPassword ? "Hide password" : "Show password"}
                      >
                        <i className={showNewPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                      </button>
                    </div>
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
                      Confirm New Password
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        required
                        minLength={6}
                        style={{
                          width: "100%",
                          padding: "1.2rem 4rem 1.2rem 1.5rem",
                          border: "0.1rem solid #e2e8f0",
                          borderRadius: "0.8rem",
                          fontSize: "1.4rem",
                          color: "var(--text-dark)",
                          fontFamily: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        style={{
                          position: "absolute",
                          right: "1.2rem",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "#64748b",
                          fontSize: "1.4rem",
                          padding: "0.4rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                        title={showConfirmPassword ? "Hide password" : "Show password"}
                      >
                        <i className={showConfirmPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"} />
                      </button>
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
                      type="submit"
                      disabled={passwordUpdating}
                      style={{
                        padding: "1.2rem 2.4rem",
                        background: "var(--primary-color)",
                        color: "white",
                        border: "none",
                        borderRadius: "0.8rem",
                        fontWeight: 600,
                        fontSize: "1.4rem",
                        cursor: passwordUpdating ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.8rem",
                        opacity: passwordUpdating ? 0.7 : 1,
                      }}
                    >
                      {passwordUpdating ? "Updating..." : "Reset Password"} <i className="fa-solid fa-key" />
                    </button>
                  </div>
                </form>
              </div>
            )}
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
