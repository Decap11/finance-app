"use client";

import { createContext, useContext, useState, useCallback } from "react";
import "../styles/toast.css";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = "info", duration = 4000) => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const showSuccess = useCallback((msg, duration) => showToast(msg, "success", duration), [showToast]);
  const showError = useCallback((msg, duration) => showToast(msg, "error", duration), [showToast]);
  const showInfo = useCallback((msg, duration) => showToast(msg, "info", duration), [showToast]);
  const showWarning = useCallback((msg, duration) => showToast(msg, "warning", duration), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo, showWarning }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card toast-${t.type}`}>
            <div className="toast-icon">
              {t.type === "success" && <i className="fa-solid fa-circle-check"></i>}
              {t.type === "error" && <i className="fa-solid fa-circle-xmark"></i>}
              {t.type === "warning" && <i className="fa-solid fa-triangle-exclamation"></i>}
              {t.type === "info" && <i className="fa-solid fa-circle-info"></i>}
            </div>
            <div className="toast-content">{t.message}</div>
            <button className="toast-close" onClick={() => removeToast(t.id)}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if component is rendered outside provider
    return {
      showToast: (msg) => console.log("[Toast]", msg),
      showSuccess: (msg) => console.log("[Toast Success]", msg),
      showError: (msg) => console.error("[Toast Error]", msg),
      showInfo: (msg) => console.log("[Toast Info]", msg),
      showWarning: (msg) => console.warn("[Toast Warning]", msg),
    };
  }
  return context;
}
