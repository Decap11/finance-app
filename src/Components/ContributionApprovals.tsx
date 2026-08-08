"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";
import { formatTransactionMeetingDate } from "../utils/meetingDateUtils";
import { shareCountOf, shareUnitPriceOf, formatShs } from "../utils/sharePricing";
import { canFundLoan, loanShortfall, formatSignedShs } from "../utils/saccoCapital";
import { subscribeToOwnSaccoRows } from "../utils/realtimeScope";
import "../styles/contributionApprovals.css";

export interface TransactionApprovalItem {
  id: string;
  amount: number;
  category: string;
  status: string;
  created_at: string;
  profile_id: string;
  requested_by?: string;
  description?: string;
  // How many shares, and at what price, as agreed with the member at the moment they
  // submitted. Null on rows written before migration 0033, where the same two facts are
  // recovered from the description instead.
  share_count?: number | null;
  unit_price?: number | null;
  profiles?: {
    full_name: string;
    member_number: string;
  } | null;
  requester?: {
    full_name: string;
  } | null;
}

interface ContributionApprovalsProps {
  limit?: number;
  showViewAll?: boolean;
  // "pending"       -- only what still needs an admin decision (overview tab). Kept in step
  //                    with the Pending Approvals summary card, which counts the same set.
  // "verifications" -- the full history, including already approved and rejected requests.
  mode?: "pending" | "verifications";
}

export default function ContributionApprovals({ limit, showViewAll, mode = "verifications" }: ContributionApprovalsProps) {
  const pendingOnly = mode === "pending";
  const [requests, setRequests] = useState<TransactionApprovalItem[]>([]);
  const [saccoMeetingDay, setSaccoMeetingDay] = useState<string>("Wednesday");
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");
  // Cash the SACCO actually holds. Null until it loads, and null for good on a database
  // without migration 0034 -- in which case this queue behaves exactly as it did before.
  // A loan disbursement approved from this table is paid out of this number, and until
  // 0034 there was nowhere in the app an admin could see it before deciding.
  const [capitalOnHand, setCapitalOnHand] = useState<number | null>(null);

  async function fetchCapital(profileId: string) {
    const { data, error } = await supabase.rpc('get_sacco_capital_position', {
      p_profile_id: profileId
    });

    if (error) {
      console.warn('Capital position unavailable (is migration 0034 applied?):', error.message);
      return;
    }

    if (data?.length) {
      setCapitalOnHand(Number(data[0].on_hand) || 0);
    }
  }

  async function refreshCapital() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await fetchCapital(user.id);
  }

  async function fetchRequests() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Deliberately not awaited into the critical path. The table is the page; the
      // capital line is context beside it, and a slow or missing RPC must not hold the
      // approvals queue back.
      fetchCapital(user.id);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      if (!profileData) {
        setLoading(false);
        return;
      }

      const activeGroupCode = profileData.group_id.trim();
      const [saccoRes, settingsRes] = await Promise.all([
        supabase
          .from('saccos')
          .select('id')
          .ilike('group_code', activeGroupCode)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('sacco_settings')
          .select('meeting_day')
          .ilike('group_code', activeGroupCode)
          .limit(1)
          .maybeSingle()
      ]);

      if (settingsRes.data?.meeting_day) {
        setSaccoMeetingDay(settingsRes.data.meeting_day);
      }

      if (!saccoRes.data) {
        setLoading(false);
        return;
      }

      const saccoId = saccoRes.data.id;

      const run = (columns: string) => {
        let query = supabase
          .from('transactions')
          .select(columns)
          .eq('sacco_id', saccoId)
          // Fines and loan application fees are pending transactions too, but neither is a
          // contribution awaiting verification: nobody is claiming to have paid them, and
          // each is confirmed from its own panel. A fee would also fail if approved here --
          // approve_member_transaction resolves an account by account_type = category and
          // there is no 'fee' account. Loan disbursements and repayments do belong here.
          .not('category', 'in', '("fines","fee")')
          .order('created_at', { ascending: false });

        if (pendingOnly) {
          query = query.eq('status', 'pending');
        }

        if (limit) {
          query = query.limit(limit);
        }

        return query;
      };

      const BASE_COLUMNS = `
          id,
          amount,
          category,
          status,
          created_at,
          profile_id,
          requested_by,
          description,
          profiles:profile_id (
            full_name,
            member_number
          )
      `;

      // share_count / unit_price arrive with migration 0033. Asking PostgREST for a column
      // that does not exist fails the WHOLE query, so on a database that has not had 0033
      // applied this table would go blank -- and an approvals queue that shows nothing is
      // indistinguishable from one with nothing in it. Fall back to the columns that have
      // always existed; `shareCountOf` then reads the count out of the description instead.
      let { data, error } = await run(`${BASE_COLUMNS}, share_count, unit_price`);

      if (error && (error.code === '42703' || error.code === 'PGRST204' || /share_count|unit_price/i.test(error.message || ''))) {
        console.warn('Approvals: share_count/unit_price missing — apply migration 0033.', error.message);
        ({ data, error } = await run(BASE_COLUMNS));
      }

      if (error) {
        console.error("Error fetching approval requests:", error);
      } else {
        setRequests((data as unknown as TransactionApprovalItem[]) || []);
      }
    } catch (err) {
      console.error("Unexpected error loading approvals:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();

    // The approvals queue is this SACCO's, so it watches every member of this group and
    // no member of any other.
    const unsubscribe = subscribeToOwnSaccoRows(
      ['transactions'],
      () => fetchRequests(),
      'admin-contribution-approvals'
    );

    function handleSettingsUpdate(e: any) {
      if (e.detail?.meetingDay) {
        setSaccoMeetingDay(e.detail.meetingDay);
      } else if (e.detail?.meeting_day) {
        setSaccoMeetingDay(e.detail.meeting_day);
      }
      fetchRequests();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
    }

    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
      }
    };
  }, [mode, limit]);

  const handleApprove = async (id: string) => {
    try {
      setMessage("");
      const { error } = await supabase.rpc('approve_member_transaction', {
        p_transaction_id: id
      });
      if (error) throw error;
      
      setMessage("Transaction approved successfully!");
      // In pending mode the row has just left the set this list represents, so drop it --
      // that keeps the visible rows equal to the number on the summary card.
      setRequests(prev => pendingOnly
        ? prev.filter(item => item.id !== id)
        : prev.map(item => item.id === id ? { ...item, status: 'completed' } : item));

      // The money just moved. Approving a loan spends the pot the line above the table
      // reports, and an admin working through a queue of them needs the next decision
      // measured against what is left, not against what there was when the page opened.
      refreshCapital();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
    } catch (err: any) {
      setMessage("Error approving request: " + (err.message || err));
    }
  };

  const handleReject = async (id: string) => {
    try {
      setMessage("");
      const { error } = await supabase.rpc('reject_member_transaction', {
        p_transaction_id: id
      });
      if (error) throw error;

      setMessage("Transaction rejected.");
      setRequests(prev => pendingOnly
        ? prev.filter(item => item.id !== id)
        : prev.map(item => item.id === id ? { ...item, status: 'rejected' } : item));

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
    } catch (err: any) {
      setMessage("Error rejecting request: " + (err.message || err));
    }
  };

  return (
    <div className="contribution-approvals-card card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 className="card-title">Contribution Approvals</h3>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.2rem", color: "#64748b" }}>
            {pendingOnly
              ? "Member shares, development and social fund contributions waiting for your decision."
              : "Review and approve pending member shares, development, and social fund contributions."}
          </p>
        </div>
        {showViewAll && (
          <Link href="/admin?tab=verifications" className="view-all-link">
            View All Approvals
          </Link>
        )}
      </div>

      {message && (
        <div style={{
          padding: "1rem",
          margin: "1rem 1.5rem",
          borderRadius: "0.8rem",
          fontSize: "1.3rem",
          fontWeight: 600,
          backgroundColor: message.includes("Error") ? "#fee2e2" : "#f0fdf4",
          color: message.includes("Error") ? "#ef4444" : "#16a34a"
        }}>
          {message}
        </div>
      )}

      {/* Shown only when there is a lending decision on this screen to make. On a queue of
          ordinary contributions the SACCO's cash position is not what the admin is being
          asked about, and a permanent money banner over every screen is a banner nobody
          reads by the time it matters. */}
      {capitalOnHand !== null && requests.some(
        r => r.category === 'loan_disbursement' && r.status === 'pending'
      ) && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "1.2rem 1.5rem",
          margin: "1rem 1.5rem 0",
          borderRadius: "0.8rem",
          fontSize: "1.3rem",
          backgroundColor: capitalOnHand > 0 ? "#eff6ff" : "#fef2f2",
          border: `1px solid ${capitalOnHand > 0 ? "#bfdbfe" : "#fecaca"}`,
          color: capitalOnHand > 0 ? "#1e40af" : "#b91c1c"
        }}>
          <i className="fa-solid fa-vault" style={{ fontSize: "1.6rem", flexShrink: 0 }}></i>
          <div>
            <strong>{formatSignedShs(capitalOnHand)} on hand.</strong>{" "}
            A loan approved here is paid out of this. Contributions and repayments add to
            it; the pot is not refilled by approving the loan.
          </div>
        </div>
      )}

      <div className="table-responsive" style={{ marginTop: "1rem" }}>
        <table className="approvals-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left", fontSize: "1.2rem", color: "#475569" }}>
              <th style={{ padding: "1.2rem 1.5rem" }}>Date</th>
              <th style={{ padding: "1.2rem 1.5rem" }}>Member</th>
              <th style={{ padding: "1.2rem 1.5rem" }}>Category</th>
              <th style={{ padding: "1.2rem 1.5rem" }}>Amount</th>
              <th style={{ padding: "1.2rem 1.5rem" }}>Status</th>
              <th style={{ padding: "1.2rem 1.5rem", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                  Loading approval requests...
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                  {pendingOnly
                    ? "No requests are waiting for your approval."
                    : "No transaction approval requests found."}
                </td>
              </tr>
            ) : (
              requests.map((request) => {
                const formattedMeetingDate = formatTransactionMeetingDate(request, saccoMeetingDay);
                let catLabel = request.category;
                if (catLabel === 'shares') catLabel = 'Shares Pool';
                if (catLabel === 'development_fund' || catLabel === 'devt') catLabel = 'Development Fund';
                if (catLabel === 'social_fund' || catLabel === 'social') catLabel = 'Social Fund';
                // Loan rows have always been in this queue (see the category filter in
                // fetchRequests) but fell through unlabelled, so an admin approving one
                // read the raw column name. They are the rows that move the most money.
                if (catLabel === 'loan_disbursement') catLabel = 'Loan Payout';
                if (catLabel === 'loan_repayment') catLabel = 'Loan Repayment';
                if (catLabel === 'savings') catLabel = 'Savings';

                const isPending = request.status === 'pending';
                const isApproved = request.status === 'approved' || request.status === 'completed';

                // An admin approving a shares request should see what the member actually
                // asked for -- so many shares at so much each -- not only the product. When
                // the two stop agreeing, this line is where it shows, and it is taken from
                // the request itself rather than from today's configured share price.
                const isShares = request.category === 'shares';
                const shareQty = isShares ? shareCountOf(request, 0) : 0;
                const shareUnit = isShares ? shareUnitPriceOf(request) : null;
                const shareBreakdown = isShares && shareQty > 0 && shareUnit
                  ? `${shareQty} × Shs ${formatShs(shareUnit)}`
                  : null;
                // Recorded money that is not the shares it claims to be. Only ever reachable
                // for rows written before the server started pricing shares itself.
                const shareMismatch = Boolean(
                  shareBreakdown && shareQty * shareUnit! !== Number(request.amount || 0)
                );

                // The database refuses this outright (0034, approve_member_transaction).
                // Saying so before the click rather than after is the difference between
                // a decision and an error message: the admin can chase the contributions
                // that would cover it instead of discovering the shortfall by hitting a
                // wall. The button stays enabled deliberately -- the authority to refuse
                // belongs to the database, and a disabled button here would be a second
                // copy of that rule, free to disagree with it.
                const isDisbursement = request.category === 'loan_disbursement';
                const exceedsCapital = Boolean(
                  isDisbursement && isPending && capitalOnHand !== null &&
                  !canFundLoan(request.amount, capitalOnHand)
                );

                return (
                  <tr key={request.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem", fontWeight: 600, color: "#1e293b", whiteSpace: "nowrap" }}>
                      {formattedMeetingDate}
                    </td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem" }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {request.profiles?.full_name || "Unknown Member"}
                      </div>
                      <div style={{ fontSize: "1.1rem", color: "#64748b" }}>
                        {request.profiles?.member_number || "MEM-000"}
                      </div>
                    </td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem" }}>
                      <span style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "0.6rem",
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        textTransform: "capitalize",
                        backgroundColor: catLabel === 'Shares Pool' ? '#ebf0fe' : catLabel.includes('Development') ? '#d1fae5' : '#fee2e2',
                        color: catLabel === 'Shares Pool' ? '#253b8e' : catLabel.includes('Development') ? '#047857' : '#b91c1c'
                      }}>
                        {catLabel}
                      </span>
                    </td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>
                      Shs {formatShs(request.amount)}
                      {shareBreakdown && (
                        <div style={{
                          fontSize: "1.1rem",
                          fontWeight: 600,
                          color: shareMismatch ? "#b91c1c" : "#64748b",
                          marginTop: "0.2rem"
                        }}>
                          {shareMismatch && (
                            <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.4rem" }}></i>
                          )}
                          {shareBreakdown}
                          {shareMismatch && " — does not match the amount"}
                        </div>
                      )}
                      {exceedsCapital && (
                        <div style={{
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: "#b91c1c",
                          marginTop: "0.2rem"
                        }}>
                          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.4rem" }}></i>
                          More than the SACCO holds — short by Shs{" "}
                          {formatShs(loanShortfall(request.amount, capitalOnHand ?? 0))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "1.2rem 1.5rem" }}>
                      <span style={{
                        padding: "0.4rem 0.8rem",
                        borderRadius: "2rem",
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        backgroundColor: isApproved ? '#d1fae5' : isPending ? '#fef3c7' : '#fee2e2',
                        color: isApproved ? '#047857' : isPending ? '#b45309' : '#b91c1c'
                      }}>
                        {request.status ? request.status.toUpperCase() : 'PENDING'}
                      </span>
                    </td>
                    <td style={{ padding: "1.2rem 1.5rem", textAlign: "right" }}>
                      {isPending ? (
                        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => handleApprove(request.id)}
                            style={{
                              padding: "0.5rem 1rem",
                              borderRadius: "0.6rem",
                              border: "none",
                              backgroundColor: "#10b981",
                              color: "white",
                              fontWeight: 700,
                              fontSize: "1.2rem",
                              cursor: "pointer"
                            }}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(request.id)}
                            style={{
                              padding: "0.5rem 1rem",
                              borderRadius: "0.6rem",
                              border: "none",
                              backgroundColor: "#ef4444",
                              color: "white",
                              fontWeight: 700,
                              fontSize: "1.2rem",
                              cursor: "pointer"
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: "1.2rem", color: "#94a3b8" }}>No action needed</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
