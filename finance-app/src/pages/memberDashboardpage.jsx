import UserHeader from "../Components/userHeader";
import UserSummaryCards from "../Components/userSummaryCards";
import WeeklyContributions from "../Components/userweeklycontributions";
import UserRecentTransactions from "../Components/UserRecentTransactions";
import UserLoanEligibity from "../Components/UserLoanEligibity";
import UserProgressTracker from "../Components/UserProgressTracker";
import CalendarHeatMap from "../Components/calendarHeatMap";
import MemberLayout from "../layout/MemberLayout";

import { useEffect } from "react";

export default function MemberDashboardPage() {
  useEffect(function () {
    async function fetchMembers() {
      const res = await fetch("http://localhost:5000/members");
      const data = await res.json();
      console.log(data);
    }
    fetchMembers();
  }, []);
  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
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
