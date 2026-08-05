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

const MISSING_PROVIDER =
  "useToast() was called with no <ToastProvider> above it, so this message was never shown " +
  "to the user. ToastProvider wraps the whole app in src/app/layout.tsx.";

/**
 * What a caller gets when there is no provider: the message still reaches somewhere a
 * developer will look, on every level rather than only errors.
 *
 * Defined once at module scope rather than rebuilt per call, so it is referentially stable
 * -- an effect listing showToast in its dependencies would otherwise re-run on every render.
 */
const FALLBACK_TOAST = {
  showToast: (msg) => console.error(MISSING_PROVIDER, msg),
  showSuccess: (msg) => console.error(MISSING_PROVIDER, msg),
  showError: (msg) => console.error(MISSING_PROVIDER, msg),
  showInfo: (msg) => console.error(MISSING_PROVIDER, msg),
  showWarning: (msg) => console.error(MISSING_PROVIDER, msg)
};

export function useToast() {
  const context = useContext(ToastContext);
  if (context) return context;

  // Reaching here means the provider is missing from the tree.
  //
  // This used to route four of the five methods to console.log, which is how it went
  // unnoticed that the provider had never been mounted at all: every toast the app raised
  // -- confirmations and failures alike -- was written to a console nobody had open while
  // the screen said nothing. A silent fallback for a user-facing message is the wrong
  // default, so it now fails loudly in development.
  //
  // Production degrades rather than throwing: there is no error boundary in the app router
  // yet, so a throw here would replace a missing toast with a blank page, which is worse.
  if (process.env.NODE_ENV !== "production") {
    throw new Error(MISSING_PROVIDER);
  }

  return FALLBACK_TOAST;
}
