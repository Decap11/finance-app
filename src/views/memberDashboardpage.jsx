import UserHeader from "../Components/userHeader";
import UserSummaryCards from "../Components/userSummaryCards";
import WeeklyContributions from "../Components/userweeklycontributions";
import UserRecentTransactions from "../Components/UserRecentTransactions";
import UserLoanEligibity from "../Components/UserLoanEligibity";
import UserProgressTracker from "../Components/UserProgressTracker";
import CalendarHeatMap from "../Components/calendarHeatMap";
import MemberLayout from "../layout/MemberLayout";

export default function MemberDashboardPage() {
  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
        <UserSummaryCards />

        <WeeklyContributions />
        <UserRecentTransactions />

        <section className="loan-progress-section">
          <UserLoanEligibity />
          <UserProgressTracker />
          <CalendarHeatMap />
        </section>
      </div>
    </MemberLayout>
  );
}
