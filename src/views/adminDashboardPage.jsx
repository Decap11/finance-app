import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../supabaseClient";
import Header from "../Components/Header";
import ActionCards from "../Components/ActionCard";
import ContributionApprovals from "../Components/ContributionApprovals";
import WeeklyAttendanceManager from "../Components/WeeklyAttendanceManager";
import ManualContributionLog from "../Components/manualContributionlog";
import BroadcastMessageWidget from "../Components/BroadcastMessageWidget";
import AdminLayout from "../layout/AdminLayout";
import PaymentPlans from "../Components/Payments";
import SaccoSettings from "../Components/saccoSettings";
import DividendDistributionPortal from "../Components/DividendDistributionPortal";
import AdminActionModal from "../Components/AdminActionModal";

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";

  const [allMembers, setAllMembers] = useState([]);
  const [viewerCanDemote, setViewerCanDemote] = useState(false);
  // Single dialog reused by every member-card action; null when nothing is open.
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [metrics, setMetrics] = useState({
    pendingApprovals: 0,
    totalCapital: 0,
    totalMembers: 0,
    activeLoansTotal: 0,
    finesProfit: 0,
    interestProfit: 0,
    grossProfit: 0
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
        .select("id, admin_profile_id")
        .ilike("group_code", (profileData.group_id || "").trim())
        .limit(1);

      let ownerId = null;
      if (saccoData && saccoData.length > 0) {
        saccoId = saccoData[0].id;
        ownerId = saccoData[0].admin_profile_id || null;
      }

      // Only the SACCO owner may demote another admin (demote_sacco_admin). When
      // admin_profile_id is NULL -- deleting the owner clears it, and pre-0009 SACCOs
      // never set it -- the RPC falls back to allowing any admin, so mirror that here or
      // the button would be hidden from someone the database would in fact accept.
      setViewerCanDemote(!ownerId || String(ownerId) === String(user.id));

      // 3. Fetch all members belonging to this sacco
      const { data: profilesList } = await supabase
        .from("profiles")
        .select("*")
        .ilike("group_id", (profileData.group_id || "").trim())
        .order("full_name", { ascending: true });

      let membershipsMap = {};
      if (saccoId) {
        const { data: mems } = await supabase
          .from("sacco_memberships")
          .select("profile_id, status, role")
          .eq("sacco_id", saccoId);
        
        if (mems) {
          mems.forEach(m => {
            membershipsMap[m.profile_id] = m;
          });
        }
      }

      if (profilesList) {
        const mappedMembers = profilesList.map((p) => {
          const mem = membershipsMap[p.id];
          let rawStatus = mem?.status || p.status || "pending";
          let statusVal = String(rawStatus).trim().toLowerCase();
          if (statusVal === "approved") statusVal = "active";
          
          let roleVal = (mem?.role || p.role || "member").toLowerCase();

          return {
            id: p.id,
            name: p.full_name || p.email || "Member",
            memberId: p.member_number || "MEM-000",
            phone: p.phone || "N/A",
            email: p.email || "N/A",
            joinedDate: p.created_at ? new Date(p.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "N/A",
            role: roleVal,
            status: statusVal,
            avatarUrl: p.avatar_url,
            created_at: p.created_at,
            // set_member_approval and delete_member_entirely both reject self-targeting,
            // so the card hides those two actions rather than offering a certain failure.
            isCurrentUser: String(p.id) === String(user.id),
            // saccos.admin_profile_id. 0018 makes unapprove, delete and demote all refuse
            // this account, so its card offers none of the three.
            isSaccoOwner: !!ownerId && String(p.id) === String(ownerId)
          };
        });
        setAllMembers(mappedMembers);

        setMetrics((prev) => ({ ...prev, totalMembers: profilesList.length }));
      }

      // Fetch metrics
      loadMetrics();
    }

    async function loadMetrics() {
      if (!saccoId) return;

      // 1. Requests waiting for admin action. 'pending' is exactly the set the
      // Contribution Approvals table offers Approve/Reject on -- approve_member_transaction
      // moves the row to 'completed' and reject_member_transaction to 'rejected', so both
      // drop out of this count the moment the admin acts on them.
      const { count: pendingCount, error: pendingError } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("sacco_id", saccoId)
        .eq("status", "pending");

      if (pendingError) {
        // Leave the previous number in place rather than flashing 0, which reads as
        // "nothing to do" and is the one wrong answer for this card.
        console.error("Could not count pending approvals:", pendingError);
      }

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

      // 4. Fetch Fines & Penalties Revenue
      const { data: finesTxs } = await supabase
        .from("transactions")
        .select("amount, direction")
        .eq("sacco_id", saccoId)
        .in("category", ["fines", "fine", "penalty", "absenteeism"])
        .in("status", ["completed", "approved"]);

      let calculatedFinesProfit = 0;
      if (finesTxs && finesTxs.length > 0) {
        calculatedFinesProfit = finesTxs.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
      }

      // 5. Fetch Loan Interest Yield
      const { data: allLoans } = await supabase
        .from("loans")
        .select("amount, interest_rate, term_months")
        .eq("sacco_id", saccoId)
        .in("status", ["issued", "active", "completed", "repaid"]);

      let calculatedInterestProfit = 0;
      if (allLoans && allLoans.length > 0) {
        calculatedInterestProfit = allLoans.reduce((sum, loan) => {
          const principal = Number(loan.amount) || 0;
          const rate = Number(loan.interest_rate) || 5;
          const months = Number(loan.term_months) || 1;
          return sum + (principal * (rate / 100) * months);
        }, 0);
      }

      const calculatedGrossProfit = calculatedFinesProfit + calculatedInterestProfit;

      setMetrics((prev) => ({
        ...prev,
        pendingApprovals: pendingError ? prev.pendingApprovals : (pendingCount || 0),
        totalCapital: calculatedCapital,
        activeLoansTotal: calculatedLoans,
        finesProfit: calculatedFinesProfit,
        interestProfit: calculatedInterestProfit,
        grossProfit: calculatedGrossProfit
      }));
    }

    fetchAdminData();

    // Subscribe to transactions, loans, and profiles changes to update metrics and member list in real-time
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles'
        },
        () => {
          fetchAdminData();
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

    const handleTransactionBroadcast = () => {
      loadMetrics();
    };

    // A member files a contribution from their own browser session, so nothing in this tab
    // hears about it directly. The realtime channel above covers it only when the table is
    // in the supabase_realtime publication (migration 0020) -- re-counting whenever the
    // admin comes back to the tab is the fallback that holds regardless.
    const handleTabRefocus = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadMetrics();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_avatar_updated", handleAvatarBroadcast);
      window.addEventListener("sacco_transaction_updated", handleTransactionBroadcast);
      window.addEventListener("manual_contribution_logged", handleTransactionBroadcast);
      window.addEventListener("focus", handleTabRefocus);
      document.addEventListener("visibilitychange", handleTabRefocus);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_avatar_updated", handleAvatarBroadcast);
        window.removeEventListener("sacco_transaction_updated", handleTransactionBroadcast);
        window.removeEventListener("manual_contribution_logged", handleTransactionBroadcast);
        window.removeEventListener("focus", handleTabRefocus);
        document.removeEventListener("visibilitychange", handleTabRefocus);
      }
    };
  }, []);

  // ---- Member card actions ------------------------------------------------------------
  // Each one opens a confirm dialog, and confirming replaces that dialog's contents with
  // the outcome rather than closing it, so success and failure land in the same place the
  // user is already looking. All five previously used window.confirm + alert.

  const closeModal = () => {
    if (!modalBusy) setModal(null);
  };

  // Shared tail: run the RPC, apply the optimistic list update on success, and report
  // either way. Postgres raises the authorization and safety rules in these functions as
  // exceptions, so err.message is already the sentence to show ("You cannot demote
  // yourself", "This SACCO would be left with no admin", and so on).
  const runMemberAction = async ({ rpc, params, tone, icon, title, message, failTitle, onSuccess }) => {
    setModalBusy(true);
    try {
      const { error } = await supabase.rpc(rpc, params);
      if (error) throw error;

      onSuccess?.();
      setModal({ kind: "result", tone: tone || "success", icon: icon || "fa-circle-check", title, message });
    } catch (err) {
      setModal({
        kind: "result",
        tone: "danger",
        icon: "fa-circle-exclamation",
        title: failTitle,
        message: err.message
      });
    } finally {
      setModalBusy(false);
    }
  };

  const handleMakeAdmin = (member) => {
    setModal({
      kind: "confirm",
      tone: "primary",
      icon: "fa-user-shield",
      title: "Grant admin privileges?",
      confirmLabel: "Make admin",
      message: (
        <>
          <strong>{member.name}</strong> will get the admin dashboard: approving
          contributions and loans, managing members, and running dividend payouts. You can
          reverse this later from this card.
        </>
      ),
      onConfirm: () => runMemberAction({
        rpc: "make_member_admin",
        params: { p_member_id: member.id },
        title: "Promoted to admin",
        message: `${member.name} now has admin access to this SACCO.`,
        failTitle: "Could not promote member",
        onSuccess: () => setAllMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: 'admin', status: 'active' } : m))
      })
    });
  };

  const handleDemoteAdmin = (member) => {
    setModal({
      kind: "confirm",
      tone: "warning",
      icon: "fa-user-minus",
      title: "Remove admin privileges?",
      confirmLabel: "Remove privileges",
      message: (
        <>
          <strong>{member.name}</strong> stays in the SACCO as a regular member. Their
          savings, contributions and loan history are untouched — only the admin dashboard
          is withdrawn.
        </>
      ),
      onConfirm: () => runMemberAction({
        rpc: "demote_sacco_admin",
        params: { p_member_id: member.id },
        title: "Admin privileges removed",
        message: `${member.name} is now a regular member of the SACCO.`,
        failTitle: "Could not demote admin",
        onSuccess: () => setAllMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: 'member' } : m))
      })
    });
  };

  const handleApproveMember = (member) => {
    setModal({
      kind: "confirm",
      tone: "primary",
      icon: "fa-user-check",
      title: "Approve this member?",
      confirmLabel: "Approve member",
      message: (
        <>
          <strong>{member.name}</strong> will be able to sign in and use the member
          dashboard — recording contributions, requesting loans and viewing their savings.
        </>
      ),
      onConfirm: () => runMemberAction({
        rpc: "set_member_approval",
        params: { p_member_id: member.id, p_approve: true },
        title: "Member approved",
        message: `${member.name} now has full access to the SACCO dashboard.`,
        failTitle: "Could not approve member",
        onSuccess: () => setAllMembers(prev => prev.map(m => m.id === member.id ? { ...m, status: 'active' } : m))
      })
    });
  };

  const handleUnapproveMember = (member) => {
    setModal({
      kind: "confirm",
      tone: "danger",
      icon: "fa-user-lock",
      title: "Revoke dashboard access?",
      confirmLabel: "Revoke access",
      message: (
        <>
          <strong>{member.name}</strong> will be locked out of the dashboard immediately,
          even if they are signed in right now. Their savings, contributions and loan
          records are kept and access can be restored by approving them again.
        </>
      ),
      onConfirm: () => runMemberAction({
        rpc: "set_member_approval",
        params: { p_member_id: member.id, p_approve: false },
        tone: "warning",
        icon: "fa-user-lock",
        title: "Access revoked",
        message: `${member.name} is back to pending and can no longer open the dashboard.`,
        failTitle: "Could not revoke access",
        onSuccess: () => setAllMembers(prev => prev.map(m => m.id === member.id ? { ...m, status: 'pending' } : m))
      })
    });
  };

  const handleDeleteMember = (member) => {
    setModal({
      kind: "confirm",
      tone: "danger",
      icon: "fa-triangle-exclamation",
      title: "Delete this member permanently?",
      confirmLabel: "Delete permanently",
      message: (
        <>
          This erases <strong>{member.name}</strong>&apos;s account along with their
          contributions, loans and balances. Records belonging to other members that they
          approved are kept. <strong>This cannot be undone.</strong>
        </>
      ),
      onConfirm: () => runMemberAction({
        rpc: "delete_member_entirely",
        params: { p_member_id: member.id },
        title: "Member deleted",
        message: `${member.name} and all of their SACCO data have been removed.`,
        failTitle: "Could not delete member",
        onSuccess: () => {
          setAllMembers(prev => prev.filter(m => m.id !== member.id));
          setMetrics(prev => ({ ...prev, totalMembers: Math.max(0, prev.totalMembers - 1) }));
        }
      })
    });
  };

  // The card is red only while there is something to act on. At zero it would otherwise
  // read "0 Requests / Requires Immediate Action", which contradicts itself.
  const waiting = metrics.pendingApprovals;
  const hasWaiting = waiting > 0;

  const quickActionsCardsData = [
    {
      title: "Pending Approvals",
      borderColor: hasWaiting ? "#ef4444" : "#10b981",
      bgColor: hasWaiting ? "#fef2f2" : "#f0fdf4",
      iconColor: hasWaiting ? "#ef4444" : "#10b981",
      info: `${waiting} ${waiting === 1 ? "Request" : "Requests"}`,
      icon: "fa-solid fa-file-signature",
      subInfo: hasWaiting ? "Waiting for your approval" : "All caught up — nothing waiting",
    },
    {
      title: "Total SACCO Capital",
      borderColor: "#f59e0b",
      bgColor: "#fffbe6",
      iconColor: "#d97706",
      info: `Shs ${metrics.totalCapital.toLocaleString()}`,
      icon: "fa-solid fa-vault",
      subInfo: "Aggregate across all accounts",
    },
    {
      title: "Total Members",
      borderColor: "#10b981",
      bgColor: "#f0fdf4",
      iconColor: "#10b981",
      info: `${metrics.totalMembers}`,
      icon: "fa-solid fa-users-rectangle",
      subInfo: "Registered users in this SACCO",
    },
    {
      title: "Active Loans Issued",
      borderColor: "#2563eb",
      bgColor: "#eff6ff",
      iconColor: "#2563eb",
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
                  borderColor={card.borderColor}
                  bgColor={card.bgColor}
                  iconColor={card.iconColor}
                  icon={card.icon}
                  info={card.info}
                  subInfo={card.subInfo}
                />
              ))}

              {/* Gross SACCO Profit Card with Source Breakdown & Emphasized Total */}
              <div className="card card-gross-profit" style={{ borderLeft: "4px solid #10b981", background: "white", display: "flex", flexDirection: "column" }}>
                <div className="card-header" style={{ marginBottom: "0.8rem" }}>
                  <span className="card-title" style={{ fontWeight: 700, color: "var(--text-dark)", fontSize: "1.5rem" }}>Gross SACCO Profit</span>
                  <div className="card-icon" style={{ backgroundColor: "rgba(16, 185, 129, 0.15)", color: "#10b981", width: "4rem", height: "4rem", borderRadius: "1rem" }}>
                    <i className="fa-solid fa-chart-line" style={{ fontSize: "1.8rem" }}></i>
                  </div>
                </div>

                {/* Categorized Sources Breakdown */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem", fontSize: "1.2rem", color: "#64748b" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><i className="fa-solid fa-user-xmark" style={{ color: "#ef4444", marginRight: "0.4rem" }}></i> Absenteeism Fines:</span>
                    <strong style={{ color: "#ef4444" }}>Shs {metrics.finesProfit.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><i className="fa-solid fa-percent" style={{ color: "#253b8e", marginRight: "0.4rem" }}></i> Loan Interest Yield:</span>
                    <strong style={{ color: "#253b8e" }}>Shs {metrics.interestProfit.toLocaleString()}</strong>
                  </div>
                </div>

                {/* Aggregated Total with Maximum Emphasis */}
                <div style={{ marginTop: "auto", paddingTop: "0.8rem", borderTop: "1px dashed #e2e8f0" }}>
                  <span style={{ fontSize: "1.1rem", textTransform: "uppercase", letterSpacing: "0.05rem", fontWeight: 800, color: "#10b981" }}>Total Gross Revenue</span>
                  <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#065f46", letterSpacing: "-0.05rem", marginTop: "0.1rem" }}>
                    Shs {metrics.grossProfit.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            <div className="main-content-row">
              <div className="contribution-approvals-area">
                <ContributionApprovals limit={7} showViewAll={true} mode="pending" />
              </div>
              <div className="features-area">
                <WeeklyAttendanceManager allMembers={allMembers} />
                <ManualContributionLog allMembers={allMembers} />
                <BroadcastMessageWidget />
              </div>
            </div>
          </>
        )}

        {currentTab === "verifications" && (
          <div style={{ marginTop: "2.5rem" }}>
            <ContributionApprovals mode="verifications" />
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
                          onClick={() => handleApproveMember(member)}
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
                      ) : member.isCurrentUser ? (
                        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }}>You</span>
                      ) : member.isSaccoOwner ? (
                        /* 0018 makes set_member_approval refuse to revoke the owner. */
                        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }}>Protected</span>
                      ) : (
                        <button
                          onClick={() => handleUnapproveMember(member)}
                          style={{
                            background: "#fee2e2",
                            border: "none",
                            color: "#ef4444",
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
                          <i className="fa-solid fa-user-minus"></i> Unapprove
                        </button>
                      )}

                      {/* Role slot. Promotion is open to any admin; demotion is not --
                          demote_sacco_admin only accepts the SACCO owner, refuses a
                          self-demote and refuses to remove the last admin. Each label
                          below is the case where the RPC would certainly reject. */}
                      {member.role !== "admin" ? (
                        <button
                          onClick={() => handleMakeAdmin(member)}
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
                      ) : member.isSaccoOwner ? (
                        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }} title="The account that created this SACCO">
                          <i className="fa-solid fa-crown" style={{ color: "#f59e0b", marginRight: "0.5rem" }}></i>
                          Main Admin
                        </span>
                      ) : viewerCanDemote && !member.isCurrentUser ? (
                        <button
                          onClick={() => handleDemoteAdmin(member)}
                          title="Remove admin privileges"
                          style={{
                            background: "none",
                            border: "none",
                            color: "#d97706",
                            fontSize: "1.2rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.4rem 0"
                          }}
                        >
                          <i className="fa-solid fa-user-minus"></i> Demote
                        </button>
                      ) : (
                        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }}>Sacco Admin</span>
                      )}
                      
                      {/* 0018 makes delete_member_entirely refuse the owner too. */}
                      {!member.isCurrentUser && !member.isSaccoOwner && (
                        <button
                          onClick={() => handleDeleteMember(member)}
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
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentTab === "dividends" && (
          <div style={{ marginTop: "2.5rem" }}>
            <DividendDistributionPortal />
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

      {/* Outside .dashboard-body so the fixed overlay is not clipped by the sidebar
          layout's overflow handling on narrow screens. */}
      <AdminActionModal modal={modal} busy={modalBusy} onClose={closeModal} />
    </AdminLayout>
  );
}
