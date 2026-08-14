"use client";

import { useEffect, useRef } from "react";

type Node = { x: number; y: number; vx: number; vy: number; r: number };
type Edge = { a: number; b: number };

/** Animated knowledge-graph plane — sized to its parent, not the window. */
export function WireCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let raf = 0;
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent!.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(48, Math.max(12, Math.floor((w * h) / 28000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1.5 + Math.random() * 2.5,
      }));
      edges = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          if (Math.random() > 0.92) edges.push({ a: i, b: j });
        }
      }
      while (edges.length < count * 1.4) {
        const a = Math.floor(Math.random() * count);
        let b = Math.floor(Math.random() * count);
        if (a !== b) edges.push({ a, b });
      }
    }

    function tick() {
      ctx!.clearRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;
      }

      ctx!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 160) {
            const alpha = (1 - dist / 160) * 0.28;
            ctx!.strokeStyle = `rgba(11, 13, 16, ${alpha})`;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 280) continue;
        ctx!.strokeStyle = "rgba(184, 255, 60, 0.22)";
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const signal = i % 7 === 0;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r * (signal ? 1.35 : 1), 0, Math.PI * 2);
        ctx!.fillStyle = signal ? "#b8ff3c" : "rgba(11, 13, 16, 0.55)";
        ctx!.fill();
        if (signal) {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, n.r * 3.2, 0, Math.PI * 2);
          ctx!.fillStyle = "rgba(184, 255, 60, 0.12)";
          ctx!.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    }

    resize();
    tick();
    const ro = new ResizeObserver(() => resize());
    ro.observe(parent);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-70 animate-drift"
    />
  );
}
