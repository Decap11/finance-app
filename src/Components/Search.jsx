"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../context/ToastContext";
import "../styles/search.css";

const MEMBER_NAV_SHORTCUTS = [
  { name: "Overview Dashboard", path: "/dashboard", icon: "fa-solid fa-house" },
  { name: "Savings & Shares", path: "/savings", icon: "fa-solid fa-piggy-bank" },
  { name: "Loans & Repayments", path: "/loans", icon: "fa-solid fa-hand-holding-dollar" },
  { name: "Payments & Obligations", path: "/payments", icon: "fa-solid fa-money-bill-transfer" },
  { name: "Members Directory", path: "/members", icon: "fa-solid fa-users" },
  { name: "Account Settings", path: "/settings", icon: "fa-solid fa-gears" }
];

const ADMIN_NAV_SHORTCUTS = [
  { name: "Admin Dashboard", path: "/admin?tab=overview", icon: "fa-solid fa-gauge-high" },
  { name: "Pending Approvals", path: "/admin?tab=verifications", icon: "fa-solid fa-clock-rotate-left" },
  { name: "SACCO Members Directory", path: "/admin?tab=members", icon: "fa-solid fa-users-gear" },
  { name: "Subscription & Payments", path: "/admin?tab=payments", icon: "fa-solid fa-credit-card" },
  { name: "SACCO Group Settings", path: "/admin?tab=settings", icon: "fa-solid fa-sliders" }
];

export default function Search({ placeholder = "Search operations, members, transactions..." }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [results, setResults] = useState({ navs: [], members: [], txs: [], loans: [] });
  const [kbdLabel, setKbdLabel] = useState("Ctrl K");
  const [userRole, setUserRole] = useState("member");

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const router = useRouter();

  // Detect OS platform & Listen for global Ctrl+K / Cmd+K / '/' hotkeys
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0 || navigator.userAgent.includes("Macintosh");
      setKbdLabel(isMac ? "⌘K" : "Ctrl K");
    }

    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsExpanded(true);
        setShowDropdown(true);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        !document.activeElement?.isContentEditable
      ) {
        e.preventDefault();
        setIsExpanded(true);
        setShowDropdown(true);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
      } else if (e.key === "Escape") {
        setShowDropdown(false);
        setIsExpanded(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Search trigger on query input changes
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults({ navs: [], members: [], txs: [], loans: [] });
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Context-Aware Dual Search Engine (Admin vs Member scope)
  const triggerSearch = async () => {
    setIsSearching(true);
    const searchVal = query.trim().toLowerCase();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setResults({ navs: [], members: [], txs: [], loans: [] });
        setIsSearching(false);
        return;
      }

      // 1. Fetch user profile to check role and group_id
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, group_id")
        .eq("id", session.user.id)
        .single();

      const isAdmin = profile?.role === "admin";
      setUserRole(profile?.role || "member");
      const groupId = profile?.group_id;

      // Select navigation shortcuts list
      const navList = isAdmin ? ADMIN_NAV_SHORTCUTS : MEMBER_NAV_SHORTCUTS;
      const matchedNavs = navList.filter(item => item.name.toLowerCase().includes(searchVal));

      let saccoId = null;
      if (groupId) {
        const { data: saccoData } = await supabase
          .from("saccos")
          .select("id")
          .eq("group_code", groupId)
          .single();
        if (saccoData) saccoId = saccoData.id;
      }

      // 2. Fetch matching SACCO members in group
      let matchedMembers = [];
      if (groupId) {
        const { data: memberData } = await supabase
          .from("profiles")
          .select("id, full_name, member_number, phone, role, email")
          .eq("group_id", groupId)
          .or(`full_name.ilike.%${searchVal}%,member_number.ilike.%${searchVal}%,phone.ilike.%${searchVal}%,email.ilike.%${searchVal}%`)
          .limit(4);
        matchedMembers = memberData || [];
      }

      // 3. Fetch matching transactions (Admin searches all SACCO txs, Member searches own txs)
      let txQuery = supabase.from("transactions").select("*");
      if (isAdmin && saccoId) {
        txQuery = txQuery.eq("sacco_id", saccoId);
      } else {
        txQuery = txQuery.eq("profile_id", session.user.id);
      }
      const { data: txData } = await txQuery
        .or(`category.ilike.%${searchVal}%,description.ilike.%${searchVal}%,status.ilike.%${searchVal}%`)
        .limit(4);

      // 4. Fetch matching loans (Admin searches all SACCO loans, Member searches own loans)
      let loanQuery = supabase.from("loans").select("*");
      if (isAdmin && saccoId) {
        loanQuery = loanQuery.eq("sacco_id", saccoId);
      } else {
        loanQuery = loanQuery.eq("profile_id", session.user.id);
      }
      const { data: loanData } = await loanQuery
        .or(`purpose.ilike.%${searchVal}%,status.ilike.%${searchVal}%`)
        .limit(3);

      setResults({
        navs: matchedNavs,
        members: matchedMembers,
        txs: txData || [],
        loans: loanData || []
      });

    } catch (err) {
      console.warn("Context search fetch failed:", err);
      setResults({ navs: [], members: [], txs: [], loans: [] });
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    if (!isExpanded) {
      setIsExpanded(true);
      setShowDropdown(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      if (!query) {
        setIsExpanded(false);
        setShowDropdown(false);
      }
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    setIsExpanded(false);
    setShowDropdown(false);
    setQuery("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleItemClick = (type, item) => {
    setShowDropdown(false);
    setQuery("");
    setIsExpanded(false);
    if (inputRef.current) inputRef.current.value = "";

    if (type === "nav") {
      router.push(item.path);
    } else if (type === "member") {
      router.push(userRole === "admin" ? "/admin?tab=members" : "/members");
    } else if (type === "tx") {
      alert(`Transaction Detail:\n\nType: ${item.category.toUpperCase()}\nAmount: Shs ${Number(item.amount).toLocaleString()}\nStatus: ${item.status.toUpperCase()}\nDate: ${new Date(item.created_at).toLocaleDateString()}\nDescription: ${item.description || "N/A"}`);
      router.push(userRole === "admin" ? "/admin?tab=verifications" : "/transactions");
    } else if (type === "loan") {
      alert(`Loan Detail:\n\nRequested Amount: Shs ${Number(item.amount_requested).toLocaleString()}\nStatus: ${item.status.toUpperCase()}\nPurpose: ${item.purpose || "N/A"}\nDate: ${new Date(item.requested_at).toLocaleDateString()}`);
      router.push("/loans");
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const hasResults =
    (results.navs && results.navs.length > 0) ||
    (results.members && results.members.length > 0) ||
    (results.txs && results.txs.length > 0) ||
    (results.loans && results.loans.length > 0);

  return (
    <div
      ref={containerRef}
      className={`search-container ${isExpanded ? "expanded" : ""}`}
    >
      <button
        type="button"
        className="search-toggle-btn"
        onClick={handleToggle}
        aria-label="Toggle search input"
      >
        <i className="fa-solid fa-magnifying-glass" />
      </button>

      <div className="search-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            setIsExpanded(true);
            setShowDropdown(true);
          }}
        />
        <kbd className="search-kbd">{kbdLabel}</kbd>
        {isExpanded && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={handleClose}
            aria-label="Clear search"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
      </div>

      {/* Global Results Dropdown Panel */}
      {showDropdown && query.trim().length >= 2 && (
        <div className="search-dropdown">
          {isSearching ? (
            <div className="search-loader">
              <i className="fa-solid fa-circle-notch fa-spin" />
            </div>
          ) : !hasResults ? (
            <div className="search-dropdown-empty">
              <i className="fa-solid fa-magnifying-glass-minus" style={{ color: "var(--text-light)" }} />
              <span>No matching members, transactions, loans, or shortcuts found.</span>
            </div>
          ) : (
            <>
              {/* Navigation Group */}
              {results.navs && results.navs.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-header">Navigation Shortcuts</div>
                  <div className="search-dropdown-list">
                    {results.navs.map((item, idx) => (
                      <button
                        key={`nav-${idx}`}
                        className="search-dropdown-item"
                        onClick={() => handleItemClick("nav", item)}
                      >
                        <i className={item.icon} />
                        <div className="search-dropdown-item-details">
                          <span className="search-dropdown-item-title">{item.name}</span>
                          <span className="search-dropdown-item-subtitle">Direct Nav Link</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Members Group */}
              {results.members && results.members.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-header">SACCO Group Members</div>
                  <div className="search-dropdown-list">
                    {results.members.map((member) => (
                      <button
                        key={member.id}
                        className="search-dropdown-item"
                        onClick={() => handleItemClick("member", member)}
                      >
                        <i className="fa-solid fa-user-gear" style={{ color: "#3b82f6" }} />
                        <div className="search-dropdown-item-details">
                          <span className="search-dropdown-item-title">
                            {member.full_name || "Unknown Member"}
                          </span>
                          <span className="search-dropdown-item-subtitle">
                            ID: {member.member_number || "N/A"} • Phone: {member.phone || "N/A"}
                          </span>
                        </div>
                        <span className={`search-dropdown-item-badge ${member.role === 'admin' ? 'warn' : 'info'}`}>
                          {member.role ? member.role.toUpperCase() : "MEMBER"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Transactions Group */}
              {results.txs && results.txs.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-header">Matching Transactions</div>
                  <div className="search-dropdown-list">
                    {results.txs.map((tx) => (
                      <button
                        key={tx.id}
                        className="search-dropdown-item"
                        onClick={() => handleItemClick("tx", tx)}
                      >
                        <i className="fa-solid fa-money-bill-wave" style={{ color: "#10b981" }} />
                        <div className="search-dropdown-item-details">
                          <span className="search-dropdown-item-title">
                            {tx.category ? tx.category.toUpperCase().replace("_", " ") : "TRANSACTION"}
                          </span>
                          <span className="search-dropdown-item-subtitle">
                            Shs {Number(tx.amount || 0).toLocaleString()} • {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <span className={`search-dropdown-item-badge ${tx.status === 'approved' || tx.status === 'completed' ? 'success' : tx.status === 'pending' ? 'info' : 'warn'}`}>
                          {tx.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Loans Group */}
              {results.loans && results.loans.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-header">Matching Active Loans</div>
                  <div className="search-dropdown-list">
                    {results.loans.map((loan) => (
                      <button
                        key={loan.id}
                        className="search-dropdown-item"
                        onClick={() => handleItemClick("loan", loan)}
                      >
                        <i className="fa-solid fa-hand-holding-dollar" style={{ color: "#8b5cf6" }} />
                        <div className="search-dropdown-item-details">
                          <span className="search-dropdown-item-title">
                            Loan: Shs {Number(loan.amount_requested || 0).toLocaleString()}
                          </span>
                          <span className="search-dropdown-item-subtitle">
                            Purpose: {loan.purpose || "Obligations Setup"}
                          </span>
                        </div>
                        <span className={`search-dropdown-item-badge ${loan.status === 'approved' || loan.status === 'active' || loan.status === 'disbursed' ? 'success' : loan.status === 'pending' ? 'info' : 'warn'}`}>
                          {loan.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
