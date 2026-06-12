import Header from "../Components/Header.jsx";
import ActionCards from "../Components/ActionCard.jsx";
import ContributionApprovals from "../Components/ContributionApprovals.jsx";
import QuickMemberManagement from "../Components/QuickMemberManagement.jsx";
import ManualContributionLog from "../Components/manualContributionlog.jsx";
import BroadcastMessageWidget from "../Components/BroadcastMessageWidget.jsx";
import AdminLayout from "../layout/AdminLayout.jsx";

const allMembers = [
  { name: "John Doe", id: "MZ-004", phone: "0701234567", role: "Admin" },
  {
    name: "Joseph Ssembatya",
    id: "MZ-017",
    phone: "0701234567",
    role: "Admin",
  },
  { name: "Emily Davis", id: "MZ-025", phone: "0701234567", role: "Admin" },
  { name: "Emilian Muller", id: "MZ-026", phone: "0701234567" },
  { name: "Michael Johnson", id: "MZ-009", phone: "0701234567" },
  { name: "Anna Garcia", id: "MZ-018", phone: "0701234567" },
  { name: "John Doe", id: "MZ-001", phone: "0701234567" },
];

const quickActionsCardsData = [
  {
    title: "Pending Approvals",
    color: "rgba(248, 113, 113, 0.25)",
    icon: "fa-solid fa-clock",
  },
  {
    title: "Total SACCO Capital",
    color: "rgba(245, 158, 11, 0.25)",
    icon: "fa-solid fa-coins",
  },
  {
    title: "Total Members",
    color: "rgba(16, 185, 129, 0.25)",
    icon: "fa-solid fa-users",
  },
  {
    title: "Active Loans issued",
    color: "rgba(59, 130, 246, 0.25)",
    icon: "fa-solid fa-hand-holding-dollar",
  },
];

export default function AdminDashboardPage() {
  return (
    <AdminLayout>
      <Header />
      <div className="summary-cards">
        {quickActionsCardsData.map((card) => (
          <ActionCards
            key={card.title}
            title={card.title}
            color={card.color}
            icon={card.icon}
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
    </AdminLayout>
  );
}
