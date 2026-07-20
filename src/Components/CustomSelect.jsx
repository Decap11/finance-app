"use client";

import { useEffect, useState, useRef } from "react";
import "../styles/customSelect.css";

export default function CustomSelect({
  value,
  options = [],
  onChange,
  placeholder = "Select...",
  minWidth,
  maxWidth,
  className = "",
  darkTheme = false,
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  return (
    <div
      className={`custom-select-wrapper ${darkTheme ? "dark-theme" : ""} ${className} ${disabled ? "disabled" : ""}`}
      ref={dropdownRef}
      style={{ minWidth: minWidth || "100%", maxWidth }}
    >
      <button
        type="button"
        disabled={disabled}
        className={`custom-select-trigger ${open ? "active" : ""}`}
        onClick={() => !disabled && setOpen(!open)}
      >
        <span className="custom-select-label">{selectedOption ? selectedOption.label : placeholder}</span>
        <i className={`fa-solid fa-chevron-down custom-select-arrow ${open ? "open" : ""}`}></i>
      </button>

      {open && !disabled && (
        <div className="custom-select-dropdown">
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <div
                key={opt.value}
                className={`custom-select-option ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && <i className="fa-solid fa-check check-icon"></i>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
