"use client";

import { DotOrbit } from "@paper-design/shaders-react";

/**
 * Animated avatar tile for a repository — a tiny Paper "Dot Orbit" shader
 * on the app's ink background. The same owner/repo always maps to the
 * same color palette.
 */

const PALETTES: string[][] = [
  ["#ffc96b", "#ff6200", "#ff2f00"], // ember
  ["#93c5fd", "#3b82f6", "#1d4ed8"], // blue
  ["#c4b5fd", "#8b5cf6", "#6d28d9"], // violet
  ["#5eead4", "#14b8a6", "#0f766e"], // teal
  ["#d9f99d", "#84cc16", "#4d7c0f"], // lime
  ["#fda4af", "#f43f5e", "#be123c"], // rose
  ["#a5f3fc", "#06b6d4", "#0e7490"], // cyan
  ["#a5b4fc", "#6366f1", "#4338ca"], // indigo
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function RepoAvatar({
  owner,
  repo,
  size = 28,
  className,
}: {
  owner: string;
  repo: string;
  label?: string;
  size?: number;
  className?: string;
}) {
  const h = hashString(`${owner}/${repo}`);
  const colors = PALETTES[h % PALETTES.length]!;
  // Slight per-repo motion variation so tiles don't move in lockstep.
  const speed = 0.7 + (h % 5) * 0.15;

  return (
    <span
      aria-hidden
      className={`relative shrink-0 overflow-hidden rounded-md border border-black/10 ${className ?? ""}`}
      style={{ width: size, height: size, backgroundColor: "#0b0d10" }}
    >
      <DotOrbit
        colors={colors}
        colorBack="#0b0d10"
        size={0.9}
        sizeRange={0.3}
        spreading={1}
        stepsPerColor={3}
        speed={speed}
        scale={0.12}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </span>
  );
}
