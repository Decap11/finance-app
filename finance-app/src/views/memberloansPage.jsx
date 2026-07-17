import UserHeader from "../Components/userHeader";
import LoanRequestWidget from "../Components/LoanRequestWidget";
import LoanRepaymentWidget from "../Components/LoanRepaymentWidget";
import RecentLoansTransactions from "../Components/RecentLoansTransactions";
import MemberLayout from "../layout/MemberLayout";

export default function MemberLoansPage() {
  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
        <section className="dashboard-grid">
          <div className="loan-widgets-container">
            <LoanRequestWidget />
            <LoanRepaymentWidget />
          </div>
          <div className="recent-transactions-container">
            <RecentLoansTransactions />
          </div>
        </section>
      </div>
    </MemberLayout>
  );
}
