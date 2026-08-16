import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        wire: {
          ink: "#0b0d10",
          paper: "#ffffff",
          mist: "#d7dde5",
          mute: "#5c6775",
          line: "#c5ced8",
          signal: "#b8ff3c",
          signalDeep: "#8fd414",
          ember: "#ff5a36",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        sans: ["var(--font-sans)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        serif: ["var(--font-serif)", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      },
      animation: {
        "fade-up": "fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fadeIn 0.6s ease-out both",
        "brand-in": "brandIn 1.1s cubic-bezier(0.16, 1, 0.3, 1) both",
        "signal-pulse": "signalPulse 2.8s ease-in-out infinite",
        "drift": "drift 18s linear infinite",
        "dash-flow": "dashFlow 1.2s linear infinite",
        "node-pulse": "nodePulse 2s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(22px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        brandIn: {
          "0%": { opacity: "0", transform: "translateY(28px) scale(0.98)", letterSpacing: "0.22em" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)", letterSpacing: "-0.04em" },
        },
        signalPulse: {
          "0%, 100%": { opacity: "0.45", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.08)" },
        },
        drift: {
          "0%": { transform: "translate3d(0,0,0)" },
          "100%": { transform: "translate3d(-4%, 3%, 0)" },
        },
        dashFlow: {
          "0%": { strokeDashoffset: "24" },
          "100%": { strokeDashoffset: "0" },
        },
        nodePulse: {
          "0%, 100%": { opacity: "0.35", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(1.08)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
