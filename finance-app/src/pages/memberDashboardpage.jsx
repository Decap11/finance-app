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
      <UserHeader />
      <div className="dashboard-body">
        <UserSummaryCards
          title="My Shares Value"
          icon="fa-solid fa-chart-pie"
          info=" 2,450,000"
          subInfo="Shares due last week"
        />

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
