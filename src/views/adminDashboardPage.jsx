import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import Header from "../Components/Header.jsx";
import ActionCards from "../Components/ActionCard.jsx";
import ContributionApprovals from "../Components/ContributionApprovals.jsx";
import QuickMemberManagement from "../Components/QuickMemberManagement.jsx";
import ManualContributionLog from "../Components/manualContributionlog.jsx";
import BroadcastMessageWidget from "../Components/BroadcastMessageWidget.jsx";
import AdminLayout from "../layout/AdminLayout.jsx";
import PaymentPlans from "../Components/Payments.jsx";
import SaccoSettings from "../Components/saccoSettings.jsx";

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";

  const [allMembers, setAllMembers] = useState([]);
  const [metrics, setMetrics] = useState({
    pendingApprovals: 0,
    totalCapital: 0,
    totalMembers: 0,
    activeLoansTotal: 0,
  });

  useEffect(() => {
    let saccoId = null;

    async function fetchAdminData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Fetch group_id of the user from profiles (bypassing memberships)
      const { data: profileData } = await supabase
        .from("profiles")
        .select("group_id")
        .eq("id", user.id)
        .single();

      if (!profileData) return;

      // 2. Fetch matching Sacco ID
      const { data: saccoData } = await supabase
        .from("saccos")
        .select("id")
        .eq("group_code", profileData.group_id)
        .limit(1)
        .single();

      if (!saccoData) return;
      saccoId = saccoData.id;

      // Fetch all members in this SACCO group directly from profiles sharing the same group_id
      const { data: profilesList } = await supabase
        .from("profiles")
        .select("*")
        .eq("group_id", profileData.group_id);

      if (profilesList) {
        setAllMembers(
          profilesList.map((m) => {
            const isCurrentUser = String(m.id).toLowerCase() === String(user.id).toLowerCase();
            const localAvatar = typeof window !== "undefined" ? (localStorage.getItem(`sacco_avatar_${m.id}`) || (isCurrentUser ? localStorage.getItem(`sacco_avatar_${user.id}`) : null)) : null;
            const avatarUrl = m.avatar_url || m.avatarUrl || m.avatar || localAvatar || "";
            return {
              id: m.id,
              name: m.full_name || "Unknown",
              memberId: m.member_number || "",
              phone: m.phone || "N/A",
              email: m.email || "N/A",
              joinedDate: m.created_at ? new Date(m.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "N/A",
              role: m.role || "member",
              status: m.status || "pending",
              avatarUrl: avatarUrl,
            };
          }),
        );

        setMetrics((prev) => ({ ...prev, totalMembers: profilesList.length }));
      }

      // Fetch metrics
      loadMetrics();
    }

    async function loadMetrics() {
      if (!saccoId) return;

      // 1. Fetch pending approvals count
      const { count: pendingCount } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("sacco_id", saccoId)
        .eq("status", "pending");

      // 2. Fetch Sacco Total Balances (capital)
      const { data: { session } } = await supabase.auth.getSession();
      let calculatedCapital = 0;
      if (session) {
        const { data: totalBalances } = await supabase.rpc('get_sacco_total_balances', { p_profile_id: session.user.id });
        if (totalBalances) {
          calculatedCapital = totalBalances.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
        }
      }

      // 3. Fetch Active Loans issued total
      const { data: activeLoans } = await supabase
        .from("loans")
        .select("outstanding_balance")
        .eq("sacco_id", saccoId)
        .eq("status", "issued");
      
      let calculatedLoans = 0;
      if (activeLoans) {
        calculatedLoans = activeLoans.reduce((sum, loan) => sum + (Number(loan.outstanding_balance) || 0), 0);
      }

      setMetrics((prev) => ({
        ...prev,
        pendingApprovals: pendingCount || 0,
        totalCapital: calculatedCapital,
        activeLoansTotal: calculatedLoans,
      }));
    }

    fetchAdminData();

    // Subscribe to transactions changes to update count in real-time
    const channel = supabase
      .channel('admin-dashboard-realtime-metrics')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          loadMetrics();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loans'
        },
        () => {
          loadMetrics();
        }
      )
      .subscribe();

    const handleAvatarBroadcast = (event) => {
      if (event.detail?.avatarUrl && event.detail?.userId) {
        setAllMembers((prev) =>
          prev.map((m) =>
            m.id === event.detail.userId ? { ...m, avatarUrl: event.detail.avatarUrl } : m
          )
        );
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_avatar_updated", handleAvatarBroadcast);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_avatar_updated", handleAvatarBroadcast);
      }
    };
  }, []);

  const handleMakeAdmin = async (memberId) => {
    const confirmPromote = window.confirm("Are you sure you want to make this member an admin?");
    if (!confirmPromote) return;

    try {
      // 1. Attempt RPC call
      const { error: rpcErr } = await supabase.rpc('make_member_admin', {
        p_member_id: memberId
      });

      // 2. Direct table update fallback to guarantee role & status update in database
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ role: 'admin', status: 'active' })
        .eq('id', memberId);

      if (updateErr && rpcErr) throw new Error(rpcErr.message || updateErr.message);

      alert("Member successfully promoted to admin!");
      setAllMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: 'admin', status: 'active' } : m));
    } catch (err) {
      alert("Failed to make member admin: " + err.message);
    }
  };

  const handleApproveMember = async (memberId) => {
    const confirmApprove = window.confirm("Are you sure you want to approve this pending member?");
    if (!confirmApprove) return;

    try {
      // 1. Attempt RPC call
      const { error: rpcErr } = await supabase.rpc('approve_member', {
        p_member_id: memberId
      });

      // 2. Direct table update fallback to guarantee status='active' in database
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ status: 'active' })
        .eq('id', memberId);

      if (updateErr && rpcErr) throw new Error(rpcErr.message || updateErr.message);

      alert("Member successfully approved!");
      setAllMembers(prev => prev.map(m => m.id === memberId ? { ...m, status: 'active' } : m));
    } catch (err) {
      alert("Failed to approve member: " + err.message);
    }
  };

  const handleDeleteMember = async (memberId) => {
    const confirmDelete = window.confirm("Are you sure you want to entirely delete this member's data away from our SACCO group?");
    if (!confirmDelete) return;

    try {
      const { error } = await supabase.rpc('delete_member_entirely', {
        p_member_id: memberId
      });

      if (error) throw error;

      alert("Member and all associated data deleted successfully!");
      setAllMembers(prev => prev.filter(m => m.id !== memberId));
      setMetrics(prev => ({ ...prev, totalMembers: Math.max(0, prev.totalMembers - 1) }));
    } catch (err) {
      alert("Failed to delete member: " + err.message);
    }
  };

  const quickActionsCardsData = [
    {
      title: "Pending Approvals",
      color: "rgba(248, 113, 113, 0.25)",
      info: `${metrics.pendingApprovals} Requests`,
      icon: "fa-solid fa-clock",
      subInfo: "Requires Immediate Action",
    },
    {
      title: "Total SACCO Capital",
      color: "rgba(245, 158, 11, 0.25)",
      info: `Shs ${metrics.totalCapital.toLocaleString()}`,
      icon: "fa-solid fa-coins",
      subInfo: "Aggregate across all accounts",
    },
    {
      title: "Total Members",
      color: "rgba(16, 185, 129, 0.25)",
      info: `${metrics.totalMembers}`,
      icon: "fa-solid fa-users",
      subInfo: "Registered users in this SACCO",
    },
    {
      title: "Active Loans issued",
      color: "rgba(59, 130, 246, 0.25)",
      info: `Shs ${metrics.activeLoansTotal.toLocaleString()}`,
      icon: "fa-solid fa-hand-holding-dollar",
      subInfo: "Total outstanding balances",
    },
  ];

  return (
    <AdminLayout>
      <div className="dashboard-body">
        <Header />

        {currentTab === "overview" && (
          <>
            <div className="summary-cards">
              {quickActionsCardsData.map((card) => (
                <ActionCards
                  key={card.title}
                  title={card.title}
                  color={card.color}
                  icon={card.icon}
                  info={card.info}
                  subInfo={card.subInfo}
                />
              ))}
            </div>

            <div className="main-content-row">
              <div className="contribution-approvals-area">
                <ContributionApprovals limit={7} showViewAll={true} />
              </div>
              <div className="features-area">
                <QuickMemberManagement />
                <ManualContributionLog allMembers={allMembers} />
                <BroadcastMessageWidget />
              </div>
            </div>
          </>
        )}

        {currentTab === "verifications" && (
          <div style={{ marginTop: "2.5rem" }}>
            <ContributionApprovals />
          </div>
        )}

        {currentTab === "members" && (
          <div style={{ marginTop: "2.5rem" }}>
            <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-dark)", marginBottom: "2rem" }}>
              SACCO Members Directory
            </h2>
            <div className="members-grid" style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
              gap: "2.4rem",
              marginTop: "2rem" 
            }}>
              {allMembers.map((member) => (
                <div key={member.id} className="member-card" style={{
                  background: "var(--white)",
                  borderRadius: "1.6rem",
                  padding: "2.4rem",
                  boxShadow: "var(--card-shadow)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2rem",
                  position: "relative",
                  border: "0.1rem solid rgba(226, 232, 240, 0.8)"
                }}>
                  <div className="member-card-header" style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={`${member.name} Avatar`}
                        style={{
                          width: "5.5rem",
                          height: "5.5rem",
                          borderRadius: "50%",
                          objectFit: "cover",
                          boxShadow: "0 0.4rem 1rem rgba(0, 0, 0, 0.1)",
                          border: "0.2rem solid var(--primary-color)"
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          if (e.currentTarget.nextSibling) {
                            e.currentTarget.nextSibling.style.display = "flex";
                          }
                        }}
                      />
                    ) : null}
                    {(!member.avatarUrl) && (
                      <div className="member-avatar-initials" style={{
                        width: "5.5rem",
                        height: "5.5rem",
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, var(--primary-color) 0%, #3b82f6 100%)",
                        color: "white",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "2rem",
                        fontWeight: 700,
                        boxShadow: "0 0.4rem 1rem rgba(59, 130, 246, 0.15)"
                      }}>
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h3 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-dark)", margin: 0 }}>
                        {member.name}
                      </h3>
                      <p style={{ fontSize: "1.2rem", color: "var(--text-light)", margin: "0.2rem 0 0 0" }}>
                        ID: {member.memberId}
                      </p>
                    </div>
                  </div>

                  <div className="member-card-details" style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.2rem",
                    borderTop: "0.1rem solid #f1f5f9",
                    paddingTop: "1.5rem"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>Phone</span>
                      <span style={{ fontSize: "1.3rem", color: "var(--text-dark)", fontWeight: 600 }}>{member.phone}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>Email</span>
                      <span style={{ fontSize: "1.3rem", color: "var(--text-dark)", fontWeight: 600, maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {member.email}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>Joined</span>
                      <span style={{ fontSize: "1.3rem", color: "var(--text-dark)", fontWeight: 600 }}>{member.joinedDate}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>Role</span>
                      <span style={{ 
                        fontSize: "1.1rem", 
                        fontWeight: 700, 
                        textTransform: "uppercase",
                        padding: "0.4rem 0.8rem",
                        borderRadius: "0.6rem",
                        background: member.role === "admin" ? "#fef2f2" : "#f0fdf4",
                        color: member.role === "admin" ? "#ef4444" : "#22c55e"
                      }}>{member.role}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>Status</span>
                      <span style={{ 
                        fontSize: "1.1rem", 
                        fontWeight: 700, 
                        textTransform: "uppercase",
                        padding: "0.4rem 0.8rem",
                        borderRadius: "0.6rem",
                        background: member.status === "active" ? "#f0fdf4" : "#fef3c7",
                        color: member.status === "active" ? "#22c55e" : "#d97706"
                      }}>{member.status}</span>
                    </div>
                    <div className="member-card-actions" style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderTop: "0.1rem solid #e2e8f0",
                      paddingTop: "1.2rem",
                      marginTop: "0.5rem"
                    }}>
                      {member.status === "pending" ? (
                        <button
                          onClick={() => handleApproveMember(member.id)}
                          style={{
                            background: "var(--primary-color)",
                            border: "none",
                            color: "white",
                            fontSize: "1.2rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.6rem 1.2rem",
                            borderRadius: "0.6rem"
                          }}
                        >
                          <i className="fa-solid fa-user-check"></i> Approve
                        </button>
                      ) : member.role !== "admin" ? (
                        <button
                          onClick={() => handleMakeAdmin(member.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--primary-color)",
                            fontSize: "1.2rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.4rem 0"
                          }}
                        >
                          <i className="fa-solid fa-user-shield"></i> Make Admin
                        </button>
                      ) : (
                        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }}>Sacco Admin</span>
                      )}
                      
                      <button
                        onClick={() => handleDeleteMember(member.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          fontSize: "1.4rem",
                          cursor: "pointer",
                          padding: "0.4rem",
                          borderRadius: "0.4rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "background 0.2s"
                        }}
                        title="Delete Member"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentTab === "payments" && (
          <div style={{ marginTop: "2.5rem" }}>
            <PaymentPlans />
          </div>
        )}

        {currentTab === "settings" && (
          <div style={{ marginTop: "2.5rem" }}>
            <SaccoSettings />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
