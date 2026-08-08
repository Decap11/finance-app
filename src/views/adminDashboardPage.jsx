import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../supabaseClient";
import { subscribeToOwnSaccoRows } from "../utils/realtimeScope";
import Header from "../Components/Header";
import ActionCards from "../Components/ActionCard";
import ContributionApprovals from "../Components/ContributionApprovals";
import WeeklyAttendanceManager from "../Components/WeeklyAttendanceManager";
import MemberFinesManager from "../Components/MemberFinesManager";
import MemberDuesCard from "../Components/MemberDuesCard";
import MemberJoinDate from "../Components/MemberJoinDate";
import LoanApplicationsManager from "../Components/LoanApplicationsManager";
import ManualContributionLog from "../Components/manualContributionlog";
import BroadcastMessageWidget from "../Components/BroadcastMessageWidget";
import AdminLayout from "../layout/AdminLayout";
import PaymentPlans from "../Components/Payments";
import SaccoSettings from "../Components/saccoSettings";
import DividendDistributionPortal from "../Components/DividendDistributionPortal";
import AdminActionModal from "../Components/AdminActionModal";
import { formatSignedShs } from "../utils/saccoCapital";
import {
  realisedIncomeOf,
  totalProjectedInterestOf,
  grossProfitOf,
  INTEREST_EARNING_LOAN_STATUSES,
  REALISED_TRANSACTION_STATUSES
} from "../utils/saccoProfit";

export default function AdminDashboardPage() {
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";

  const [allMembers, setAllMembers] = useState([]);
  const [viewerCanDemote, setViewerCanDemote] = useState(false);
  // Bumped to re-read the member list after something changes it from outside the realtime
  // channel -- a saved join date, for one, which the profiles subscription only catches when
  // the table is in the supabase_realtime publication.
  const [membersRefreshKey, setMembersRefreshKey] = useState(0);
  const [joinDatesBusy, setJoinDatesBusy] = useState(false);
  const [joinDatesMessage, setJoinDatesMessage] = useState(null);
  // Single dialog reused by every member-card action; null when nothing is open.
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [metrics, setMetrics] = useState({
    pendingApprovals: 0,
    totalCapital: 0,
    outOnLoan: 0,
    totalMembers: 0,
    activeLoansTotal: 0,
    finesProfit: 0,
    feesProfit: 0,
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
            // When the member joined the SACCO in real life, as stated by an admin (0031).
            // NULL until somebody says, and the card renders it as an editable field rather
            // than a label -- this date is what every arrears figure for them is counted
            // from. profiles.created_at is deliberately NOT used as a fallback here: it is
            // when the ACCOUNT was made, which for a SACCO that backfilled a year of paper
            // records is the day the admin typed everyone in, and showing that as a join date
            // is what made the field worth adding.
            joinedOn: p.joined_on || null,
            role: roleVal,
            status: statusVal,
            avatarUrl: p.avatar_url,
            created_at: p.created_at,
            // set_member_approval and delete_member_entirely both reject self-targeting,
            // so the card hides those two actions rather than offering a certain failure.
            isCurrentUser: String(p.id) === String(user.id),
            // saccos.admin_profile_id. 0018 makes unapprove, delete and demote all refuse
            // this account, so its card offers none of the three.
          };
        });
        mappedMembers.sort((a, b) =>
          String(a.memberId || "").localeCompare(String(b.memberId || ""), undefined, { numeric: true, sensitivity: "base" })
        );
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
        .eq("status", "pending")
        // Unpaid fines and loan application fees are pending too, but neither is a
        // contribution to verify and the table below lists neither, so counting them here
        // would put the card back out of step with what it sits above.
        .not("category", "in", '("fines","fee")');

      if (pendingError) {
        // Leave the previous number in place rather than flashing 0, which reads as
        // "nothing to do" and is the one wrong answer for this card.
        console.error("Could not count pending approvals:", pendingError);
      }

      // 2. Fetch the SACCO's capital position.
      //
      // This used to sum every row get_sacco_total_balances returned, which had two
      // faults. It counted savings -- members' own money, held on their behalf and not
      // the SACCO's to lend -- so this card disagreed with the Pools & Funds ring, which
      // has never counted them. And it counted no loan movement at all, so the figure did
      // not budge when the SACCO handed money to a borrower.
      //
      // get_sacco_capital_position answers both: contributions and fines, plus repayments
      // received, minus principal disbursed. The same number the ring now shows.
      const { data: { session } } = await supabase.auth.getSession();
      let calculatedCapital = 0;
      let calculatedOutOnLoan = 0;
      if (session) {
        const { data: position, error: positionErr } = await supabase.rpc(
          'get_sacco_capital_position', { p_profile_id: session.user.id }
        );

        if (positionErr) {
          // A database without migration 0034. Fall back to the old sum rather than
          // showing a confident zero, which on this card reads as "the SACCO is broke".
          console.warn('Capital position unavailable (is migration 0034 applied?):', positionErr.message);
          const { data: totalBalances } = await supabase.rpc('get_sacco_total_balances', { p_profile_id: session.user.id });
          if (totalBalances) {
            calculatedCapital = totalBalances.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
          }
        } else if (position?.length) {
          calculatedCapital = Number(position[0].on_hand) || 0;
          calculatedOutOnLoan = Number(position[0].out_on_loan) || 0;
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

      // 4. Fetch what the SACCO has earned, by source.
      //
      // Fines and loan application fees in one query -- both are realised income sitting in
      // the ledger as completed rows, and splitting them is a filter, not a round trip.
      // 'fine', 'penalty' and 'absenteeism' are gone from the category list: 0021 migrated
      // 'fine' to 'fines' and the CHECK constraint has never permitted the other two, so
      // they could only ever match nothing.
      const { data: incomeTxs } = await supabase
        .from("transactions")
        .select("amount, direction, category")
        .eq("sacco_id", saccoId)
        .in("category", ["fines", "fee"])
        .in("status", REALISED_TRANSACTION_STATUSES);

      const calculatedFinesProfit = realisedIncomeOf(
        (incomeTxs || []).filter((tx) => tx.category === "fines")
      );
      // Loan application fees. Confirmed by an admin, credited to no member account and,
      // until now, counted by nothing: the fee is SACCO income and this card is where the
      // SACCO's income is read.
      const calculatedFeesProfit = realisedIncomeOf(
        (incomeTxs || []).filter((tx) => tx.category === "fee")
      );

      // 5. Fetch Loan Interest Yield -- projected over each loan's full term, not received.
      //
      // Selected `amount` until now, which is not a column on this table. PostgREST rejects
      // the whole query when a column does not exist, so `allLoans` came back null and this
      // figure was a permanent zero. Same mistake, same fix as MemberGuarantorRequests.
      const { data: allLoans } = await supabase
        .from("loans")
        .select("amount_requested, amount_approved, interest_rate, term_months")
        .eq("sacco_id", saccoId)
        .in("status", INTEREST_EARNING_LOAN_STATUSES);

      const calculatedInterestProfit = totalProjectedInterestOf(allLoans);

      const calculatedGrossProfit = grossProfitOf({
        fines: calculatedFinesProfit,
        applicationFees: calculatedFeesProfit,
        loanInterest: calculatedInterestProfit
      });

      setMetrics((prev) => ({
        ...prev,
        pendingApprovals: pendingError ? prev.pendingApprovals : (pendingCount || 0),
        totalCapital: calculatedCapital,
        outOnLoan: calculatedOutOnLoan,
        activeLoansTotal: calculatedLoans,
        finesProfit: calculatedFinesProfit,
        feesProfit: calculatedFeesProfit,
        interestProfit: calculatedInterestProfit,
        grossProfit: calculatedGrossProfit
      }));
    }

    fetchAdminData();

    // Subscribe to transactions, loans, and profiles changes to update metrics and member list in real-time
    // The money tables, scoped to this SACCO.
    const unsubscribeMoney = subscribeToOwnSaccoRows(
      ['transactions', 'loans'],
      () => loadMetrics(),
      'admin-dashboard-metrics'
    );

    // profiles is left unfiltered on purpose: it carries `group_id` (a group CODE), not
    // `sacco_id`, so it cannot use the same filter as the two above. It is also the least
    // costly one to leave open -- members are added rarely, where contributions are written
    // all meeting long. Scoping it properly belongs with the SaccoContext work that
    // replaces group_id lookups generally.
    const channel = supabase
      .channel('admin-dashboard-realtime-profiles')
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
      unsubscribeMoney();
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_avatar_updated", handleAvatarBroadcast);
        window.removeEventListener("sacco_transaction_updated", handleTransactionBroadcast);
        window.removeEventListener("manual_contribution_logged", handleTransactionBroadcast);
        window.removeEventListener("focus", handleTabRefocus);
        document.removeEventListener("visibilitychange", handleTabRefocus);
      }
    };
  }, [membersRefreshKey]);

  const refreshMembers = () => setMembersRefreshKey((k) => k + 1);

  /**
   * "All members joined at Week 1" -- the one action that makes stating join dates practical.
   *
   * No admin types thirty dates, so without this the field stays empty and the dues engine
   * keeps inferring each member's start from their earliest record -- which silently forgives
   * anyone who was present from the start but paid nothing for their first several weeks.
   *
   * Fills BLANKS ONLY, so pressing it again after correcting a genuine late joiner does not
   * undo that correction. That is what makes it safe to re-click.
   */
  async function handleSetAllJoinDates() {
    const ok = typeof window === "undefined" || window.confirm(
      "Set every member who has no join date to the SACCO's Week 1?\n\n" +
      "Use this when the whole group started together. Members whose date you have already " +
      "set are left alone, and you can correct any individual afterwards."
    );
    if (!ok) return;

    setJoinDatesBusy(true);
    setJoinDatesMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/admin/join-dates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ scope: "all" })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not set join dates.");

      const when = data.joined_on
        ? new Date(data.joined_on).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
        : "Week 1";

      setJoinDatesMessage({
        type: "success",
        text: data.members_set > 0
          ? `${data.members_set} member(s) set to ${when}. Their dues now count from that date.`
          : "Every member already has a join date. Nothing was changed."
      });

      refreshMembers();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
    } catch (err) {
      setJoinDatesMessage({ type: "error", text: err.message });
    } finally {
      setJoinDatesBusy(false);
    }
  }

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
      // Renamed from "Total SACCO Capital". The figure now falls when a loan is approved
      // and rises as it is repaid, so "total" was the wrong word for it -- an admin
      // reading a smaller number under that heading would reasonably think money had
      // gone missing rather than gone out on loan. The sub-line names where it went.
      title: "Capital On Hand",
      borderColor: metrics.totalCapital < 0 ? "#ef4444" : "#f59e0b",
      bgColor: metrics.totalCapital < 0 ? "#fef2f2" : "#fffbe6",
      iconColor: metrics.totalCapital < 0 ? "#ef4444" : "#d97706",
      info: formatSignedShs(metrics.totalCapital),
      icon: "fa-solid fa-vault",
      subInfo: metrics.outOnLoan > 0
        ? `Shs ${metrics.outOnLoan.toLocaleString()} is out on loan`
        : "Available to lend right now",
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

                {/* Categorized Sources Breakdown.
                    "Fines & Penalties", not "Absenteeism Fines": this line has always summed
                    every fine category, late loan charges included, so naming one fine_type
                    understated what the reader was actually looking at. */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem", fontSize: "1.2rem", color: "#64748b" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><i className="fa-solid fa-user-xmark" style={{ color: "#ef4444", marginRight: "0.4rem" }}></i> Fines &amp; Penalties:</span>
                    <strong style={{ color: "#ef4444" }}>Shs {metrics.finesProfit.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><i className="fa-solid fa-file-invoice-dollar" style={{ color: "#d97706", marginRight: "0.4rem" }}></i> Loan Application Fees:</span>
                    <strong style={{ color: "#d97706" }}>Shs {metrics.feesProfit.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      <i className="fa-solid fa-percent" style={{ color: "#253b8e", marginRight: "0.4rem" }}></i> Loan Interest Yield:
                      {/* The one source on this card that has not been collected yet. Fines
                          and fees are ledger rows; this is what the current book will yield
                          if every loan runs its term and is repaid in full. */}
                      <span style={{ fontSize: "1rem", fontStyle: "italic", marginLeft: "0.4rem", color: "#94a3b8" }}>projected</span>
                    </span>
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

              {/* What members still owe in weekly mandatory funds. Fetches its own data
                  rather than joining loadMetrics: the figures are derived per member from the
                  whole ledger, which is a different shape of query from every other metric
                  here. Expands in place to name who is behind. */}
              <MemberDuesCard />
            </div>

            <div className="main-content-row">
              <div className="contribution-approvals-area">
                <ContributionApprovals limit={7} showViewAll={true} mode="pending" />
              </div>
              <div className="features-area">
                <WeeklyAttendanceManager allMembers={allMembers} />
                <LoanApplicationsManager />
                <MemberFinesManager allMembers={allMembers} />
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
            <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-dark)", marginBottom: "1.2rem" }}>
              SACCO Members Directory
            </h2>

            {/* Join dates decide what every member is shown as owing in weekly development
                and social fund. Explained here rather than left as a bare button, because
                pressing it asserts something about the whole group. */}
            <div style={{
              background: "#f8fafc",
              border: "0.1rem solid #e2e8f0",
              borderRadius: "1rem",
              padding: "1.4rem 1.6rem",
              marginBottom: "2rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1.6rem",
              flexWrap: "wrap"
            }}>
              <div style={{ fontSize: "1.25rem", color: "#475569", lineHeight: 1.5, maxWidth: "60rem" }}>
                <strong style={{ color: "var(--text-dark)" }}>Join dates</strong> decide the week each
                member starts owing development and social fund. Where none is set, it is inferred
                from their first record — which cannot tell a late joiner from someone who was here
                all along and simply did not pay.
                <span style={{ display: "block", marginTop: "0.3rem", color: "#64748b" }}>
                  If your group started together, set them all at once. Members you have already
                  dated are left untouched.
                </span>
              </div>

              <button
                type="button"
                onClick={handleSetAllJoinDates}
                disabled={joinDatesBusy}
                style={{
                  background: "var(--primary-color)",
                  border: "none",
                  color: "white",
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  padding: "0.9rem 1.6rem",
                  borderRadius: "0.8rem",
                  cursor: joinDatesBusy ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap"
                }}
              >
                <i className="fa-solid fa-calendar-check" style={{ marginRight: "0.6rem" }}></i>
                {joinDatesBusy ? "Setting…" : "All members joined at Week 1"}
              </button>
            </div>

            {joinDatesMessage && (
              <div style={{
                padding: "1rem 1.4rem",
                borderRadius: "0.8rem",
                marginBottom: "2rem",
                fontSize: "1.25rem",
                fontWeight: 600,
                background: joinDatesMessage.type === "error" ? "#fef2f2" : "#f0fdf4",
                color: joinDatesMessage.type === "error" ? "#b91c1c" : "#15803d",
                border: `0.1rem solid ${joinDatesMessage.type === "error" ? "#fecaca" : "#bbf7d0"}`
              }}>
                {joinDatesMessage.text}
              </div>
            )}
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
                    {/* Editable, because this date is what every arrears figure for this
                        member is counted from -- see MemberJoinDate. */}
                    <MemberJoinDate member={member} onSaved={refreshMembers} />
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
