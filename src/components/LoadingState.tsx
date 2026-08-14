"use client";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label. Reduced motion freezes
 * the grid to its dim state.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<
  string,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export function LoadingState({
  label = "Wiring up",
  variant = "Drive",
  size = "md",
}: {
  label?: string;
  variant?: string;
  size?: "md" | "sm";
}) {
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive!;
  const sm = size === "sm";

  return (
    <div className={`flex w-fit items-center ${sm ? "gap-3" : "gap-4"}`}>
      <span
        aria-hidden
        className={`grid ${sm ? "grid-cols-[repeat(3,7px)] gap-[2px]" : "grid-cols-[repeat(3,10px)] gap-[3px]"}`}
      >
        {delays.map((d, i) => (
          <span
            key={i}
            className={`pixel-cell ${sm ? "size-[7px] rounded-[1.5px]" : "size-[10px] rounded-[2px]"} bg-wire-ink ${round ? "rounded-full" : ""}`}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation:
                d === null
                  ? "none"
                  : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className={`shimmer-label bg-clip-text font-medium tracking-[-0.01em] text-transparent ${sm ? "text-[13.5px]" : "text-[19px]"}`}
        style={{
          backgroundImage:
            "linear-gradient(90deg, #9aa3ad 35%, #0b0d10 50%, #9aa3ad 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Compact deletion variant — same pixel grid, but the cells dissolve
 * outward from the center (center → edges → corners), tinted ember.
 */
export function DeletingState({ label = "Deleting" }: { label?: string }) {
  // Ring index per cell of the 3x3 grid: center 0, edges 1, corners 2.
  const rings = [2, 1, 2, 1, 0, 1, 2, 1, 2];

  return (
    <div className="flex w-fit items-center gap-3">
      <span aria-hidden className="grid grid-cols-[repeat(3,7px)] gap-[2px]">
        {rings.map((ring, i) => (
          <span
            key={i}
            className="size-[7px] rounded-[1.5px] bg-wire-ember"
            style={{
              opacity: 0.85,
              animation: `pixel-off 1100ms ease-in-out ${ring * 140}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className="shimmer-label bg-clip-text text-[13px] font-medium tracking-[-0.01em] text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, #b3796c 35%, #ff5a36 50%, #b3796c 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Full-area centered variant — used as the universal route preview page. */
export function LoadingPage({ label }: { label?: string }) {
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center bg-white py-24">
      <LoadingState label={label} />
    </div>
  );
}

export default LoadingState;
