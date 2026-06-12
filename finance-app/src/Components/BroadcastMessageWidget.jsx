import "../styles/featureArea.css";
export default function BroadcastMessageWidget() {
  return (
    <div className="quick-actions quick-actions-broadcast">
      <div className="section-header section-header-broadcast">
        <h3 className="section-title">
          <i className="fa-solid fa-bullhorn icon-broadcast"></i>Broadcast
          Message
        </h3>
      </div>
      <div className="admin-form-group">
        <label>Message Title</label>
        <input type="text" placeholder="e.g. Annual General Meeting" />
      </div>
      <div className="admin-form-group">
        <label>Content</label>
        <textarea
          rows="4"
          placeholder="Type the message to send to all members..."
        ></textarea>
      </div>
      <button className="admin-btn-primary">
        Send to All Members <i className="fa-solid fa-paper-plane"></i>
      </button>
    </div>
  );
}
