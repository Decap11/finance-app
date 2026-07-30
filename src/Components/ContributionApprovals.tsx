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
          profiles:profile_id (
            full_name,
            member_number
          )
        `)
        .eq('sacco_id', saccoId)
        .order('created_at', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

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

    const channel = supabase
      .channel('admin-contribution-approvals-realtime')
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
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
      }
    };
  }, []);

  const handleApprove = async (id: string) => {
    try {
      setMessage("");
      const { error } = await supabase.rpc('approve_member_transaction', {
        p_transaction_id: id
      });
      if (error) throw error;
      
      setMessage("Transaction approved successfully!");
      setRequests(prev => prev.map(item => item.id === id ? { ...item, status: 'approved' } : item));

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
      setRequests(prev => prev.map(item => item.id === id ? { ...item, status: 'rejected' } : item));

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
            Review and approve pending member shares, development, and social fund contributions.
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
                  No transaction approval requests found.
                </td>
              </tr>
            ) : (
              requests.map((request) => {
                const formattedMeetingDate = formatTransactionMeetingDate(request, saccoMeetingDay);
                let catLabel = request.category;
                if (catLabel === 'shares') catLabel = 'Shares Pool';
                if (catLabel === 'development_fund' || catLabel === 'devt') catLabel = 'Development Fund';
                if (catLabel === 'social_fund' || catLabel === 'social') catLabel = 'Social Fund';

                const isPending = request.status === 'pending';
                const isApproved = request.status === 'approved' || request.status === 'completed';

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
                      Shs {Number(request.amount || 0).toLocaleString()}
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
