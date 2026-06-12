// SACCO Finance - Version 2 Global State Manager (App-stateV2.js)

(function () {
  // ----------------------------------------------------
  // 1. Initial Mock Data Seeding (Local Database Setup)
  // ----------------------------------------------------
  // These default records provide sample SACCO workspaces, members,
  // transactions, loan requests, and announcements for the application.
  // They are seeded into localStorage only when no data already exists.
  const defaultSaccos = [
    {
      name: "Kampala Drivers Cooperative",
      acronym: "KAMPALA",
      code: "UGX-KAMPALA-814",
      adminName: "Joseph Ssembatya",
      adminEmail: "admin@kampaladrivers.com",
      memberLimit: "30",
      createdDate: "2026-01-15T08:00:00Z",
    },
  ];

  const defaultMembers = [
    {
      id: "MEM-0042",
      name: "Joseph Ssembatya",
      firstName: "Joseph",
      lastName: "Ssembatya",
      email: "joseph.s@example.com",
      phone: "700000000",
      joinedDate: "Jan 2024",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=11",
      savings: 1200000,
      shares: 800000,
      devFund: 64000,
      socialFund: 250500,
      tier: "Basic",
    },
    {
      id: "MEM-0014",
      name: "Sarah Namubiru",
      firstName: "Sarah",
      lastName: "Namubiru",
      email: "sarah.n@example.com",
      phone: "701000000",
      joinedDate: "Nov 2023",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=49",
      savings: 2400000,
      shares: 1200000,
      devFund: 96000,
      socialFund: 350000,
      tier: "Standard",
    },
    {
      id: "MEM-0128",
      name: "David Kibirige",
      firstName: "David",
      lastName: "Kibirige",
      email: "david.k@example.com",
      phone: "702000000",
      joinedDate: "Mar 2024",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=32",
      savings: 850000,
      shares: 400000,
      devFund: 48000,
      socialFund: 120000,
      tier: "Basic",
    },
    {
      id: "MEM-0005",
      name: "Mary Nakato",
      firstName: "Mary",
      lastName: "Nakato",
      email: "mary.n@example.com",
      phone: "703000000",
      joinedDate: "Oct 2023",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=36",
      savings: 3100000,
      shares: 2000000,
      devFund: 128000,
      socialFund: 420000,
      tier: "Premium",
    },
    {
      id: "MEM-0021",
      name: "Peter Lwanga",
      firstName: "Peter",
      lastName: "Lwanga",
      email: "peter.l@example.com",
      phone: "704000000",
      joinedDate: "Feb 2024",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=68",
      savings: 500000,
      shares: 300000,
      devFund: 32000,
      socialFund: 80000,
      tier: "Basic",
    },
    {
      id: "MEM-0089",
      name: "Florence Alero",
      firstName: "Florence",
      lastName: "Alero",
      email: "florence.a@example.com",
      phone: "705000000",
      joinedDate: "Jan 2024",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=47",
      savings: 1500000,
      shares: 750000,
      devFund: 72000,
      socialFund: 180000,
      tier: "Standard",
    },
    {
      id: "MEM-0255",
      name: "Paul Tumwesigye",
      firstName: "Paul",
      lastName: "Tumwesigye",
      email: "paul.t@example.com",
      phone: "706000000",
      joinedDate: "Mar 2024",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=12",
      savings: 900000,
      shares: 500000,
      devFund: 40000,
      socialFund: 110000,
      tier: "Basic",
    },
    {
      id: "MEM-0033",
      name: "Grace Mutesi",
      firstName: "Grace",
      lastName: "Mutesi",
      email: "grace.m@example.com",
      phone: "707000000",
      joinedDate: "Dec 2023",
      role: "Member",
      avatarUrl: "https://i.pravatar.cc/150?img=26",
      savings: 1100000,
      shares: 600000,
      devFund: 56000,
      socialFund: 150000,
      tier: "Basic",
    },
  ];

  const defaultTransactions = [
    {
      id: "tx-1",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "deposit",
      pool: "Savings",
      amount: 50000,
      date: "2026-06-07T09:41:00Z",
      status: "Completed",
    },
    {
      id: "tx-2",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "withdrawal",
      pool: "Savings",
      amount: 120000,
      date: "2026-06-06T14:15:00Z",
      status: "Completed",
    },
    {
      id: "tx-3",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "transfer",
      pool: "Shares Pool",
      amount: 25000,
      date: "2026-06-05T11:30:00Z",
      status: "Completed",
    },
    {
      id: "tx-4",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "loan",
      pool: "Loan Repayment",
      amount: 120000,
      date: "2026-06-04T10:00:00Z",
      status: "Completed",
    },
    {
      id: "tx-5",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "deposit",
      pool: "Dividends Payout",
      amount: 2500,
      date: "2026-06-03T08:00:00Z",
      status: "Completed",
    },
    {
      id: "tx-6",
      memberId: "MEM-0014",
      name: "Sarah N.",
      type: "deposit",
      pool: "Shares Pool",
      amount: 20000,
      date: "2026-06-07T12:00:00Z",
      status: "Completed",
    },
    {
      id: "tx-7",
      memberId: "MEM-0128",
      name: "David K.",
      type: "deposit",
      pool: "Development Fund",
      amount: 1000,
      date: "2026-06-07T11:30:00Z",
      status: "Completed",
    },
    {
      id: "tx-8",
      memberId: "MEM-0021",
      name: "Peter L.",
      type: "deposit",
      pool: "Social Fund",
      amount: 15000,
      date: "2026-06-07T10:45:00Z",
      status: "Completed",
    },
    {
      id: "tx-pending-1",
      memberId: "MEM-0042",
      name: "Joseph S.",
      type: "deposit",
      pool: "Shares Pool",
      amount: 25000,
      date: "2026-06-07T12:22:00Z",
      status: "Pending",
      week: "Week 2 • Wed 22nd Apr 2026",
    },
    {
      id: "tx-pending-2",
      memberId: "MEM-0128",
      name: "David K.",
      type: "deposit",
      pool: "Development Fund",
      amount: 1000,
      date: "2026-06-07T12:22:00Z",
      status: "Pending",
      week: "Week 2 • Wed 22nd Apr 2026",
    },
    {
      id: "tx-pending-3",
      memberId: "MEM-0033",
      name: "Grace M.",
      type: "deposit",
      pool: "Social Fund",
      amount: 5000,
      date: "2026-06-07T12:22:00Z",
      status: "Pending",
      week: "Week 2 • Wed 22nd Apr 2026",
    },
    {
      id: "tx-pending-4",
      memberId: "MEM-0255",
      name: "Paul T.",
      type: "deposit",
      pool: "Shares Pool",
      amount: 50000,
      date: "2026-06-07T12:22:00Z",
      status: "Pending",
      week: "Week 1 • Wed 15th Apr 2026",
    },
  ];

  const defaultLoans = [
    {
      id: "loan-1",
      memberId: "MEM-0042",
      name: "Joseph Ssembatya",
      amount: 800000,
      outstandingBalance: 450000,
      reason: "business",
      interestRate: 5,
      status: "Approved",
      requestDate: "2026-05-01T10:00:00Z",
      dueDate: "2026-07-01",
      payments: [{ amount: 350000, date: "2026-06-04" }],
    },
    {
      id: "loan-2",
      memberId: "MEM-0014",
      name: "Sarah Namubiru",
      amount: 1000000,
      outstandingBalance: 1000000,
      reason: "education",
      interestRate: 5,
      status: "Pending",
      requestDate: "2026-06-06T15:00:00Z",
      dueDate: "",
    },
    {
      id: "loan-3",
      memberId: "MEM-0128",
      name: "David Kibirige",
      amount: 300000,
      outstandingBalance: 0,
      reason: "medical",
      interestRate: 5,
      status: "Completed",
      requestDate: "2026-04-10T09:00:00Z",
      dueDate: "2026-05-10",
      payments: [{ amount: 315000, date: "2026-05-08" }],
    },
  ];

  const defaultBroadcasts = [
    {
      id: "b-1",
      title: "Annual General Meeting",
      content:
        "The annual general meeting for all cooperative members will be held on July 15, 2026. Physical attendance is mandatory. Check in begins at 9:00 AM.",
      date: "2026-06-05T08:00:00Z",
    },
  ];

  // ----------------------------------------------------
  // 2. Local Storage Bootstrapping
  // ----------------------------------------------------
  // initLocalStorage ensures the SACCO application has a valid
  // data store before any UI logic or state API is executed.
  function initLocalStorage() {
    if (!localStorage.getItem("registeredSaccos")) {
      localStorage.setItem("registeredSaccos", JSON.stringify(defaultSaccos));
    }
    if (!localStorage.getItem("activeSacco")) {
      localStorage.setItem("activeSacco", "UGX-KAMPALA-814");
    }
    if (!localStorage.getItem("members")) {
      localStorage.setItem("members", JSON.stringify(defaultMembers));
    }
    if (!localStorage.getItem("transactions")) {
      localStorage.setItem("transactions", JSON.stringify(defaultTransactions));
    }
    if (!localStorage.getItem("loans")) {
      localStorage.setItem("loans", JSON.stringify(defaultLoans));
    }
    if (!localStorage.getItem("broadcasts")) {
      localStorage.setItem("broadcasts", JSON.stringify(defaultBroadcasts));
    }
    if (!localStorage.getItem("attendanceLogs")) {
      localStorage.setItem("attendanceLogs", JSON.stringify([]));
    }
    if (!localStorage.getItem("currentUser")) {
      // Seed the initial session with a default member account.
      localStorage.setItem("currentUser", JSON.stringify(defaultMembers[0]));
    }
    if (!localStorage.getItem("isAuthenticated")) {
      localStorage.setItem("isAuthenticated", "true");
    }
    if (!localStorage.getItem("theme")) {
      localStorage.setItem("theme", "light");
    }
  }

  initLocalStorage();

  // ----------------------------------------------------
  // 3. SACCO State API Definitions
  // ----------------------------------------------------
  // The SaccoState object exposes functions used by pages and widgets
  // to read and mutate application state for SACCO members, loans,
  // transactions, broadcasts, themes, and attendance.
  const SaccoState = {
    // --------- SACCO Workspace Management ---------
    getRegisteredSaccos: function () {
      // Return all registered SACCO workspaces stored locally.
      return JSON.parse(localStorage.getItem("registeredSaccos") || "[]");
    },
    addSacco: function (sacco) {
      // Add a new SACCO workspace and make it the active one.
      const saccos = this.getRegisteredSaccos();
      saccos.unshift(sacco);
      localStorage.setItem("registeredSaccos", JSON.stringify(saccos));
      localStorage.setItem("activeSacco", sacco.code);
      localStorage.setItem("saccoName", sacco.name);
    },
    getActiveSaccoCode: function () {
      // Return the currently selected SACCO workspace code.
      return localStorage.getItem("activeSacco") || "UGX-KAMPALA-814";
    },
    getActiveSacco: function () {
      // Resolve the active SACCO workspace object by code.
      const code = this.getActiveSaccoCode();
      return (
        this.getRegisteredSaccos().find((s) => s.code === code) ||
        defaultSaccos[0]
      );
    },
    setActiveSaccoCode: function (code) {
      // Switch the active workspace and update displayed branding.
      localStorage.setItem("activeSacco", code);
      const sacco = this.getRegisteredSaccos().find((s) => s.code === code);
      if (sacco) {
        localStorage.setItem("saccoName", sacco.name);
      }
    },

    // --------- Current User Session ---------
    getCurrentUser: function () {
      // Return the member session currently logged in.
      return JSON.parse(localStorage.getItem("currentUser") || "null");
    },
    updateCurrentUser: function (data) {
      // Update the current session profile and keep member records in sync.
      const user = this.getCurrentUser();
      if (!user) return;
      const updated = Object.assign({}, user, data);

      if (data.firstName && data.lastName) {
        updated.name = data.firstName + " " + data.lastName;
      }

      localStorage.setItem("currentUser", JSON.stringify(updated));

      if (updated.id) {
        const members = this.getMembers();
        const idx = members.findIndex((m) => m.id === updated.id);
        if (idx !== -1) {
          members[idx] = Object.assign({}, members[idx], updated);
          localStorage.setItem("members", JSON.stringify(members));
        }
      }
    },
    logout: function () {
      // End the session and redirect the user to the login/intro flow.
      localStorage.removeItem("isAuthenticated");
      localStorage.removeItem("currentUser");
      window.location.href = "intro.html";
    },

    // --------- Member Records ---------
    getMembers: function () {
      // Return the full list of SACCO members.
      return JSON.parse(localStorage.getItem("members") || "[]");
    },
    addMember: function (member) {
      // Add a new SACCO member and normalize required fields.
      const members = this.getMembers();
      if (!member.id) {
        const maxId = members.reduce((max, m) => {
          const num = parseInt(m.id.replace("MEM-", ""));
          return num > max ? num : max;
        }, 0);
        member.id = "MEM-" + String(maxId + 1).padStart(4, "0");
      }
      member.joinedDate =
        member.joinedDate ||
        new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
        });
      member.savings = member.savings || 0;
      member.shares = member.shares || 0;
      member.devFund = member.devFund || 0;
      member.socialFund = member.socialFund || 0;
      member.tier = member.tier || "Basic";
      member.avatarUrl =
        member.avatarUrl ||
        "https://i.pravatar.cc/150?img=" + Math.floor(Math.random() * 70);

      members.unshift(member);
      localStorage.setItem("members", JSON.stringify(members));
      return member;
    },
    deleteMember: function (id) {
      // Remove a member from SACCO membership records.
      let members = this.getMembers();
      members = members.filter((m) => m.id !== id);
      localStorage.setItem("members", JSON.stringify(members));
    },

    // --------- Transaction Ledger ---------
    getTransactions: function () {
      // Return the transaction history used across dashboards.
      return JSON.parse(localStorage.getItem("transactions") || "[]");
    },
    addTransaction: function (tx) {
      // Record a new transaction and optionally update balances.
      const txs = this.getTransactions();
      tx.id = tx.id || "tx-" + Math.floor(100000 + Math.random() * 900000);
      tx.date = tx.date || new Date().toISOString();
      tx.status = tx.status || "Pending";

      txs.unshift(tx);
      localStorage.setItem("transactions", JSON.stringify(txs));

      if (tx.status === "Completed") {
        this.updateMemberBalances(tx.memberId, tx.pool, tx.amount, tx.type);
      }
      return tx;
    },
    approveTransaction: function (id) {
      // Mark a pending transaction as completed and update balances.
      const txs = this.getTransactions();
      const idx = txs.findIndex((t) => t.id === id);
      if (idx !== -1) {
        txs[idx].status = "Completed";
        localStorage.setItem("transactions", JSON.stringify(txs));

        const tx = txs[idx];
        this.updateMemberBalances(tx.memberId, tx.pool, tx.amount, tx.type);
      }
    },
    rejectTransaction: function (id) {
      // Mark a pending transaction as rejected without changing balances.
      const txs = this.getTransactions();
      const idx = txs.findIndex((t) => t.id === id);
      if (idx !== -1) {
        txs[idx].status = "Rejected";
        localStorage.setItem("transactions", JSON.stringify(txs));
      }
    },
    updateMemberBalances: function (memberId, pool, amount, type) {
      // Update member financial balances after a completed transaction.
      const amountVal = parseFloat(amount.toString().replace(/,/g, ""));
      const members = this.getMembers();
      const idx = members.findIndex((m) => m.id === memberId);
      if (idx !== -1) {
        const member = members[idx];
        const modifier =
          type === "deposit" ||
          pool.includes("Payout") ||
          pool.includes("Disbursement")
            ? 1
            : -1;

        if (pool.includes("Shares")) {
          member.shares = (member.shares || 0) + amountVal * modifier;
        } else if (pool.includes("Development") || pool.includes("Dev Fund")) {
          member.devFund = (member.devFund || 0) + amountVal * modifier;
        } else if (pool.includes("Social")) {
          member.socialFund = (member.socialFund || 0) + amountVal * modifier;
        } else if (pool.includes("Savings")) {
          member.savings = (member.savings || 0) + amountVal * modifier;
        }

        localStorage.setItem("members", JSON.stringify(members));

        const user = this.getCurrentUser();
        if (user && user.id === memberId) {
          this.updateCurrentUser({
            savings: member.savings,
            shares: member.shares,
            devFund: member.devFund,
            socialFund: member.socialFund,
          });
        }
      }
    },

    // --------- Loan Management ---------
    getLoans: function () {
      // Retrieve the SACCO loan request queue.
      return JSON.parse(localStorage.getItem("loans") || "[]");
    },
    addLoan: function (loan) {
      // Create a new loan request and store it in the loan ledger.
      const loans = this.getLoans();
      loan.id = loan.id || "loan-" + Math.floor(100 + Math.random() * 900);
      loan.requestDate = loan.requestDate || new Date().toISOString();
      loan.status = loan.status || "Pending";
      loan.outstandingBalance =
        loan.outstandingBalance !== undefined
          ? loan.outstandingBalance
          : parseFloat(loan.amount);
      loan.payments = loan.payments || [];

      loans.unshift(loan);
      localStorage.setItem("loans", JSON.stringify(loans));
      return loan;
    },
    approveLoan: function (id) {
      // Approve a loan, assign a due date, and record the disbursement.
      const loans = this.getLoans();
      const idx = loans.findIndex((l) => l.id === id);
      if (idx !== -1) {
        const loan = loans[idx];
        loan.status = "Approved";
        loan.outstandingBalance = parseFloat(loan.amount);

        const due = new Date();
        due.setDate(due.getDate() + 30);
        loan.dueDate = due.toISOString().split("T")[0];

        localStorage.setItem("loans", JSON.stringify(loans));

        this.addTransaction({
          memberId: loan.memberId,
          name: loan.name,
          type: "deposit",
          pool: "Loan Disbursement",
          amount: loan.amount,
          status: "Completed",
        });
      }
    },
    rejectLoan: function (id) {
      // Reject a loan request and save the updated status.
      const loans = this.getLoans();
      const idx = loans.findIndex((l) => l.id === id);
      if (idx !== -1) {
        loans[idx].status = "Rejected";
        localStorage.setItem("loans", JSON.stringify(loans));
      }
    },
    repayLoan: function (loanId, amountVal, source) {
      // Record a loan repayment and optionally deduct funds from savings.
      const loans = this.getLoans();
      const idx = loans.findIndex((l) => l.id === loanId);
      if (idx !== -1) {
        const loan = loans[idx];
        const prevBal = parseFloat(loan.outstandingBalance);
        const actualRepay = Math.min(prevBal, parseFloat(amountVal));

        loan.outstandingBalance = Math.max(0, prevBal - actualRepay);
        if (loan.outstandingBalance === 0) {
          loan.status = "Completed";
        }

        loan.payments.push({
          amount: actualRepay,
          date: new Date().toISOString().split("T")[0],
          source: source,
        });

        localStorage.setItem("loans", JSON.stringify(loans));

        this.addTransaction({
          memberId: loan.memberId,
          name: loan.name,
          type: "withdrawal",
          pool: "Loan Repayment",
          amount: actualRepay,
          status: "Completed",
        });

        if (source === "savings") {
          this.updateMemberBalances(
            loan.memberId,
            "Savings",
            actualRepay,
            "withdrawal",
          );
        }

        return actualRepay;
      }
      return 0;
    },

    // --------- Broadcast Messaging ---------
    getBroadcasts: function () {
      // Return community announcements for the SACCO.
      return JSON.parse(localStorage.getItem("broadcasts") || "[]");
    },
    addBroadcast: function (title, content) {
      // Add a new announcement message to the broadcast feed.
      const broadcasts = this.getBroadcasts();
      const newBroadcast = {
        id: "b-" + Math.floor(100 + Math.random() * 900),
        title: title,
        content: content,
        date: new Date().toISOString(),
      };
      broadcasts.unshift(newBroadcast);
      localStorage.setItem("broadcasts", JSON.stringify(broadcasts));
      return newBroadcast;
    },

    // --------- Attendance Tracking ---------
    getAttendanceLogs: function () {
      // Load the historical attendance log for member meetings.
      return JSON.parse(localStorage.getItem("attendanceLogs") || "[]");
    },
    saveAttendance: function (presentIds) {
      // Save today's attendance and assess fines for absent members.
      const members = this.getMembers();
      const absentMembers = members.filter((m) => !presentIds.includes(m.id));

      const newLog = {
        id: "att-" + Date.now(),
        date: new Date().toISOString().split("T")[0],
        present: presentIds,
        absent: absentMembers.map((m) => m.id),
      };

      const logs = this.getAttendanceLogs();
      logs.unshift(newLog);
      localStorage.setItem("attendanceLogs", JSON.stringify(logs));

      absentMembers.forEach((m) => {
        this.addTransaction({
          memberId: m.id,
          name: m.name,
          type: "withdrawal",
          pool: "Attendance Penalty Fine",
          amount: 1000,
          status: "Completed",
          date: new Date().toISOString(),
        });
      });

      return absentMembers;
    },

    // --------- Theme Management ---------
    getTheme: function () {
      // Return the user's saved display theme preference.
      return localStorage.getItem("theme") || "light";
    },
    toggleTheme: function () {
      // Switch between light and dark themes and persist the choice.
      const current = this.getTheme();
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      this.applyTheme(next);
      return next;
    },
    applyTheme: function (theme) {
      // Apply the theme by toggling document-level attributes.
      document.documentElement.setAttribute("data-theme", theme);
      if (theme === "dark") {
        document.body.classList.add("dark-mode");
      } else {
        document.body.classList.remove("dark-mode");
      }
    },
  };

  // ----------------------------------------------------
  // 4. UI Hydration and DOM Binding
  // ----------------------------------------------------
  // hydrateUI synchronizes the saved state with visible UI elements,
  // including profile displays, workspace branding, sidebar behavior,
  // and theme toggle controls.
  function hydrateUI() {
    SaccoState.applyTheme(SaccoState.getTheme());

    const user = SaccoState.getCurrentUser();
    const activeSacco = SaccoState.getActiveSacco();

    if (user) {
      document
        .querySelectorAll(".user-profile img, .settings-profile-summary img")
        .forEach((img) => {
          if (user.avatarUrl) img.src = user.avatarUrl;
        });
      document
        .querySelectorAll(".user-info .name, .settings-profile-summary h3")
        .forEach((el) => {
          el.innerText = user.name || user.firstName + " " + user.lastName;
        });
      document.querySelectorAll(".user-info .role").forEach((el) => {
        el.innerText = user.id ? "Member ID: " + user.id : "System Access";
      });
      document.querySelectorAll(".settings-profile-summary p").forEach((el) => {
        el.innerText =
          "Mem ID: " +
          (user.id || "N/A") +
          " • Joined " +
          (user.joinedDate || "N/A");
      });
    }

    if (activeSacco) {
      document
        .querySelectorAll(".logo-container h2, .logo-group .logo-text")
        .forEach((el) => {
          if (el.classList.contains("logo-text")) {
            el.innerHTML =
              activeSacco.acronym +
              '<span style="color:var(--primary-light)">Finance</span>';
          } else {
            el.innerText = activeSacco.acronym || "SACCO";
          }
        });

      const welcomeDesc = document.querySelector(".welcome-text p");
      if (welcomeDesc && window.location.pathname.includes("dashboard")) {
        welcomeDesc.innerText = `Dashboard workspace: ${activeSacco.name}. Access Code: ${activeSacco.code}`;
      }
    }

    document.querySelectorAll('a[href="intro.html"]').forEach((a) => {
      a.onclick = function (e) {
        e.preventDefault();
        SaccoState.logout();
      };
    });

    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      themeBtn.onclick = function () {
        const nextTheme = SaccoState.toggleTheme();
        this.innerHTML =
          nextTheme === "dark"
            ? '<i class="fa-solid fa-sun"></i>'
            : '<i class="fa-solid fa-moon"></i>';
      };
      themeBtn.innerHTML =
        SaccoState.getTheme() === "dark"
          ? '<i class="fa-solid fa-sun"></i>'
          : '<i class="fa-solid fa-moon"></i>';
    }
  }

  window.SaccoState = SaccoState;

  document.addEventListener("DOMContentLoaded", function () {
    hydrateUI();
  });
})();

// ----------------------------------------------------
// 5. Mobile Sidebar & Profile Dropdown Controls
// ----------------------------------------------------
// These global functions are used by the app layout to handle
// responsive sidebar toggling and profile menu interactions.
window.toggleSidebar = function () {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const menuBtn = document.getElementById("menuToggleBtn");

  if (!sidebar) return;

  const isActive = sidebar.classList.toggle("active");

  if (overlay) {
    overlay.classList.toggle("active");
  }

  if (menuBtn) {
    menuBtn.setAttribute("aria-expanded", isActive ? "true" : "false");
  }

  if (window.innerWidth < 900) {
    document.body.style.overflow = isActive ? "hidden" : "";
  }
};

window.toggleProfileDropdown = function (event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById("profileDropdown");
  if (dropdown) dropdown.classList.toggle("active");
};

document.addEventListener("click", function (e) {
  const dropdown = document.getElementById("profileDropdown");
  if (dropdown && !e.target.closest(".user-profile")) {
    dropdown.classList.remove("active");
  }
});
