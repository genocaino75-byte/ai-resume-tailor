// theme.js
// Vibrant purple theme for Resume Tailor.
// Import these wherever you need consistent colors/fonts across the app.

export const theme = {
  colors: {
    purpleDark: "#3B0764",     // deep purple - gradient anchor, headers
    purpleMid: "#7C3AED",      // mid-tone purple - buttons, accents
    purpleLight: "#A855F7",    // lighter purple - highlights, hover states
    gradientStart: "#4C1D95",  // gradient top-left
    gradientEnd: "#7C3AED",    // gradient bottom-right
    accentYellow: "#FBBF24",   // pop accent color (badges, highlights)
    grayText: "#6B7280",       // secondary/muted body text
    background: "#F9FAFB",     // light neutral background for cards/content areas
    white: "#FFFFFF",
    success: "#10B981",
    border: "#E5E7EB",
  },
  gradients: {
    hero: "linear-gradient(135deg, #4C1D95 0%, #7C3AED 60%, #A855F7 100%)",
  },
  fonts: {
    heading: "'Poppins', system-ui, sans-serif",
    body: "'Inter', system-ui, sans-serif",
  },
  radius: "14px",
  spacing: {
    sm: "8px",
    md: "16px",
    lg: "24px",
    xl: "40px",
  },
};
