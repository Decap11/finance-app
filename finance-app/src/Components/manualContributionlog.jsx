import { useState } from "react";
import "../styles/featureArea.css";

export default function ManualContributionLog({ allMembers }) {
  const [addMember, setAddMember] = useState("");
  const [addFundType, setAddFundType] = useState("");
  const [addAmount, setAddAmount] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!addMember || !addFundType || !addAmount) {
      alert("Please fill in all fields before submitting.");
      return;
    }
    // Handle form submission
    const newContributionRequest = {
      memberId: addMember,
      name: allMembers.find((member) => member.id === addMember)?.name || "",
      requestType: addFundType,
      amount: addAmount,
      date: new Date().toLocaleDateString(),
    };
    console.log(newContributionRequest);

    // Reset form fields
    setAddMember("");
    setAddFundType("");
    setAddAmount("");
  };
  return (
    <form className="quick-actions quick-actions-log" onSubmit={handleSubmit}>
      <div className="section-header section-header-log">
        <h3 className="section-title">
          <i className="fa-solid fa-file-invoice-dollar icon-log"></i>Log
          Contribution
        </h3>
      </div>
      <div className="admin-form-group admin-form-group-member">
        <label className="admin-label-member">Select Member</label>
        <select
          className="admin-select-member"
          value={addMember}
          onChange={(e) => setAddMember(e.target.value)}
        >
          {allMembers.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="admin-form-group admin-form-group-fund">
        <label className="admin-label-fund">Fund Pool Type</label>
        <select
          className="admin-select-fund"
          value={addFundType}
          onChange={(e) => setAddFundType(e.target.value)}
        >
          <option>Shares Pool </option>
          <option>Development Fund </option>
          <option>Social Fund </option>
        </select>
      </div>
      <div className="admin-form-group admin-form-group-amount">
        <label className="admin-label-amount">Amount (Shs)</label>
        <input
          type="number"
          placeholder="Enter amount..."
          className="admin-input-amount"
          value={addAmount}
          onChange={(e) => setAddAmount(Number(e.target.value))}
        />
      </div>
      <button className="admin-btn-primary admin-btn-register-contribution">
        Register Contribution
        <i
          className="fa-solid fa-check-double"
          style={{ marginLeft: "0.5rem" }}
        ></i>
      </button>
    </form>
  );
}
