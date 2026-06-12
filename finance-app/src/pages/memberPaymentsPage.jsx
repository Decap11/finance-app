import PaymentHeader from "../Components/PaymentHeader";
import PaymentPlans from "../Components/Payments";
import MemberLayout from "../layout/MemberLayout";

export default function MemberPaymentsPage() {
  return (
    <MemberLayout className="payment-page">
      <PaymentHeader />
      <div className="dashboard-body">
        <section className="dashboard-grid">
          <PaymentPlans />
        </section>
      </div>
    </MemberLayout>
  );
}
