"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";
import { formatTransactionMeetingDate } from "../utils/meetingDateUtils";
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
}

export default function ContributionApprovals({ limit, showViewAll }: ContributionApprovalsProps) {
  const [requests, setRequests] = useState<TransactionApprovalItem[]>([]);
  const [saccoMeetingDay, setSaccoMeetingDay] = useState<string>("Wednesday");
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");

  async function fetchRequests() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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

      let query = supabase
        .from('transactions')
        .select(`
          id,
          amount,
          category,
          status,
          created_at,
          profile_id,
          requested_by,
          description,
          profiles!transactions_profile_id_fkey (
            full_name,
            member_number
          ),
          requester:profiles!transactions_requested_by_fkey (
            full_name
          )
        `)
        .eq('sacco_id', saccoId)
        .in('status', ['pending', 'approved', 'rejected', 'completed'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      if (limit) {
        query = query.limit(limit);
      } else {
        query = query.limit(50);
      }

      const { data, error } = await query;

      if (data && !error) {
        setRequests(data as unknown as TransactionApprovalItem[]);
      }
    } catch (err) {
      console.warn("Error loading approvals list:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();

    const channel = supabase
      .channel('admin-transactions-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleApprove = async (transactionId: string) => {
    setRequests(prev => prev.map(req => req.id === transactionId ? { ...req, status: 'completed' } : req));
    setMessage("Approving...");
    try {
      const { error: rpcError } = await supabase.rpc('approve_transaction', {
        p_transaction_id: transactionId
      });

      if (rpcError) {
        console.warn("RPC approval failed, falling back to direct table update:", rpcError.message);
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', transactionId);

      if (updateError) throw updateError;

      setMessage("Transaction approved and completed!");
      fetchRequests();
    } catch (err: unknown) {
      const errObj = err as Error;
      setMessage(`Error: ${errObj.message}`);
      fetchRequests();
    }
  };

  const handleReject = async (transactionId: string) => {
    setRequests(prev => prev.map(req => req.id === transactionId ? { ...req, status: 'rejected' } : req));
    setMessage("Rejecting...");
    try {
      const { error: rpcError } = await supabase.rpc('reject_transaction', {
        p_transaction_id: transactionId
      });

      if (rpcError) {
        console.warn("RPC rejection failed, falling back to direct table update:", rpcError.message);
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'rejected' })
        .eq('id', transactionId);

      if (updateError && rpcError) throw new Error(rpcError.message || updateError.message);

      setMessage("Transaction rejected.");
      fetchRequests();
    } catch (err: unknown) {
      const errObj = err as Error;
      setMessage(`Error: ${errObj.message}`);
      fetchRequests();
    }
  };

  return (
    <div className="recent-transactions recent-transactions-verifications">
      <MainHeader showViewAll={showViewAll} />

      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: '#f3f4f6', textAlign: 'center' }}>
          {message}
        </div>
      )}

      <div className="admin-list-wrapper">
        <div className="admin-list-header">
          <div className="col-member">Member ID</div>
          <div className="col-type">Request Type</div>
          <div className="col-amount">Amount</div>
          <div className="col-date">Date</div>
          <div className="col-action" style={{ textAlign: "center" }}>Action</div>
        </div>
        <ul className="admin-list">
          {loading ? (
            <li className="list-empty">Loading...</li>
          ) : requests.length === 0 ? (
            <li className="list-empty">No pending requests.</li>
          ) : (
            requests.map((request) => {
              const formattedMeetingDate = formatTransactionMeetingDate(request, saccoMeetingDay);

              let displayType = request.category;
              if (displayType === "social_fund") displayType = "Social Fund";
              if (displayType === "development_fund") displayType = "Dev Fund";
              if (displayType === "shares") displayType = "Shares Pool";
              if (displayType === "savings") displayType = "Savings";
              if (displayType === "loan_disbursement") displayType = "Loan Request";

              return (
                <li key={request.id} className="admin-list-item">
                  <div className="col-member">
                    <div className="member-id-cell">
                      <span className="member-id-number">{request.profiles?.member_number || "N/A"}</span>
                      <span className="member-name-sub">{request.profiles?.full_name || "Unknown"}</span>
                      {request.requester && request.requested_by !== request.profile_id && (
                        <span style={{ fontSize: "1.1rem", color: "var(--primary-color)", fontWeight: 600, display: "block", marginTop: "0.2rem" }}>
                          Req by: {request.requester.full_name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-type">
                    <span className={`badge badge-${displayType.toLowerCase().replace(" ", "-")}`}>
                      {displayType.toUpperCase()}
                    </span>
                  </div>
                  <div className="col-amount">
                    <strong className="amount-text">
                      <span className="currency-unit">Shs </span>
                      {Number(request.amount).toLocaleString()}
                    </strong>
                  </div>
                  <div className="col-date">
                    <span className="date-text">
                      <span className="date-day-month">{formattedMeetingDate}</span>
                    </span>
                  </div>
                  <div className="col-action">
                    <div className="table-actions" style={{ display: "flex", justifyContent: "center" }}>
                      {request.status === 'pending' ? (
                        <>
                          <button className="btn-sm btn-approve" onClick={() => handleApprove(request.id)} title="Approve">
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button className="btn-sm btn-reject" onClick={() => handleReject(request.id)} title="Reject">
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </>
                      ) : (
                        <span
                          className={`badge badge-${(request.status === 'approved' || request.status === 'completed') ? 'success' : 'danger'}`}
                          style={{
                            padding: "0.4rem 0.8rem",
                            borderRadius: "0.6rem",
                            fontSize: "1.1rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            background: (request.status === 'approved' || request.status === 'completed') ? '#f0fdf4' : '#fef2f2',
                            color: (request.status === 'approved' || request.status === 'completed') ? '#22c55e' : '#ef4444'
                          }}
                        >
                          {(request.status === 'approved' || request.status === 'completed') ? 'Completed' : 'Rejected'}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

function MainHeader({ showViewAll }: { showViewAll?: boolean }) {
  return (
    <div className="section-header">
      <h3 className="section-title">Pending Contribution Approvals</h3>
      {showViewAll && (
        <Link href="/admin?tab=verifications" className="view-all-link">View All</Link>
      )}
    </div>
  );
}
