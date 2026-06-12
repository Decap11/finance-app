// Quick Add Member
import "../styles/featureArea.css";
export default function QuickMemberManagement() {
  return (
    <div className="quick-actions quick-actions-member">
      <div className="section-header section-header-member">
        <h3 class="section-title">
          <i class="fa-solid fa-user-plus icon-member"></i>Member Management
        </h3>
      </div>
      <div className="quick-actions-btn-group">
        <button className="admin-btn-primary admin-btn-add-member">
          Add Member
        </button>
        <button className="admin-btn-primary admin-btn-delete-member">
          <i className="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  );
}
