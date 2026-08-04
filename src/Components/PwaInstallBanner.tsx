"use client";

import React, { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * PwaInstallBanner component
 *
 * Captures `beforeinstallprompt` on Android, Chrome, Edge, and Desktop browsers,
 * or detects iOS Safari to provide step-by-step installation instructions.
 */
export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState<boolean>(false);
  const [isIos, setIsIos] = useState<boolean>(false);
  const [showIosGuide, setShowIosGuide] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Do not show if app is already running in standalone (installed) mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) return;

    // Check if user previously dismissed the prompt in this session/device
    const dismissedTime = localStorage.getItem("pewosa_pwa_prompt_dismissed");
    if (dismissedTime) {
      const daysSinceDismissed = (Date.now() - parseInt(dismissedTime, 10)) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        // Respect dismissal for 7 days
        return;
      }
    }

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const isIosDevice = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

    if (isIosDevice && isSafari) {
      setIsIos(true);
      setShowBanner(true);
      return;
    }

    // Listen for native beforeinstallprompt event on Android/Chrome/Edge/Desktop
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(!showIosGuide);
      return;
    }

    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pewosa_pwa_prompt_dismissed", Date.now().toString());
  };

  if (!showBanner) return null;

  return (
    <>
      {/* PWA Floating Install Banner */}
      <div style={styles.bannerContainer}>
        <div style={styles.bannerContent}>
          <img
            src="/icons/icon-192.png"
            alt="PEWOSA Icon"
            style={styles.appIcon}
            onError={(e) => {
              (e.target as HTMLImageElement).onerror = null;
              (e.target as HTMLImageElement).src = "/favicon.svg";
            }}
          />
          <div style={styles.textContainer}>
            <div style={styles.appTitle}>Install PEWOSA SACCO</div>
            <div style={styles.appSubtitle}>
              {isIos ? "Add to home screen for instant access" : "Fast, offline-capable mobile app"}
            </div>
          </div>
          <div style={styles.buttonGroup}>
            <button onClick={handleInstallClick} style={styles.installBtn}>
              <i className="fa-solid fa-download" style={{ marginRight: "0.6rem" }}></i>
              {isIos ? "Instructions" : "Install"}
            </button>
            <button onClick={handleDismiss} style={styles.dismissBtn} title="Dismiss prompt">
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        {/* iOS Step-by-Step Instructions Panel */}
        {isIos && showIosGuide && (
          <div style={styles.iosGuide}>
            <div style={styles.iosGuideStep}>
              <span style={styles.stepNum}>1</span> Tap the <strong>Share</strong> button{" "}
              <i className="fa-solid fa-share-nodes" style={{ color: "#253b8e" }}></i> in Safari.
            </div>
            <div style={styles.iosGuideStep}>
              <span style={styles.stepNum}>2</span> Scroll down and select <strong>&quot;Add to Home Screen&quot;</strong>.
            </div>
            <div style={styles.iosGuideStep}>
              <span style={styles.stepNum}>3</span> Launch PEWOSA directly from your phone home screen! 🎉
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bannerContainer: {
    position: "fixed",
    bottom: "2rem",
    left: "50%",
    transform: "translateX(-50%)",
    width: "calc(100% - 3.2rem)",
    maxWidth: "48rem",
    backgroundColor: "#ffffff",
    borderRadius: "1.6rem",
    boxShadow: "0 1rem 3rem rgba(37, 59, 142, 0.18), 0 0.2rem 0.8rem rgba(0, 0, 0, 0.08)",
    border: "1px solid rgba(37, 59, 142, 0.15)",
    padding: "1.4rem 1.8rem",
    zIndex: 9999,
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    animation: "slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
  },
  bannerContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1.2rem"
  },
  appIcon: {
    width: "4.4rem",
    height: "4.4rem",
    borderRadius: "1rem",
    objectFit: "cover",
    boxShadow: "0 0.2rem 0.6rem rgba(0, 0, 0, 0.1)",
    flexShrink: 0
  },
  textContainer: {
    flex: 1,
    minWidth: 0
  },
  appTitle: {
    fontSize: "1.45rem",
    fontWeight: 700,
    color: "#0f172a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  appSubtitle: {
    fontSize: "1.2rem",
    fontWeight: 500,
    color: "#64748b",
    marginTop: "0.2rem"
  },
  buttonGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.8rem",
    flexShrink: 0
  },
  installBtn: {
    backgroundColor: "#253b8e",
    color: "#ffffff",
    border: "none",
    borderRadius: "0.9rem",
    padding: "0.8rem 1.4rem",
    fontSize: "1.3rem",
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    boxShadow: "0 0.3rem 0.8rem rgba(37, 59, 142, 0.25)",
    transition: "background-color 0.2s"
  },
  dismissBtn: {
    backgroundColor: "transparent",
    color: "#94a3b8",
    border: "none",
    borderRadius: "50%",
    width: "3rem",
    height: "3rem",
    fontSize: "1.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "color 0.2s"
  },
  iosGuide: {
    marginTop: "1.4rem",
    paddingTop: "1.2rem",
    borderTop: "1px solid #f1f5f9",
    display: "flex",
    flexDirection: "column",
    gap: "0.8rem"
  },
  iosGuideStep: {
    fontSize: "1.25rem",
    color: "#334155",
    display: "flex",
    alignItems: "center",
    gap: "0.8rem"
  },
  stepNum: {
    backgroundColor: "#eef2ff",
    color: "#253b8e",
    fontWeight: 800,
    width: "2.2rem",
    height: "2.2rem",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.2rem",
    flexShrink: 0
  }
};
