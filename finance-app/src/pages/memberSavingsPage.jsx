import UserHeader from "../Components/userHeader";
import SavingsSummaryCards from "../Components/savingsSummarycards";
import FundDistributionMix from "../Components/fundDistributionMix";
import SavingsLatestMemberTransactions from "../Components/SavingsLatestMemberTransactions";
import MemberLayout from "../layout/MemberLayout";
import PromoBanner from "../Components/PromoBanner";

export default function MemberSavingsPage() {
  return (
    <MemberLayout>
      <UserHeader />
      <div className="dashboard-body">
        <SavingsSummaryCards />
        <div className="dashboard-grid">
          <FundDistributionMix />
          <SavingsLatestMemberTransactions />
          <PromoBanner />
        </div>
      </div>
    </MemberLayout>
  );
}
