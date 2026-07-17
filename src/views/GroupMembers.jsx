"use client";

import { useEffect, useState } from "react";
import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import { supabase } from "../supabaseClient.js";
import Loader from "../Components/loader.jsx";
import "../styles/GroupMembers.css";

export default function GroupMembers() {
  const [membersList, setMembersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");

  useEffect(() => {
    async function loadMembers() {
      try {
        setLoading(true);
        setErrorMsg("");

        // 1. Get authenticated user session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setErrorMsg("Authentication required. Please log in.");
          setLoading(false);
          return;
        }

        // 2. Query directory through local server-side proxy API
        const res = await fetch("/api/group-members", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to load group members.");
        }

        const currentGroupCode = data.group_id;
        setSelectedGroup(currentGroupCode);
        const profiles = data.profiles;

        if (!profiles || profiles.length === 0) {
          setMembersList([]);
          setLoading(false);
          return;
        }

        const groupCount = profiles.length;

        const combined = profiles.map((p) => {
          const isCurrentUser = String(p.id).toLowerCase() === String(session.user.id).toLowerCase();
          const localAvatar = localStorage.getItem(`sacco_avatar_${p.id}`) || (isCurrentUser ? localStorage.getItem(`sacco_avatar_${session.user.id}`) : null);
          const metaAvatar = isCurrentUser ? (session.user?.user_metadata?.avatar_url || "") : "";
          const avatarUrl = p.avatar_url || localAvatar || metaAvatar || "";

          // Auto-backfill database table if missing for current user
          if (isCurrentUser && !p.avatar_url && avatarUrl) {
            supabase
              .from("profiles")
              .update({ avatar_url: avatarUrl })
              .eq("id", p.id)
              .then(({ error }) => {
                if (error) console.warn("Auto-sync profile avatar error:", error.message);
              });
          }

          return {
            id: p.member_number || `MEM-${p.id.substring(0, 8)}`,
            name: p.full_name || "Unknown Member",
            phone: p.phone || "N/A",
            email: p.email || "N/A",
            joinedDate: p.created_at
              ? new Date(p.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })
              : "N/A",
            groupId: currentGroupCode,
            tier: p.role === "admin" ? "Admin" : "Member",
            avatarUrl: avatarUrl,
            groupMembersCount: groupCount,
            isCurrentUser,
          };
        });

        setMembersList(combined);
      } catch (err) {
        console.warn("Error loading group directory:", err);
        setErrorMsg("Failed to load group members directory: " + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadMembers();
  }, []);

  const filteredMembers = membersList.filter(
    (member) => member.groupId === selectedGroup
  );

  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
        <section className="group-members-container">
          {/* Header Control Card */}
          <div className="group-header-card">
            <div className="group-header-info">
              <h2>Group Members Directory</h2>
              <p>Viewing all registered active members for this workspace.</p>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
              <div className="active-group-badge">
                <i className="fa-solid fa-users-rectangle"></i>
                Active Group: {selectedGroup || "Loading..."}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "5rem 0", display: "flex", justifyContent: "center" }}>
              <Loader />
            </div>
          ) : errorMsg ? (
            <div
              style={{
                textAlign: "center",
                padding: "4rem 2rem",
                background: "var(--white)",
                borderRadius: "var(--border-radius)",
                boxShadow: "var(--card-shadow)",
              }}
            >
              <i
                className="fa-solid fa-triangle-exclamation"
                style={{ fontSize: "4rem", color: "#f44336", marginBottom: "1.5rem" }}
              />
              <p style={{ fontSize: "1.6rem", color: "var(--text-light)" }}>{errorMsg}</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "5rem 2rem",
                background: "var(--white)",
                borderRadius: "var(--border-radius)",
                boxShadow: "var(--card-shadow)",
              }}
            >
              <i
                className="fa-solid fa-users-slash"
                style={{
                  fontSize: "5rem",
                  color: "var(--text-light)",
                  marginBottom: "1.5rem",
                }}
              />
              <p style={{ fontSize: "1.6rem", color: "var(--text-light)" }}>
                No members found in group <strong>{selectedGroup}</strong>.
              </p>
            </div>
          ) : (
            <div className="members-grid">
              {filteredMembers.map((member) => (
                <div key={member.id} className="member-card">
                  {/* Card Header: Avatar & Badges */}
                  <div className="member-card-header">
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={`${member.name} Avatar`}
                        className="member-avatar"
                      />
                    ) : (
                      <div className="member-avatar-initials">
                        {member.name ? member.name[0].toUpperCase() : "M"}
                      </div>
                    )}
                    <div className="member-identity">
                      <h3 className="member-name">{member.name}</h3>
                      <div className="member-badges">
                        <span className="badge-id">{member.id}</span>
                        <span className="badge-tier">
                          {member.tier}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Contact & Registration Info */}
                  <div className="member-contact-info">
                    <div className="contact-row">
                      <i className="fa-solid fa-phone" />
                      <span>
                        Phone:{" "}
                        <span className="contact-value">{member.phone}</span>
                      </span>
                    </div>
                    {member.email && (
                      <div className="contact-row">
                        <i className="fa-solid fa-envelope" />
                        <span>
                          Email:{" "}
                          <span className="contact-value">{member.email}</span>
                        </span>
                      </div>
                    )}
                    <div className="contact-row">
                      <i className="fa-solid fa-calendar-days" />
                      <span>
                        Joined:{" "}
                        <span className="contact-value">
                          {member.joinedDate}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </MemberLayout>
  );
}
