"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DataSet } from "vis-data";
import { Network, type Options } from "vis-network";
import "vis-network/styles/vis-network.css";
import {
  COMMUNITY_COLORS,
  type AnalyzeResult,
  type GraphLink,
  type GraphNode,
} from "@/lib/types";
import { Search, X } from "lucide-react";
import clsx from "clsx";

type Props = {
  result: AnalyzeResult;
  zoomEnabled: boolean;
};

type VisNode = {
  id: string;
  label: string;
  color: { background: string; border: string };
  size: number;
  font: { color: string; size: number };
  title: string;
  _community: number;
  _community_name: string;
  _source_file?: string;
  _file_type?: string;
  _degree: number;
};

function degreeMap(links: GraphLink[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of links) {
    d.set(e.source, (d.get(e.source) || 0) + 1);
    d.set(e.target, (d.get(e.target) || 0) + 1);
  }
  return d;
}

function buildVisData(nodes: GraphNode[], links: GraphLink[]) {
  const degrees = degreeMap(links);
  const communityNames = new Map<number, string>();
  for (const n of nodes) {
    const c = n.community ?? 0;
    if (!communityNames.has(c)) {
      communityNames.set(c, n.community_name || `Community ${c}`);
    }
  }

  const visNodes: VisNode[] = nodes.map((n) => {
    const c = n.community ?? 0;
    const color = COMMUNITY_COLORS[c % COMMUNITY_COLORS.length];
    const deg = degrees.get(n.id) || 0;
    return {
      id: n.id,
      label: n.label,
      color: { background: color, border: "#1c1917" },
      size: Math.min(28, 8 + Math.sqrt(deg) * 3.2),
      font: { color: "#1c1917", size: deg > 6 ? 13 : 11 },
      title: `${n.label}\n${n.source_file || ""}${n.source_location ? " " + n.source_location : ""}\nCommunity ${c}`,
      _community: c,
      _community_name: communityNames.get(c) || `Community ${c}`,
      _source_file: n.source_file,
      _file_type: n.file_type,
      _degree: deg,
    };
  });

  const visEdges = links.map((e, i) => {
    const conf = (e.confidence || "EXTRACTED").toUpperCase();
    const dashes = conf !== "EXTRACTED";
    const color =
      conf === "EXTRACTED" ? "#78716c" : conf === "INFERRED" ? "#0d9488" : "#d97706";
    return {
      id: i,
      from: e.source,
      to: e.target,
      title: `${e.relation || "related"} · ${conf}`,
      dashes,
      width: conf === "EXTRACTED" ? 1.2 : 1.6,
      color: { color, highlight: "#0f766e", hover: "#0f766e" },
      arrows: { to: { enabled: true, scaleFactor: 0.45 } },
      _confidence: conf,
      _relation: e.relation || "related",
    };
  });

  const legend = [...communityNames.entries()]
    .map(([id, name]) => ({
      id,
      name,
      color: COMMUNITY_COLORS[id % COMMUNITY_COLORS.length],
      count: nodes.filter((n) => (n.community ?? 0) === id).length,
    }))
    .sort((a, b) => b.count - a.count);

  return { visNodes, visEdges, legend, degrees };
}

export function GraphViewer({ result, zoomEnabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDSRef = useRef<DataSet<VisNode> | null>(null);
  const edgesDSRef = useRef<DataSet<Record<string, unknown>> | null>(null);
  const [selected, setSelected] = useState<VisNode | null>(null);
  const [neighbors, setNeighbors] = useState<{ id: string; label: string; color: string }[]>([]);
  const [query, setQuery] = useState("");
  const [activeCommunities, setActiveCommunities] = useState<Set<number>>(new Set());
  const [confidenceFilter, setConfidenceFilter] = useState<"ALL" | "EXTRACTED" | "INFERRED">(
    "ALL",
  );

  const prepared = useMemo(
    () => buildVisData(result.graph.nodes || [], result.graph.links || []),
    [result],
  );

  useEffect(() => {
    setActiveCommunities(new Set(prepared.legend.map((l) => l.id)));
  }, [prepared.legend]);

  useEffect(() => {
    if (!containerRef.current) return;

    const nodesDS = new DataSet(
      prepared.visNodes.map((n) => ({ ...n, hidden: false })),
    );
    const edgesDS = new DataSet(
      prepared.visEdges.map((e) => ({ ...e, hidden: false })),
    );
    nodesDSRef.current = nodesDS;
    edgesDSRef.current = edgesDS as DataSet<Record<string, unknown>>;

    const options: Options = {
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -55,
          centralGravity: 0.006,
          springLength: 110,
          springConstant: 0.08,
          damping: 0.42,
          avoidOverlap: 0.85,
        },
        stabilization: { iterations: 180, fit: true },
      },
      interaction: {
        hover: true,
        tooltipDelay: 80,
        hideEdgesOnDrag: true,
        zoomView: zoomEnabled,
        dragView: true,
      },
      nodes: { shape: "dot", borderWidth: 1.4 },
      edges: {
        smooth: { enabled: true, type: "continuous", roundness: 0.22 },
        selectionWidth: 3,
      },
    };

    const network = new Network(
      containerRef.current,
      { nodes: nodesDS, edges: edgesDS },
      options,
    );
    networkRef.current = network;

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
    });

    network.on("click", (params) => {
      if (params.nodes.length) {
        const id = String(params.nodes[0]);
        focusNode(id, nodesDS, network);
      }
    });

    return () => {
      network.destroy();
      networkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  useEffect(() => {
    networkRef.current?.setOptions({
      interaction: { zoomView: zoomEnabled },
    });
  }, [zoomEnabled]);

  useEffect(() => {
    const nodesDS = nodesDSRef.current;
    const edgesDS = edgesDSRef.current;
    if (!nodesDS || !edgesDS) return;

    const visible = new Set(
      prepared.visNodes
        .filter((n) => activeCommunities.has(n._community))
        .map((n) => n.id),
    );

    nodesDS.update(
      prepared.visNodes.map((n) => ({
        id: n.id,
        hidden: !visible.has(n.id),
      })),
    );

    edgesDS.update(
      prepared.visEdges.map((e) => {
        const confOk =
          confidenceFilter === "ALL" || e._confidence === confidenceFilter;
        const endsOk = visible.has(e.from) && visible.has(e.to);
        return { id: e.id, hidden: !(confOk && endsOk) };
      }),
    );
  }, [activeCommunities, confidenceFilter, prepared]);

  function focusNode(id: string, nodesDS?: DataSet<VisNode>, network?: Network) {
    const net = network || networkRef.current;
    const ds = nodesDS || nodesDSRef.current;
    if (!net || !ds) return;
    const n = ds.get(id);
    if (!n) return;
    setSelected(n);
    const neighborIds = net.getConnectedNodes(id).map(String);
    setNeighbors(
      neighborIds.map((nid) => {
        const nb = ds.get(nid);
        return {
          id: nid,
          label: nb?.label || nid,
          color: nb?.color?.background || "#78716c",
        };
      }),
    );
    net.focus(id, { scale: 1.35, animation: true });
    net.selectNodes([id]);
  }

  const searchHits = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return prepared.visNodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          (n._source_file || "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, prepared.visNodes]);

  function toggleCommunity(id: number) {
    setActiveCommunities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const githubBase = `https://github.com/${result.owner}/${result.repo}`;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[420px] flex-1 overflow-hidden bg-wire-paper">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(11,13,16,0.08) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div ref={containerRef} className="absolute inset-0" />
        {!zoomEnabled && (
          <div className="pointer-events-none absolute bottom-3 left-3 border border-wire-ink/10 bg-wire-paper/90 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-wire-mute backdrop-blur">
            Zoom disabled
          </div>
        )}
      </div>

      <aside className="flex w-full shrink-0 flex-col border-t border-wire-ink/10 bg-wire-paper lg:w-[320px] lg:border-l lg:border-t-0">
        <div className="border-b border-wire-ink/10 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wire-mute" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes…"
              className="w-full border border-wire-ink/15 bg-white py-2 pl-9 pr-8 text-sm outline-none focus:border-wire-ink"
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-wire-mute hover:text-wire-ink"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {searchHits.length > 0 && (
            <ul className="mt-2 max-h-36 overflow-auto border border-wire-ink/10">
              {searchHits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-wire-signal/30"
                    onClick={() => {
                      setQuery("");
                      focusNode(h.id);
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5"
                      style={{ background: h.color.background }}
                    />
                    <span className="truncate">{h.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-b border-wire-ink/10 p-4">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-wire-mute">
            Selected
          </h3>
          {selected ? (
            <div className="mt-2 space-y-1.5 text-sm text-wire-ink/80">
              <div className="font-display text-base font-bold text-wire-ink">{selected.label}</div>
              <div>Type: {selected._file_type || "unknown"}</div>
              <div>Community: {selected._community_name}</div>
              <div>Degree: {selected._degree}</div>
              {selected._source_file && (
                <a
                  href={`${githubBase}/blob/HEAD/${selected._source_file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block underline decoration-wire-signal decoration-2 underline-offset-2"
                >
                  {selected._source_file}
                </a>
              )}
              {neighbors.length > 0 && (
                <div className="pt-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-wire-mute">
                    Neighbors ({neighbors.length})
                  </div>
                  <div className="mt-1 max-h-28 overflow-auto">
                    {neighbors.map((nb) => (
                      <button
                        key={nb.id}
                        type="button"
                        onClick={() => focusNode(nb.id)}
                        className="my-0.5 flex w-full items-center gap-2 border-l-[3px] px-2 py-1 text-left text-xs hover:bg-wire-signal/25"
                        style={{ borderLeftColor: nb.color }}
                      >
                        {nb.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm italic text-wire-mute">Click a node to inspect it</p>
          )}
        </div>

        <div className="border-b border-wire-ink/10 p-4">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-wire-mute">
            Edge confidence
          </h3>
          <div className="mt-2 flex gap-1">
            {(["ALL", "EXTRACTED", "INFERRED"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConfidenceFilter(c)}
                className={clsx(
                  "px-2.5 py-1 text-[11px] font-semibold",
                  confidenceFilter === c
                    ? "bg-wire-ink text-wire-paper"
                    : "bg-wire-mist/50 text-wire-mute hover:bg-wire-mist",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-[11px] text-wire-mute">
            <div className="flex items-center gap-2">
              <span className="h-px w-5 bg-wire-mute" /> EXTRACTED (solid)
            </div>
            <div className="flex items-center gap-2">
              <span className="h-px w-5 border-t border-dashed border-wire-signalDeep" /> INFERRED
              (dashed)
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-wire-mute">
            Communities
          </h3>
          <ul className="mt-2 space-y-1">
            {prepared.legend.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggleCommunity(item.id)}
                  className={clsx(
                    "flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-xs transition",
                    activeCommunities.has(item.id)
                      ? "text-wire-ink hover:bg-wire-signal/25"
                      : "opacity-35 hover:opacity-60",
                  )}
                >
                  <span
                    className="h-3 w-3"
                    style={{ background: item.color }}
                  />
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="text-wire-mute">{item.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-wire-ink/10 px-4 py-3 font-mono text-[11px] text-wire-mute">
          {result.summary.node_count} nodes · {result.summary.edge_count} edges ·{" "}
          {result.summary.community_count} communities
        </div>
      </aside>
    </div>
  );
}
