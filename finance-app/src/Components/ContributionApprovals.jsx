import "../styles/contributionApprovals.css";
const contributionRequests = [
  {
    name: "John Doe",
    id: "MZ-004",
    type: "Shares Pool",
    amount: "Shs 25,000",
    date: "Week 2 • 22nd Apr",
  },
  {
    name: "Jane Smith",
    id: "MZ-028",
    type: "Dev Fund",
    amount: "Shs 1,000",
    date: "Week 2 • 22nd Apr",
  },
  {
    name: "Jane Smith",
    id: "MZ-028",
    type: "Dev Fund",
    amount: "Shs 1,000",
    date: "Week 2 • 22nd Apr",
  },
  {
    name: "Jane Smith",
    id: "MZ-028",
    type: "Shares Pool",
    amount: "Shs 1,000",
    date: "Week 2 • 22nd Apr",
  },
];

// const requestTypes = [
//   { type: "Shares Pool", badgeClass: "badge-shares-pool" },

//   { type: "Dev Fund", badgeClass: "badge-dev-fund" },

//   { type: "Social Fund", badgeClass: "badge-social-fund" },
// ];
export default function ContributionApprovals() {
  // const [requests, setRequests] = useState(contributionRequests);
  return (
    <div className="recent-transactions recent-transactions-verifications">
      <MainHeader />
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <TableColumnHeader />
          </thead>
          <tbody>
            {contributionRequests.map((request) => (
              <tr key={request.id}>
                <td>
                  <strong>{request.id}</strong>
                </td>
                <td>
                  <strong>{request.name}</strong>
                </td>
                <td>
                  <span
                    className={`badge badge-${request.type.toLowerCase().replace(" ", "-")}`}
                  >
                    {request.type}
                  </span>
                </td>
                <td>
                  <strong>{request.amount}</strong>
                </td>
                <td>{request.date}</td>
                <td>
                  <div className="table-actions">
                    <button className="btn-sm btn-approve">
                      <i className="fa-solid fa-check"></i>
                    </button>
                    <button className="btn-sm btn-reject">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function MainHeader() {
  return (
    <div className="section-header">
      <h3 className="section-title">Pending Contribution Approvals</h3>
      <a href="#">View All</a>
    </div>
  );
}

function TableColumnHeader() {
  return (
    <tr>
      <th>Member ID</th>
      <th>Name</th>
      <th>Request Type</th>
      <th>Amount</th>
      <th>Date</th>
      <th>Action</th>
    </tr>
  );
}
