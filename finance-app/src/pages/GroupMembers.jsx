import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";

export default function GroupMembers() {
  return (
    <MemberLayout>
      <UserHeader />
      <div className="dashboard-body" />
    </MemberLayout>
  );
}
