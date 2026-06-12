import UserHeader from "../Components/userHeader";
import MemberLayout from "../layout/MemberLayout";
import "../styles/settings.css";

export default function Settings() {
  return (
    <MemberLayout>
      <UserHeader />
      <div className="dashboard-body">
          <section className="settings-container">
            {/* Settings Sidebar */}
            <div
              className="settings-sidebar"
              style={{
                background: "var(--white)",
                borderRadius: "1.6rem",
                padding: "2rem",
                boxShadow: "var(--card-shadow)",
              }}
            >
              <div
                className="settings-profile-summary"
                style={{
                  textAlign: "center",
                  paddingBottom: "2rem",
                  borderBottom: "0.1rem solid #f1f5f9",
                  marginBottom: "2rem",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    width: "10rem",
                    height: "10rem",
                    margin: "0 auto 1.5rem",
                  }}
                >
                  <img
                    src="https://i.pravatar.cc/150?img=11"
                    alt="Profile"
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 0,
                      background: "var(--primary-color)",
                      color: "white",
                      width: "3rem",
                      height: "3rem",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      border: "0.2rem solid white",
                    }}
                  >
                    <i className="fa-solid fa-camera" />
                  </div>
                </div>
                <h3
                  style={{
                    fontSize: "1.8rem",
                    color: "var(--text-dark)",
                    marginBottom: "0.5rem",
                  }}
                >
                  Joseph S.
                </h3>
                <p style={{ fontSize: "1.3rem", color: "var(--text-light)" }}>
                  Mem ID: 0042 • Joined Jan 2024
                </p>
              </div>

              <ul
                className="settings-nav"
                style={{ listStyle: "none", padding: 0 }}
              >
                <li style={{ marginBottom: "0.5rem" }}>
                  <a
                    href="#"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "1.2rem 1.5rem",
                      textDecoration: "none",
                      color: "var(--primary-color)",
                      background: "var(--bg-color)",
                      borderRadius: "1rem",
                      fontWeight: 600,
                      fontSize: "1.4rem",
                    }}
                  >
                    <i
                      className="fa-solid fa-user-pen"
                      style={{ width: "2.5rem" }}
                    />
                    Edit Profile
                  </a>
                </li>
                <li style={{ marginBottom: "0.5rem" }}>
                  <a
                    href="#"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "1.2rem 1.5rem",
                      textDecoration: "none",
                      color: "var(--text-dark)",
                      fontWeight: 500,
                      fontSize: "1.4rem",
                      transition: "background 0.2s",
                      borderRadius: "1rem",
                    }}
                  >
                    <i
                      className="fa-solid fa-shield-halved"
                      style={{ width: "2.5rem", color: "var(--text-light)" }}
                    />
                    Security
                  </a>
                </li>
                <li style={{ marginBottom: "0.5rem" }}>
                  <a
                    href="#"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "1.2rem 1.5rem",
                      textDecoration: "none",
                      color: "var(--text-dark)",
                      fontWeight: 500,
                      fontSize: "1.4rem",
                      transition: "background 0.2s",
                      borderRadius: "1rem",
                    }}
                  >
                    <i
                      className="fa-solid fa-bell"
                      style={{ width: "2.5rem", color: "var(--text-light)" }}
                    />
                    Notifications
                  </a>
                </li>
                <li style={{ marginBottom: "0.5rem" }}>
                  <a
                    href="#"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "1.2rem 1.5rem",
                      textDecoration: "none",
                      color: "var(--text-dark)",
                      fontWeight: 500,
                      fontSize: "1.4rem",
                      transition: "background 0.2s",
                      borderRadius: "1rem",
                    }}
                  >
                    <i
                      className="fa-solid fa-building-columns"
                      style={{ width: "2.5rem", color: "var(--text-light)" }}
                    />
                    Linked Accounts
                  </a>
                </li>
              </ul>
            </div>

            {/* Settings Form Area */}
            <div
              className="settings-content"
              style={{
                background: "var(--white)",
                borderRadius: "1.6rem",
                padding: "3rem",
                boxShadow: "var(--card-shadow)",
              }}
            >
              <h2
                style={{
                  fontSize: "2rem",
                  color: "var(--text-dark)",
                  marginBottom: "2.5rem",
                }}
              >
                Personal Information
              </h2>

              <form>
                <div className="settings-form-grid">
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "1.3rem",
                        fontWeight: 600,
                        color: "var(--text-dark)",
                        marginBottom: "0.8rem",
                      }}
                    >
                      First Name
                    </label>
                    <input
                      type="text"
                      defaultValue="Joseph"
                      style={{
                        width: "100%",
                        padding: "1.2rem 1.5rem",
                        border: "0.1rem solid #e2e8f0",
                        borderRadius: "0.8rem",
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        fontFamily: "inherit",
                        transition: "border-color 0.2s",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "1.3rem",
                        fontWeight: 600,
                        color: "var(--text-dark)",
                        marginBottom: "0.8rem",
                      }}
                    >
                      Last Name
                    </label>
                    <input
                      type="text"
                      defaultValue="Ssembatya"
                      style={{
                        width: "100%",
                        padding: "1.2rem 1.5rem",
                        border: "0.1rem solid #e2e8f0",
                        borderRadius: "0.8rem",
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: "2rem" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "1.3rem",
                      fontWeight: 600,
                      color: "var(--text-dark)",
                      marginBottom: "0.8rem",
                    }}
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    defaultValue="joseph.s@example.com"
                    style={{
                      width: "100%",
                      padding: "1.2rem 1.5rem",
                      border: "0.1rem solid #e2e8f0",
                      borderRadius: "0.8rem",
                      fontSize: "1.4rem",
                      color: "var(--text-dark)",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                <div style={{ marginBottom: "3rem" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "1.3rem",
                      fontWeight: 600,
                      color: "var(--text-dark)",
                      marginBottom: "0.8rem",
                    }}
                  >
                    Phone Number
                  </label>
                  <div style={{ display: "flex", gap: "1rem" }}>
                    <select
                      defaultValue="+256"
                      style={{
                        padding: "1.2rem",
                        border: "0.1rem solid #e2e8f0",
                        borderRadius: "0.8rem",
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        fontFamily: "inherit",
                        background: "white",
                      }}
                    >
                      <option value="+256">+256</option>
                    </select>
                    <input
                      type="tel"
                      defaultValue="700 000 000"
                      style={{
                        flex: 1,
                        padding: "1.2rem 1.5rem",
                        border: "0.1rem solid #e2e8f0",
                        borderRadius: "0.8rem",
                        fontSize: "1.4rem",
                        color: "var(--text-dark)",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                </div>

                <h2
                  style={{
                    fontSize: "2rem",
                    color: "var(--text-dark)",
                    marginBottom: "2.5rem",
                    paddingTop: "2rem",
                    borderTop: "0.1rem solid #f1f5f9",
                  }}
                >
                  Preferences
                </h2>

                <div style={{ marginBottom: "3rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <div>
                      <h4
                        style={{
                          fontSize: "1.4rem",
                          color: "var(--text-dark)",
                          marginBottom: "0.3rem",
                        }}
                      >
                        Monthly Statements
                      </h4>
                      <p
                        style={{
                          fontSize: "1.2rem",
                          color: "var(--text-light)",
                        }}
                      >
                        Receive PDF statements of your pool balances via email.
                      </p>
                    </div>
                    <label
                      style={{
                        position: "relative",
                        display: "inline-block",
                        width: "4.8rem",
                        height: "2.4rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        defaultChecked
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          cursor: "pointer",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: "var(--primary-color)",
                          transition: ".4s",
                          borderRadius: "3.4rem",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            height: "1.8rem",
                            width: "1.8rem",
                            left: "2.6rem",
                            bottom: "0.3rem",
                            backgroundColor: "white",
                            transition: ".4s",
                            borderRadius: "50%",
                          }}
                        />
                      </span>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <h4
                        style={{
                          fontSize: "1.4rem",
                          color: "var(--text-dark)",
                          marginBottom: "0.3rem",
                        }}
                      >
                        SMS Alerts
                      </h4>
                      <p
                        style={{
                          fontSize: "1.2rem",
                          color: "var(--text-light)",
                        }}
                      >
                        Get instant texts when admin approves a contribution.
                      </p>
                    </div>
                    <label
                      style={{
                        position: "relative",
                        display: "inline-block",
                        width: "4.8rem",
                        height: "2.4rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        defaultChecked
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          cursor: "pointer",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: "var(--primary-color)",
                          transition: ".4s",
                          borderRadius: "3.4rem",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            height: "1.8rem",
                            width: "1.8rem",
                            left: "2.6rem",
                            bottom: "0.3rem",
                            backgroundColor: "white",
                            transition: ".4s",
                            borderRadius: "50%",
                          }}
                        />
                      </span>
                    </label>
                  </div>
                </div>

                <div
                  style={{
                    textAlign: "right",
                    paddingTop: "2rem",
                    borderTop: "0.1rem solid #f1f5f9",
                  }}
                >
                  <button
                    type="button"
                    style={{
                      padding: "1.2rem 2.4rem",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-light)",
                      fontWeight: 600,
                      fontSize: "1.4rem",
                      cursor: "pointer",
                      marginRight: "1rem",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: "1.2rem 2.4rem",
                      background: "var(--primary-color)",
                      color: "white",
                      border: "none",
                      borderRadius: "0.8rem",
                      fontWeight: 600,
                      fontSize: "1.4rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.8rem",
                    }}
                  >
                    Save Changes <i className="fa-solid fa-check" />
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
    </MemberLayout>
  );
}
