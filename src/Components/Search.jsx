"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../context/ToastContext";
import "../styles/search.css";

const NAV_SHORTCUTS = [
  { name: "Overview Dashboard", path: "/dashboard", icon: "fa-solid fa-house" },
  { name: "Pools & Funds", path: "/savings", icon: "fa-solid fa-piggy-bank" },
  { name: "Shares Transactions", path: "/savings", icon: "fa-solid fa-chart-pie" },
  { name: "Loans & Repayments", path: "/loans", icon: "fa-solid fa-hand-holding-dollar" },
  { name: "Payments obligation portal", path: "/payments", icon: "fa-solid fa-money-bill-transfer" },
  { name: "Cooperative Members Directory", path: "/members", icon: "fa-solid fa-users" },
  { name: "Profile & Settings", path: "/settings", icon: "fa-solid fa-gears" }
];

export default function Search({ placeholder = "Search operations, transactions, pages..." }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [results, setResults] = useState({ navs: [], txs: [], loans: [] });
  const [kbdLabel, setKbdLabel] = useState("Ctrl K");

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
      setResults({ navs: [], txs: [], loans: [] });
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Perform search query against Navigation items & Supabase Tables
  const triggerSearch = async () => {
    setIsSearching(true);
    const searchVal = query.trim().toLowerCase();

    // 1. Filter local Navigation shortcuts
    const matchedNavs = NAV_SHORTCUTS.filter(item => 
      item.name.toLowerCase().includes(searchVal)
    );

    try {
      // Get session first
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setResults({ navs: matchedNavs, txs: [], loans: [] });
        return;
      }

      // 2. Fetch Matching Transactions
      const { data: txData } = await supabase
        .from("transactions")
        .select("*")
        .eq("profile_id", session.user.id)
        .or(`category.ilike.%${searchVal}%,description.ilike.%${searchVal}%,status.ilike.%${searchVal}%`)
        .limit(4);

      // 3. Fetch Matching Loans
      const { data: loanData } = await supabase
        .from("loans")
        .select("*")
        .eq("profile_id", session.user.id)
        .or(`purpose.ilike.%${searchVal}%,status.ilike.%${searchVal}%`)
        .limit(3);

      setResults({
        navs: matchedNavs,
        txs: txData || [],
        loans: loanData || []
      });

    } catch (err) {
      console.warn("Search fetch failed:", err);
      setResults({ navs: matchedNavs, txs: [], loans: [] });
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
    // Hide panel
    setShowDropdown(false);
    setQuery("");
    setIsExpanded(false);
    if (inputRef.current) inputRef.current.value = "";

    if (type === "nav") {
      router.push(item.path);
    } else if (type === "tx") {
      alert(`Transaction Detail:\n\nType: ${item.category.toUpperCase()}\nAmount: Shs ${Number(item.amount).toLocaleString()}\nStatus: ${item.status.toUpperCase()}\nDate: ${new Date(item.created_at).toLocaleDateString()}\nDescription: ${item.description || "N/A"}`);
      router.push("/savings"); // Redirect to savings view for details
    } else if (type === "loan") {
      alert(`Loan Request Detail:\n\nRequested: Shs ${Number(item.amount_requested).toLocaleString()}\nStatus: ${item.status.toUpperCase()}\nPurpose: ${item.purpose || "N/A"}\nDate: ${new Date(item.requested_at).toLocaleDateString()}`);
      router.push("/loans"); // Redirect to loans view for progress
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

  const hasResults = results.navs.length > 0 || results.txs.length > 0 || results.loans.length > 0;

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
              <span>No matching transactions, loans, or shortcuts found.</span>
            </div>
          ) : (
            <>
              {/* Navigation Group */}
              {results.navs.length > 0 && (
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

              {/* Transactions Group */}
              {results.txs.length > 0 && (
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
                            {tx.category.toUpperCase().replace("_", " ")}
                          </span>
                          <span className="search-dropdown-item-subtitle">
                            Shs {Number(tx.amount).toLocaleString()} • {new Date(tx.created_at).toLocaleDateString()}
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
              {results.loans.length > 0 && (
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
                            Loan: Shs {Number(loan.amount_requested).toLocaleString()}
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
