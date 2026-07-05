// SplashScreen.jsx
// Auto-continuing animated splash screen for Resume Tailor.
// Vibrant purple gradient version.

import { useEffect, useState } from "react";
import { theme } from "./theme";

const DISPLAY_DURATION_MS = 3000;

function SplashScreen({ onComplete }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fadeInTimer = setTimeout(() => setVisible(true), 50);
    const completeTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, DISPLAY_DURATION_MS);

    return () => {
      clearTimeout(fadeInTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: theme.gradients.hero,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.85)",
          transition: "opacity 0.5s ease, transform 0.5s ease",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: theme.spacing.md,
        }}
      >
        <svg width="88" height="88" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <rect width="512" height="512" rx="96" fill="#FBBF24" />
          <rect x="160" y="120" width="192" height="272" rx="12" fill="none" stroke="#3B0764" strokeWidth="14" />
          <line x1="196" y1="188" x2="316" y2="188" stroke="#3B0764" strokeWidth="12" strokeLinecap="round" />
          <line x1="196" y1="228" x2="316" y2="228" stroke="#3B0764" strokeWidth="12" strokeLinecap="round" />
          <line x1="196" y1="268" x2="280" y2="268" stroke="#3B0764" strokeWidth="12" strokeLinecap="round" />
          <circle cx="256" cy="332" r="34" fill="#3B0764" />
          <path d="M242 332 L252 342 L272 320" stroke="#FBBF24" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>

        <h1
          style={{
            fontFamily: theme.fonts.heading,
            fontSize: "30px",
            fontWeight: 500,
            color: "#FFFFFF",
            margin: 0,
            letterSpacing: "0.5px",
          }}
        >
          Resume Tailor
        </h1>

        <div
          style={{
            width: "36px",
            height: "3px",
            borderRadius: "2px",
            backgroundColor: "rgba(255,255,255,0.25)",
            overflow: "hidden",
            marginTop: theme.spacing.sm,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: theme.colors.accentYellow,
              transformOrigin: "left",
              animation: "loadBar 2.8s ease-in-out forwards",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes loadBar {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}

export default SplashScreen;
