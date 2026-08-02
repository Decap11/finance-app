"use client";

import { useEffect, useRef } from "react";
import "../styles/adminActionModal.css";

/**
 * Confirmation and result dialog for the admin Members tab, in place of window.confirm
 * and alert. One component covers both because the two are the same card with a
 * different footer -- an action always ends by replacing its confirm with a result, and
 * swapping the contents of one dialog avoids a flash of no-dialog in between.
 *
 * `modal` is null when nothing is open, otherwise:
 *   kind         "confirm" (Cancel + action) | "result" (single Close)
 *   tone         primary | success | danger | warning -- drives icon tint and button fill
 *   icon         Font Awesome class, without the "fa-solid " prefix
 *   title        short question or outcome
 *   message      string or node
 *   confirmLabel confirm only
 *   onConfirm    confirm only; may be async
 */
export default function AdminActionModal({ modal, busy = false, onClose }) {
  const confirmRef = useRef(null);
  const open = Boolean(modal);

  // Escape closes, and the page behind must not scroll while the overlay is up --
  // on touch devices a fixed overlay otherwise still drags the body underneath it.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      if (e.key === "Escape" && !busy) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, onClose]);

  // Move focus onto the dialog so Enter and Escape work without a click first, and a
  // screen reader announces the dialog rather than leaving the user on the card behind.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open, modal?.kind, modal?.title]);

  if (!modal) return null;

  const tone = modal.tone || "primary";
  const isConfirm = modal.kind === "confirm";

  return (
    <div
      className="aam-overlay"
      // A destructive action half-finished should not be dismissable by a stray click
      // outside the card, so backdrop dismissal is disabled while the RPC is in flight.
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        className="aam-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aam-title"
        aria-describedby="aam-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aam-body">
          <div className={`aam-icon tone-${tone}`}>
            <i className={`fa-solid ${modal.icon || "fa-circle-question"}`}></i>
          </div>
          <h2 className="aam-title" id="aam-title">{modal.title}</h2>
          <div className="aam-message" id="aam-message">{modal.message}</div>
        </div>

        <div className="aam-footer">
          {isConfirm && (
            <button
              type="button"
              className="aam-btn aam-btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            ref={confirmRef}
            className={`aam-btn aam-btn-solid tone-${tone}`}
            onClick={isConfirm ? modal.onConfirm : onClose}
            disabled={busy}
          >
            {busy && <span className="aam-spinner" aria-hidden="true"></span>}
            {isConfirm
              ? (busy ? "Working…" : modal.confirmLabel || "Confirm")
              : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
