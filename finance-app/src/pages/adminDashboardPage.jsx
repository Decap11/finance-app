import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import Header from "../Components/Header.jsx";
import ActionCards from "../Components/ActionCard.jsx";
import ContributionApprovals from "../Components/ContributionApprovals.jsx";
import QuickMemberManagement from "../Components/QuickMemberManagement.jsx";
import ManualContributionLog from "../Components/manualContributionlog.jsx";
import BroadcastMessageWidget from "../Components/BroadcastMessageWidget.jsx";
import AdminLayout from "../layout/AdminLayout.jsx";

export default function AdminDashboardPage() {
  const [allMembers, setAllMembers] = useState([]);
  const [metrics, setMetrics] = useState({
    pendingApprovals: 0,
    totalCapital: 0,
    totalMembers: 0,
    activeLoansTotal: 0,
  });

  useEffect(() => {
    async function fetchAdminData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch the admin's SACCO ID
      const { data: membershipData } = await supabase
        .from("sacco_memberships")
        .select("sacco_id")
        .eq("profile_id", user.id)
        .eq("role", "admin")
        .limit(1)
        .single();

      if (!membershipData) return;
      const saccoId = membershipData.sacco_id;

      // Fetch members
      const { data: membersData } = await supabase
        .from("sacco_memberships")
        .select(
          `
          profile_id,
          role,
          profiles (
            full_name,
            member_number,
            phone
          )
        `,
        )
        .eq("sacco_id", saccoId);

      if (membersData) {
        setAllMembers(
          membersData.map((m) => ({
            id: m.profile_id,
            name: m.profiles?.full_name || "Unknown",
            memberId: m.profiles?.member_number || "",
            role: m.role,
          })),
        );

        setMetrics((prev) => ({ ...prev, totalMembers: membersData.length }));
      }

      // Fetch pending approvals
      const { count: pendingCount } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("sacco_id", saccoId)
        .eq("status", "pending");

      if (pendingCount !== null) {
        setMetrics((prev) => ({ ...prev, pendingApprovals: pendingCount }));
      }

      // We can add fetching for active loans and total capital later as needed.
    }
    fetchAdminData();
  }, []);

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
      info: "Loading...", // Will be updated via RPC later
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
      info: "Loading...",
      icon: "fa-solid fa-hand-holding-dollar",
      subInfo: "Total outstanding balances",
    },
  ];

  return (
    <AdminLayout>
      <div className="dashboard-body">
        <Header />
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
            <ContributionApprovals />
          </div>
          <div className="features-area">
            <QuickMemberManagement />
            <ManualContributionLog allMembers={allMembers} />
            <BroadcastMessageWidget />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
