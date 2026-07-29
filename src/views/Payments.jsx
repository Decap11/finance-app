import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import PaymentPlans from "../Components/Payments";

export default function Payments() {
  return (
    <MemberLayout>
      <div className="dashboard-body">
        <UserHeader />
        <PaymentPlans />
      </div>
    </MemberLayout>
  );
}
