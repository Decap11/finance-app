# SACCO Web Application: End-to-End Workflow Procedure

This document outlines the step-by-step operational flow of the SACCO web application, starting from the creation of a new SACCO group to the daily financial operations and reporting. It serves as a functional blueprint for how users (Admins, Loan Officers, and Members) interact with the system.

## 1. Platform Administration & SACCO Onboarding

Yeah

The journey begins with bringing a new SACCO onto the platform.

### 1.1. SACCO Workspace Creation

- **Action:** A designated SACCO Administrator signs up on the platform and creates a new SACCO workspace.
- **Details:** The admin provides the SACCO's name, acronym, and generates a unique **Group Code**.
- **Result:** A dedicated workspace is created in the database (`public.saccos`), isolated from other groups on the platform.

### 1.2. Configuring SACCO Rules

- **Action:** The SACCO Admin navigates to `/settings` to configure the group's financial rules.
- **Details:** This includes setting:
  - Share value (e.g., 1 share = 10,000 UGX).
  - Loan interest rates (e.g., 5% per month).
  - Maximum loan limits (e.g., 3x a member's total savings).
  - Penalties for late meeting attendance or late loan repayments.

## 2. Member Onboarding & Role Assignment

Once the workspace exists, members need to join and be vetted.

### 2.1. Member Signup

- **Action:** The Admin shares the unique **Group Code** with the physical SACCO members.
- **Details:** Members visit the `/signup` page, enter their personal details (Name, Phone, Email, Password), and the Group Code.
- **Result:** A user profile is created in Supabase Auth and `public.profiles`. A membership record is created in `public.sacco_memberships` with a status of `pending`.

### 2.2. Profile Completion (Onboarding)

- **Action:** Upon first login, the member is routed to `/onboarding`.
- **Details:** The member fills out necessary KYC (Know Your Customer) information, such as Next of Kin, ID numbers, and accepts the SACCO's terms and conditions.

### 2.3. Admin Approval & Role Assignment

- **Action:** The SACCO Admin logs in and views the Admin Dashboard (`/admin`).
- **Details:** The admin reviews the list of `pending` members. They verify the identities (often matching them to physical members) and approve them.
- **Result:** The member's status becomes `active`. The Admin can also elevate specific members to different roles (e.g., `loan_officer`, `treasurer`, `admin`). Financial accounts (Savings, Shares, Loans) are initialized for the active member with a zero balance.

## 3. Core Financial Operations

This is the day-to-day loop of the application involving money moving in and out.

### 3.1. Savings & Shares Contributions (Deposits)

- **Action (Member):** A member navigates to `/payments` or `/savings` to log a deposit. They specify the amount and the breakdown (e.g., 50,000 UGX total: 30,000 to Savings, 20,000 to Shares) and provide a transaction reference (like a Mobile Money receipt number).
- **Action (Admin/Treasurer):** The transaction enters a `pending` state. The Admin views the "Contribution Approvals" queue on the admin dashboard.
- **Verification:** The Admin verifies that the money actually hit the SACCO's physical bank/mobile money account.
- **Approval:** Once verified, the Admin approves the transaction.
- **Result:** The database updates the member's `accounts` balances. An immutable ledger entry is recorded in `public.transactions`. The member sees their updated balances on `/dashboard`.
- **NOTE** It important to note that the savings are classified into 3 categories and transaction or saving type is denoted by a unique color as shown in the icons of the action cards(shares- #253b8e), (Development fund #10b981), (social fund #ef4444) which is a mandatory amount of 1000 Shs, all these values are equated a aggregated to a value that will be shown in the first card which is denoted by a color(#f59e0b).These are submitted to the admin's dashboard as requests waiting for approval.

### 3.2. The Loan Lifecycle

- **Check Eligibility:** A member visits `/loans` to see their maximum eligible loan amount (calculated automatically based on their approved savings).
- **Request (Member):** The member submits a loan request specifying the amount, term (months), and purpose.
- **Review (Loan Officer/Admin):** The request appears in the Loan Officer's queue. They review the member's saving consistency, current outstanding loans, and potentially guarantor requirements (if implemented).
- **Approval & Disbursement:** The Loan Officer approves the loan.
- **Result:** The loan status changes to `active`. The requested amount is added to the member's outstanding loan balance. (In a fully integrated system, this would also trigger a payout API to the member's mobile wallet; otherwise, it records that physical cash was given).
- **Repayment (Member):** The member makes a loan repayment (similar to the contribution workflow). They log the payment, the Admin verifies the receipt, and approves it. The repayment amount is deducted from the member's `outstanding_balance` in the `public.loans` table, covering interest first, then principal.

## 4. Group Management & Administration

### 4.1. Meetings & Attendance Tracking

- **Action:** During weekly or monthly physical/virtual meetings, the Admin navigates to the group management section.
- **Details:** The Admin logs attendance.
- **Result:** Members marked as "Late" or "Absent" automatically have fines generated against their accounts (creating a `pending` or `approved` debit transaction categorized as 'fine'), depending on the SACCO's configured rules.

### 4.2. Broadcasts & Communication

- **Action:** Admins need to communicate with the group.
- **Details:** The Admin creates a Broadcast message.
- **Result:** The message appears as an alert or notification on every member's `/dashboard`.

## 5. Reporting & Auditing

### 5.1. Member Experience

- Members have continuous read-only access to their financial history. Their `/dashboard` visualizes their saving progress over time, their current shareholding percentage, and upcoming loan payment due dates.

### 5.2. Admin Experience

- Admins have access to a bird's-eye view of the SACCO's health.
- They can generate reports on total liquidity, default rates on loans, and individual member statements.
- Every approval, rejection, or balance adjustment is tracked in the `public.audit_events` table, ensuring a transparent trail of who authorized what action and when, protecting against fraud.

## 6. End of Cycle (Optional / Advanced)

- Many SACCOs operate on annual cycles. At the end of the year, the Admin initiates a "Dividend Distribution" workflow.
- The system calculates the total interest earned from loans and distributes a percentage of it back to the members as dividends, proportionally based on the number of shares each member holds. This creates a bulk set of 'dividend' credit transactions to the members' accounts.
