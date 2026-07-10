import "../styles/featureArea.css";

export default function BroadcastMessageWidget() {
  const handleSubmit = (e) => {
    e.preventDefault();
    alert("Broadcast message sent successfully to all group members!");
  };

  return (
    <form className="quick-actions quick-actions-broadcast" onSubmit={handleSubmit}>
      <div className="section-header section-header-broadcast">
        <h3 className="section-title">
          <i className="fa-solid fa-bullhorn icon-broadcast"></i>Broadcast Message
        </h3>
      </div>
      <div className="admin-form-group">
        <label>Message Title</label>
        <input type="text" placeholder="e.g. Annual General Meeting" required />
      </div>
      <div className="admin-form-group">
        <label>Content</label>
        <textarea
          rows="4"
          placeholder="Type the message to send to all members..."
          required
        ></textarea>
      </div>
      <button type="submit" className="admin-btn-primary">
        Send to All Members <i className="fa-solid fa-paper-plane"></i>
      </button>
    </form>
  );
}
