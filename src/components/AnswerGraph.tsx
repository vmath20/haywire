"use client";

import { useEffect, useMemo, useRef } from "react";
import { DataSet } from "vis-data";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";
import clsx from "clsx";
import type { AnalyzeResult } from "@/lib/types";
import type { TraversalPath } from "@/lib/traversal";
import { githubBlobUrl } from "@/lib/githubLinks";

/**
 * Answer map — the subgraph of code entities that actually ground the
 * answer. Nodes cited in the answer text are filled; supporting context
 * nodes are hollow. Node color = source file.
 */

const FILE_COLORS = [
  "#ff5a36", // ember
  "#d97706", // amber
  "#8b5cf6", // violet
  "#db2777", // pink
  "#78716c", // warm gray
  "#ca8a04", // gold
];
const EDGE_IDLE = "#e4e6ea";
const EDGE_HL = "#0b0d10";
const LABEL_DIM = "#a7adb5";
const LABEL_LIT = "#0b0d10";
const MAX_NODES = 20;

type Candidate = {
  id: string;
  label: string;
  file: string;
  seed: boolean;
  mentioned: boolean;
  score: number;
};

/** Parse `NODE label [src=path loc=Lnn]` lines into label → path/line. */
function parseLocs(graphContext: string): Map<string, { path: string; line?: number }> {
  const map = new Map<string, { path: string; line?: number }>();
  const re = /^NODE\s+(.+?)\s+\[src=([^\s\]]+)(?:\s+loc=L(\d+))?/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(graphContext)) !== null) {
    const line = Number(m[3]);
    map.set(m[1]!.trim(), {
      path: m[2]!.trim(),
      line: Number.isFinite(line) ? line : undefined,
    });
  }
  return map;
}

function fileBasename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function AnswerGraph({
  owner,
  repo,
  result,
  traversal,
  graphContext,
  answerBody,
  heightClass = "h-[26rem]",
}: {
  owner: string;
  repo: string;
  result: AnalyzeResult;
  traversal: TraversalPath;
  graphContext: string;
  answerBody: string;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const locs = useMemo(() => parseLocs(graphContext), [graphContext]);

  const { nodes, links, files } = useMemo(() => {
    const nodeById = new Map(result.graph.nodes.map((n) => [n.id, n]));
    const seedSet = new Set(traversal.seeds);
    const answer = answerBody || "";

    // Score every visited node: cited in answer ≫ seed ≫ shallow depth.
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const step of traversal.visitOrder) {
      if (seen.has(step.id)) continue;
      seen.add(step.id);
      const graphNode = nodeById.get(step.id);
      const label = step.label || graphNode?.label || step.id;
      const file =
        step.sourceFile || graphNode?.source_file || locs.get(label)?.path || "";
      const mentioned =
        label.length >= 3 && answer.includes(label.length > 40 ? label.slice(0, 40) : label);
      const seed = seedSet.has(step.id);
      const score =
        (mentioned ? 8 : 0) + (seed ? 4 : 0) + Math.max(0, 2 - step.depth);
      candidates.push({ id: step.id, label, file, seed, mentioned, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    let picked = candidates.slice(0, MAX_NODES);

    // Drop isolated low-value nodes: keep anything mentioned/seeded, or connected.
    const pickedIds = new Set(picked.map((c) => c.id));
    const connected = new Set<string>();
    const allEdges = [
      ...result.graph.links.map((l) => ({
        from: l.source,
        to: l.target,
        relation: l.relation ?? "",
      })),
      ...traversal.edges.map((e) => ({ from: e.from, to: e.to, relation: "" })),
    ];
    for (const e of allEdges) {
      if (pickedIds.has(e.from) && pickedIds.has(e.to)) {
        connected.add(e.from);
        connected.add(e.to);
      }
    }
    picked = picked.filter((c) => c.mentioned || c.seed || connected.has(c.id));
    const finalIds = new Set(picked.map((c) => c.id));

    // Dedupe edges between the final node set.
    const edgeKeys = new Set<string>();
    const finalLinks: { from: string; to: string; relation: string }[] = [];
    for (const e of allEdges) {
      if (!finalIds.has(e.from) || !finalIds.has(e.to) || e.from === e.to) continue;
      const key = `${e.from}->${e.to}`;
      const rev = `${e.to}->${e.from}`;
      if (edgeKeys.has(key) || edgeKeys.has(rev)) continue;
      edgeKeys.add(key);
      finalLinks.push(e);
    }

    // Color files by how many picked nodes they contain.
    const fileCounts = new Map<string, number>();
    for (const c of picked) {
      if (c.file) fileCounts.set(c.file, (fileCounts.get(c.file) ?? 0) + 1);
    }
    const orderedFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([path], i) => ({
        path,
        color: FILE_COLORS[i % FILE_COLORS.length]!,
      }));

    return { nodes: picked, links: finalLinks, files: orderedFiles };
  }, [result, traversal, answerBody, locs]);

  const fileColor = useMemo(() => {
    const map = new Map(files.map((f) => [f.path, f.color]));
    return (path: string) => map.get(path) ?? "#9ca3af";
  }, [files]);

  // Content signature: rebuild the network only when the picked subgraph
  // actually changes, not when parent re-renders hand us new object identities.
  const buildSig = useMemo(
    () =>
      `${nodes
        .map((n) => `${n.id}:${n.mentioned ? 1 : 0}:${n.seed ? 1 : 0}:${n.file}`)
        .join("|")}//${links.map((e) => `${e.from}>${e.to}`).join("|")}`,
    [nodes, links],
  );
  const networkRef = useRef<Network | null>(null);
  const builtSigRef = useRef<string | null>(null);
  const fitTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
      networkRef.current?.destroy();
      networkRef.current = null;
      builtSigRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;
    if (builtSigRef.current === buildSig && networkRef.current) return;
    builtSigRef.current = buildSig;
    if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
    networkRef.current?.destroy();
    networkRef.current = null;

    const visNodes = nodes.map((n) => {
      const color = fileColor(n.file);
      const filled = n.mentioned || n.seed;
      return {
        id: n.id,
        label: n.label.length > 30 ? `${n.label.slice(0, 28)}…` : n.label,
        title: `${n.label}${n.file ? `\n${n.file}` : ""}${n.mentioned ? "\ncited in answer" : ""}`,
        shape: "dot",
        size: n.seed ? 12 : n.mentioned ? 10 : 6.5,
        color: {
          background: filled ? color : "#ffffff",
          border: color,
          highlight: { background: filled ? color : "#ffffff", border: "#0b0d10" },
        },
        borderWidth: filled ? 1.5 : 1.25,
        font: {
          color: n.mentioned || n.seed ? LABEL_LIT : LABEL_DIM,
          size: n.mentioned || n.seed ? 10.5 : 9.5,
          face: "inherit",
          vadjust: -2,
        },
      };
    });

    const visEdges = links.map((e, i) => ({
      id: `e-${i}`,
      from: e.from,
      to: e.to,
      title: e.relation || undefined,
      color: { color: EDGE_IDLE, highlight: EDGE_HL },
      width: 0.8,
      arrows: { to: { enabled: true, scaleFactor: 0.35 } },
      smooth: { enabled: true, type: "continuous", roundness: 0.2 },
    }));

    const nodesDS = new DataSet(visNodes);
    const edgesDS = new DataSet(visEdges);

    const network = new Network(
      containerRef.current,
      { nodes: nodesDS, edges: edgesDS },
      {
        autoResize: true,
        physics: {
          enabled: true,
          solver: "forceAtlas2Based",
          forceAtlas2Based: {
            gravitationalConstant: -60,
            centralGravity: 0.008,
            springLength: 110,
            springConstant: 0.07,
            damping: 0.6,
            avoidOverlap: 1,
          },
          stabilization: { iterations: 150, fit: true },
        },
        interaction: { hover: true, zoomView: true, dragView: true },
        layout: { improvedLayout: true, randomSeed: 7 },
        nodes: { widthConstraint: { maximum: 150 } },
      },
    );

    const fitAll = () => {
      try {
        network.fit({ animation: false });
        const scale = network.getScale();
        network.moveTo({ scale: scale * 0.86, animation: false });
      } catch {
        // ignore empty graph
      }
    };
    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
      fitAll();
      fitTimerRef.current = window.setTimeout(fitAll, 50);
    });

    // Click a node → open the symbol on GitHub when we know its location.
    const labelById = new Map(nodes.map((n) => [n.id, n.label]));
    network.on("doubleClick", (params: { nodes: (string | number)[] }) => {
      const id = params.nodes[0];
      if (id == null) return;
      const label = labelById.get(String(id));
      const loc = label ? locs.get(label) : undefined;
      if (loc) {
        window.open(githubBlobUrl(owner, repo, loc.path, loc.line), "_blank");
      }
    });

    networkRef.current = network;
  }, [buildSig, nodes, links, fileColor, locs, owner, repo]);

  if (nodes.length === 0) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center rounded-xl border border-black/[0.08] bg-white",
          heightClass,
        )}
      >
        <p className="text-[12px] font-light text-[#9ca3af]">
          No graph evidence for this answer.
        </p>
      </div>
    );
  }

  const citedCount = nodes.filter((n) => n.mentioned).length;

  return (
    <div
      className={clsx(
        "relative w-full overflow-hidden rounded-xl border border-black/[0.08] bg-white",
        heightClass,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top overlay: what this map shows */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <span className="pointer-events-auto rounded-full border border-black/[0.07] bg-white/85 px-2.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#6b7280] backdrop-blur-sm">
          answer map · {citedCount ? `${citedCount} cited · ` : ""}
          {nodes.length} nodes
        </span>
        <span className="pointer-events-none rounded-full border border-black/[0.07] bg-white/85 px-2.5 py-1.5 text-[10px] font-light text-[#9ca3af] backdrop-blur-sm">
          filled = cited · double-click opens source
        </span>
      </div>

      {/* Bottom overlay: file legend */}
      {files.length ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          {files.slice(0, 5).map((f) => (
            <span
              key={f.path}
              title={f.path}
              className="inline-flex items-center gap-1.5 text-[10px] font-light text-[#6b7280]"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: f.color }}
              />
              <span className="max-w-[10rem] truncate font-mono text-[9.5px]">
                {fileBasename(f.path)}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
