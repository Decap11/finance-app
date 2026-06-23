import { useState } from "react";
import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import "../styles/GroupMembers.css";

export default function GroupMembers() {
  // Fetch members from global state or localStorage fallback
  const getMembersList = () => {
    if (window.SaccoState) {
      return window.SaccoState.getMembers();
    }
    return JSON.parse(localStorage.getItem("members") || "[]");
  };

  const [membersList] = useState(getMembersList);

  // Normalize group ID to "KAMPALA" for mock seeded members who don't have one
  const normalizedMembers = membersList.map((member) => ({
    ...member,
    groupId: member.groupId || "KAMPALA",
  }));

  // Extract unique group IDs
  const groups = [...new Set(normalizedMembers.map((m) => m.groupId))];

  // Set default group to "KAMPALA" if available, else first group
  const defaultGroup = groups.includes("KAMPALA") ? "KAMPALA" : (groups[0] || "KAMPALA");
  const [selectedGroup, setSelectedGroup] = useState(defaultGroup);

  // Filter members by the selected group
  const filteredMembers = normalizedMembers.filter(
    (member) => member.groupId === selectedGroup
  );

  return (
    <MemberLayout>
      <UserHeader />
      <div className="dashboard-body">
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
                Active Group: {selectedGroup}
              </div>

              {groups.length > 1 && (
                <div className="group-selector-wrapper">
                  <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    style={{
                      padding: "0.8rem 1.6rem",
                      fontSize: "1.3rem",
                      borderRadius: "1rem",
                      border: "1px solid var(--input-border)",
                      background: "var(--white)",
                      color: "var(--text-dark)",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit"
                    }}
                  >
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Members 2-Column Grid */}
          {filteredMembers.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "5rem 2rem",
                background: "var(--white)",
                borderRadius: "var(--border-radius)",
                boxShadow: "var(--card-shadow)"
              }}
            >
              <i
                className="fa-solid fa-users-slash"
                style={{ fontSize: "5rem", color: "var(--text-light)", marginBottom: "1.5rem" }}
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
                    <img
                      src={member.avatarUrl}
                      alt={`${member.name} Avatar`}
                      className="member-avatar"
                      onError={(e) => {
                        e.currentTarget.src = `https://placehold.co/150x150/253b8e/ffffff?text=${member.firstName ? member.firstName[0] : 'M'}`;
                      }}
                    />
                    <div className="member-identity">
                      <h3 className="member-name">{member.name}</h3>
                      <div className="member-badges">
                        <span className="badge-id">{member.id}</span>
                        <span className="badge-tier">{member.tier || "Basic"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Contact & Registration Info */}
                  <div className="member-contact-info">
                    <div className="contact-row">
                      <i className="fa-solid fa-phone" />
                      <span>Phone: <span className="contact-value">{member.phone}</span></span>
                    </div>
                    {member.email && (
                      <div className="contact-row">
                        <i className="fa-solid fa-envelope" />
                        <span>Email: <span className="contact-value">{member.email}</span></span>
                      </div>
                    )}
                    <div className="contact-row">
                      <i className="fa-solid fa-calendar-days" />
                      <span>Joined: <span className="contact-value">{member.joinedDate || "N/A"}</span></span>
                    </div>
                    <div className="contact-row">
                      <i className="fa-solid fa-id-card" />
                      <span>Group ID: <span className="contact-value">{member.groupId}</span></span>
                    </div>
                  </div>

                  {/* Financial Balances Sub-Grid */}
                  <div className="member-balances-grid">
                    <div className="balance-item">
                      <span className="balance-label">Savings</span>
                      <div className="balance-amount">
                        Shs {(member.savings || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="balance-item">
                      <span className="balance-label">Shares Value</span>
                      <div className="balance-amount">
                        Shs {(member.shares || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="balance-item">
                      <span className="balance-label">Dev Fund</span>
                      <div className="balance-amount">
                        Shs {(member.devFund || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="balance-item">
                      <span className="balance-label">Social Fund</span>
                      <div className="balance-amount">
                        Shs {(member.socialFund || 0).toLocaleString()}
                      </div>
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
