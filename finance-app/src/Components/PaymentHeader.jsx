import { useSidebar } from "../context/useSidebar";
import "../styles/paymentHeader.css";

export default function PaymentHeader() {
  const { isOpen, toggleSidebar } = useSidebar();

  return (
    <header className="payment-header">
      <div className="header-left">
        <button
          type="button"
          className="menu-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
        >
          <i className={`fa-solid ${isOpen ? "fa-xmark" : "fa-bars"}`} />
        </button>
        <div className="welcome-text">
          <h1>Payment Plans</h1>
          <p>Choose the best plan to stay active and enjoy SACCO benefits.</p>
        </div>
      </div>
    </header>
  );
}
