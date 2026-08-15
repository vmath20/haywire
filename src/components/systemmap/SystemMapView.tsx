"use client";

/**
 * Full-screen isometric system-map viewer: a top stats bar, module registry
 * on the left, the IsoScene canvas in the middle, and a WHAT IT DOES /
 * HOW IT'S BUILT explainer panel on the right. Styled to match the app's
 * light paper-and-ink theme with the lime signal accent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  layoutByFlow,
  normalizeSpec,
  LAYOUT_VERSION,
  type SystemMapSpec,
  type MapFlow,
  type MapModule,
} from "@/lib/systemMap";
import { IsoScene } from "./IsoScene";
import { LoadingState } from "@/components/LoadingState";

const GEN_PHRASES = [
  "Cloning the repository…",
  "Parsing symbols…",
  "Tracing dependencies…",
  "Clustering modules…",
  "Raising buildings…",
  "Routing payload lanes…",
  "Writing the field notes…",
];

function GeneratingScreen({
  status,
  note,
  logs,
}: {
  status: string;
  note?: string;
  logs?: string[];
}) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % GEN_PHRASES.length), 2600);
    return () => clearInterval(t);
  }, []);
  const recent = (logs ?? []).slice(-6);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-white px-6">
      <LoadingState label={status} />
      <p className="text-xs text-wire-mute">{note || GEN_PHRASES[phrase]}</p>
      {recent.length > 0 ? (
        <pre className="max-h-40 w-full max-w-lg overflow-y-auto rounded-md border border-black/10 bg-[#fafafa] px-3 py-2 font-mono text-[10px] leading-relaxed text-wire-mute">
          {recent.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-4 font-mono text-[9.5px] uppercase tracking-[0.2em] text-wire-mute/70">
      {children}
    </p>
  );
}

function FileChip({ name }: { name: string }) {
  const short = name.split("/").pop() || name;
  return (
    <span
      title={name}
      className="inline-block rounded-sm bg-[#f4f4f5] px-1.5 py-0.5 font-mono text-[10px] text-wire-mute"
    >
      {short}
    </span>
  );
}

function isDroppedConnection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m === "failed to fetch" ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("aborted") ||
    m.includes("network request failed")
  );
}

async function readMapResponse(res: Response): Promise<{
  spec?: SystemMapSpec;
  detail?: string;
  building?: boolean;
}> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { spec?: SystemMapSpec; detail?: string; building?: boolean };
  } catch {
    if (res.status === 504 || res.status === 524 || res.status === 502) {
      throw new Error("Map generation timed out. Retrying…");
    }
    throw new Error(`Map generation failed (${res.status || "network"})`);
  }
}

type MapStreamEvent =
  | { type: "log"; message: string }
  | { type: "status"; status: string; note?: string }
  | { type: "building"; detail?: string }
  | { type: "done"; spec: SystemMapSpec }
  | { type: "error"; detail: string };

async function consumeMapStream(
  res: Response,
  onEvent: (ev: MapStreamEvent) => void,
): Promise<MapStreamEvent> {
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("event-stream") || !res.body) {
    const data = await readMapResponse(res);
    if (data.building) return { type: "building", detail: data.detail };
    if (data.spec) return { type: "done", spec: data.spec };
    return {
      type: "error",
      detail: data.detail || `Map generation failed (${res.status})`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last: MapStreamEvent | null = null;

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    try {
      const ev = JSON.parse(line.slice(6)) as MapStreamEvent;
      last = ev;
      onEvent(ev);
    } catch (err) {
      console.warn("[map] bad SSE line", line.slice(0, 200), err);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) handleLine(line);
    }
  }
  if (buf.trim()) {
    for (const line of buf.split("\n")) handleLine(line);
  }
  if (last) return last;
  throw new Error("Map stream ended without a result");
}

export function SystemMapView({ owner, repo }: { owner: string; repo: string }) {
  const { isAuthenticated } = useConvexAuth();
  const saved = useQuery(
    api.maps.getByRepo,
    isAuthenticated ? { owner, repo } : "skip",
  );
  const savedGraph = useQuery(
    api.graphs.getByRepo,
    isAuthenticated ? { owner, repo } : "skip",
  );
  const example = useQuery(api.examples.getByRepo, { owner, repo });
  const saveMap = useMutation(api.maps.save);
  const touchMap = useMutation(api.maps.touch);

  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("Analyzing repository");
  const [genNote, setGenNote] = useState<string | undefined>(undefined);
  const [genLogs, setGenLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const spec: SystemMapSpec | null = useMemo(() => {
    if (!saved?.spec) return null;
    try {
      const parsed = JSON.parse(saved.spec) as SystemMapSpec;
      return normalizeSpec(
        parsed,
        parsed.owner || owner,
        parsed.repo || repo,
        parsed.model,
        { preserveLayout: true },
      );
    } catch {
      return null;
    }
  }, [saved, owner, repo]);

  const specKey = spec ? `${spec.owner}/${spec.repo}:${spec.generatedAt}` : "";
  const specKeyRef = useRef("");
  const [modules, setModules] = useState<MapModule[]>([]);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistModules = useCallback(
    (next: MapModule[]) => {
      if (!spec) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void saveMap({
          owner,
          repo,
          label: repo,
          spec: JSON.stringify({ ...spec, modules: next, layoutVersion: LAYOUT_VERSION }),
          model: spec.model,
        });
      }, 450);
    },
    [spec, owner, repo, saveMap],
  );

  useEffect(() => {
    if (!spec) return;
    if (specKeyRef.current === specKey) return;
    specKeyRef.current = specKey;
    const needsLayout = spec.layoutVersion !== LAYOUT_VERSION;
    const next = needsLayout ? layoutByFlow(spec.modules, spec.flows) : spec.modules;
    setModules(next);
    if (needsLayout) persistModules(next);
  }, [spec, specKey, persistModules]);

  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      setModules((prev) => {
        const cur = prev.find((m) => m.id === id);
        if (!cur || (cur.x === x && cur.y === y)) return prev;
        const next = prev.map((m) => (m.id === id ? { ...m, x, y } : m));
        persistModules(next);
        return next;
      });
    },
    [persistModules],
  );

  const handleResetLayout = useCallback(() => {
    if (!spec) return;
    const next = layoutByFlow(modules.length ? modules : spec.modules, spec.flows);
    setModules(next);
    persistModules(next);
  }, [spec, modules, persistModules]);

  // View state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [traceIndex, setTraceIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<"what" | "how">("what");
  const [resetNonce, setResetNonce] = useState(0);

  const liveSpec: SystemMapSpec | null = spec
    ? { ...spec, modules: modules.length ? modules : spec.modules }
    : null;

  const flows = spec?.flows ?? [];
  const activeFlow: MapFlow | null =
    flows.find((f) => f.id === activeFlowId) ?? flows[0] ?? null;

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setGenStatus("Analyzing repository");
    setGenNote(undefined);
    setGenLogs([]);
    const logs: string[] = [];
    const pushLog = (message: string) => {
      const line = `${new Date().toISOString().slice(11, 19)} ${message}`;
      logs.push(line);
      console.info("[map]", message);
      setGenLogs([...logs]);
      setGenNote(message);
    };
    try {
      const graphUrl = savedGraph?.graphUrl || example?.graphUrl || null;
      pushLog(`Start ${owner}/${repo}${graphUrl ? " (saved graph)" : ""}`);
      for (let attempt = 0; attempt < 30; attempt++) {
        let res: Response;
        try {
          pushLog(`POST /api/map attempt ${attempt + 1}`);
          res = await fetch("/api/map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, repo, graph_url: graphUrl }),
          });
          pushLog(`HTTP ${res.status} ${res.headers.get("content-type") || ""}`);
        } catch (err) {
          const cause =
            err instanceof Error && "cause" in err && err.cause instanceof Error
              ? `${err.cause.name}: ${err.cause.message}`
              : "";
          const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          pushLog(`Fetch threw ${msg}${cause ? ` (${cause})` : ""}`);
          if (isDroppedConnection(err) && attempt < 2) {
            setGenStatus("Reconnecting");
            await new Promise((r) => setTimeout(r, 4000));
            continue;
          }
          throw new Error(
            `Could not reach /api/map (${msg}). See the log below and the browser console ([map]).`,
          );
        }

        const ev = await consumeMapStream(res, (event) => {
          if (event.type === "log") pushLog(event.message);
          if (event.type === "status") {
            setGenStatus(event.status);
            if (event.note) setGenNote(event.note);
          }
        });

        if (ev.type === "building") {
          setGenStatus("Building code graph");
          pushLog(ev.detail || "Graph is still being built");
          await new Promise((r) => setTimeout(r, 12_000));
          continue;
        }
        if (ev.type === "error") {
          pushLog(`Error: ${ev.detail}`);
          throw new Error(ev.detail);
        }
        if (ev.type !== "done" || !ev.spec) {
          throw new Error("Map generation returned no spec");
        }

        setGenStatus("Saving map");
        pushLog(`Saving ${ev.spec.modules.length} modules, ${ev.spec.flows.length} flows`);
        await saveMap({
          owner,
          repo,
          label: repo,
          spec: JSON.stringify(ev.spec),
          model: ev.spec.model,
        });
        pushLog("Saved");
        return;
      }
      throw new Error(
        "The code graph is taking unusually long to build. Leave this page open and try again in a few minutes.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Map generation failed";
      pushLog(`Failed: ${message}`);
      setError(`${message}\n\n${logs.slice(-12).join("\n")}`);
    } finally {
      setGenerating(false);
    }
  }, [owner, repo, savedGraph, example, saveMap]);

  // Kick off generation when there is no saved map yet.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (saved === undefined || savedGraph === undefined || example === undefined) return;
    if (saved !== null || startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [isAuthenticated, saved, savedGraph, example, generate]);

  // Bump lastViewedAt once when opening an existing map.
  const touchedRef = useRef(false);
  useEffect(() => {
    if (spec && !touchedRef.current) {
      touchedRef.current = true;
      void touchMap({ owner, repo });
    }
  }, [spec, owner, repo, touchMap]);

  const selectedModule =
    liveSpec?.modules.find((m) => m.id === selectedId) ?? null;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-white px-8">
        <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-wire-ember">
          Map generation failed
        </p>
        <p className="max-w-lg whitespace-pre-wrap text-left text-sm leading-relaxed text-wire-mute">
          {error}
        </p>
        <button
          type="button"
          onClick={() => {
            startedRef.current = false;
            void generate();
          }}
          className="mt-2 border-2 border-wire-ink/20 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-wire-ink transition hover:border-wire-ink"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!liveSpec || generating) {
    return (
      <GeneratingScreen
        status={generating ? genStatus : "Loading map"}
        note={generating ? genNote : undefined}
        logs={generating ? genLogs : undefined}
      />
    );
  }

  const stats = liveSpec.stats.slice(0, 4);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-wire-ink">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-stretch border-b border-black/10">
        <div className="flex min-w-0 flex-col justify-center border-r border-black/10 px-4 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-wire-mute/70">
            Repository
          </p>
          <p className="truncate font-mono text-[12.5px] font-semibold text-wire-ink">
            {owner}/{repo}
          </p>
        </div>
        {stats.map((s) => (
          <div
            key={s.label}
            className="hidden flex-col justify-center border-r border-black/10 px-4 py-2.5 md:flex"
          >
            <p className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.22em] text-wire-mute/70">
              {s.label}
            </p>
            <p className="font-mono text-[12.5px] text-wire-ink">{s.value}</p>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2 px-3">
          {flows.length > 0 ? (
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-wire-mute/70">
              Flow
              <select
                value={activeFlow?.id ?? ""}
                onChange={(e) => {
                  setActiveFlowId(e.target.value);
                  setTraceIndex(null);
                  setSelectedId(null);
                }}
                className="border-2 border-wire-ink/20 bg-white px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-wire-ink outline-none transition focus:border-wire-ink"
              >
                {flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="border-2 border-wire-ink/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-wire-ink transition hover:border-wire-ink"
          >
            {paused ? "Resume flow" : "Pause flow"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!activeFlow) return;
              setPaused(true);
              setTraceIndex((i) =>
                i === null ? 0 : (i + 1) % activeFlow.steps.length,
              );
            }}
            className="hidden border-2 border-wire-ink/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-wire-ink transition hover:border-wire-ink sm:block"
          >
            Trace one step
          </button>
          <button
            type="button"
            onClick={() => {
              setResetNonce((n) => n + 1);
              setTraceIndex(null);
              setPaused(false);
              setSelectedId(null);
            }}
            className="border-2 border-wire-ink/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-wire-ink transition hover:border-wire-ink"
          >
            Reset view
          </button>
          <button
            type="button"
            onClick={handleResetLayout}
            className="border-2 border-wire-ink/20 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-wire-ink transition hover:border-wire-ink"
          >
            Reset layout
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* left: module registry */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-black/10 pb-4 lg:block">
          {liveSpec.categories.map((cat, catIndex) => {
            const mods = liveSpec.modules.filter((m) => m.category === cat.id);
            if (mods.length === 0) return null;
            return (
              <div key={cat.id}>
                <SectionLabel>{cat.label}</SectionLabel>
                <ul className="space-y-1 px-2">
                  {mods.map((m) => {
                    const active = m.id === selectedId;
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(active ? null : m.id);
                            setTab("what");
                          }}
                          className={`flex w-full items-center gap-2 border px-2 py-1.5 text-left transition ${
                            active
                              ? "border-wire-ink bg-[#f4f4f5] text-wire-ink"
                              : "border-black/10 text-wire-mute hover:border-wire-ink/40 hover:text-wire-ink"
                          }`}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              background: ["#8fd414", "#98a2af", "#c4a06a", "#7a8eaa", "#a1a1aa"][
                                catIndex % 5
                              ],
                            }}
                          />
                          <span className="w-6 shrink-0 font-mono text-[9.5px] font-semibold tracking-[0.08em] text-wire-mute/70">
                            {m.id}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                          <span className="font-mono text-[9.5px] text-wire-mute/60">
                            {m.stack}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </aside>

        {/* center: isometric canvas */}
        <div className="relative min-w-0 flex-1 bg-[#fcfcfd]">
          <div className="pointer-events-none absolute left-4 top-3 z-10">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-wire-mute/70">
              Runtime topology · drag buildings to rearrange
            </p>
            <p className="font-display text-[15px] font-bold tracking-tight text-wire-ink">
              {activeFlow?.name ?? liveSpec.title}
            </p>
          </div>
          <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-wire-signalDeep" />
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-wire-mute/70">
              payloads in motion
            </span>
          </div>

          <IsoScene
            modules={liveSpec.modules}
            flows={flows}
            categories={liveSpec.categories}
            activeFlow={activeFlow}
            paused={paused}
            traceIndex={traceIndex}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setTab("what");
            }}
            onMove={handleMove}
            resetNonce={resetNonce}
          />

          {/* legend */}
          <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex items-center gap-4 font-mono text-[9.5px] uppercase tracking-[0.14em] text-wire-mute">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-5 bg-wire-signalDeep" /> flow
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-5"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg,#9aa4b1 0 5px,transparent 5px 9px)",
                }}
              />{" "}
              retry
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-wire-signalDeep" />{" "}
              payload
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-5"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg,#b3bcc7 0 2px,transparent 2px 6px)",
                }}
              />{" "}
              feedback
            </span>
          </div>
        </div>

        {/* right: explainer panel */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-black/10 md:flex">
          <div className="flex shrink-0 border-b border-black/10">
            <button
              type="button"
              onClick={() => setTab("what")}
              className={`flex-1 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                tab === "what"
                  ? "bg-wire-ink font-semibold text-white"
                  : "text-wire-mute hover:text-wire-ink"
              }`}
            >
              What it does
            </button>
            <button
              type="button"
              onClick={() => setTab("how")}
              className={`flex-1 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] transition ${
                tab === "how"
                  ? "bg-wire-ink font-semibold text-white"
                  : "text-wire-mute hover:text-wire-ink"
              }`}
            >
              How it&apos;s built
            </button>
          </div>

          <div className="min-h-0 flex-1 px-4 pb-6">
            {selectedModule ? (
              <>
                <SectionLabel>Selected module</SectionLabel>
                <p className="px-3 font-display text-[15px] font-bold leading-snug tracking-tight text-wire-ink">
                  {selectedModule.name}
                </p>
                <p className="mt-3 whitespace-pre-line px-3 text-[12px] leading-relaxed text-wire-mute">
                  {tab === "what"
                    ? selectedModule.what
                    : selectedModule.how || "No implementation notes generated."}
                </p>
                {selectedModule.files.length > 0 ? (
                  <>
                    <SectionLabel>Source</SectionLabel>
                    <div className="flex flex-wrap gap-1.5 px-3">
                      {selectedModule.files.map((f) => (
                        <FileChip key={f} name={f} />
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : activeFlow ? (
              <>
                <SectionLabel>Selected flow</SectionLabel>
                <p className="px-3 font-display text-[15px] font-bold leading-snug tracking-tight text-wire-ink">
                  {activeFlow.name}
                </p>
                {activeFlow.tagline ? (
                  <p className="mt-2 px-3 font-mono text-[11px] leading-relaxed text-wire-mute/80">
                    {activeFlow.tagline}
                  </p>
                ) : null}
                <div className="mx-3 my-3 border-t border-black/10" />
                <p className="whitespace-pre-line px-3 text-[12px] leading-relaxed text-wire-mute">
                  {tab === "what" ? activeFlow.what || liveSpec.what : liveSpec.how}
                </p>
                {activeFlow.sources.length > 0 ? (
                  <>
                    <SectionLabel>Source</SectionLabel>
                    <div className="flex flex-wrap gap-1.5 px-3">
                      {activeFlow.sources.map((f) => (
                        <FileChip key={f} name={f} />
                      ))}
                    </div>
                  </>
                ) : null}
                <SectionLabel>Payload</SectionLabel>
                <div className="px-3">
                  <span className="inline-block bg-wire-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-wire-ink">
                    {activeFlow.payload}
                  </span>
                </div>
              </>
            ) : (
              <>
                <SectionLabel>{liveSpec.title}</SectionLabel>
                <p className="whitespace-pre-line px-3 text-[12px] leading-relaxed text-wire-mute">
                  {tab === "what" ? liveSpec.what : liveSpec.how}
                </p>
              </>
            )}

            {!selectedModule ? (
              <>
                <div className="mx-3 my-4 border-t border-black/10" />
                <p className="px-3 font-mono text-[10px] leading-relaxed tracking-[0.06em] text-wire-mute/70">
                  {liveSpec.tagline}
                </p>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {/* ── Bottom hint bar ─────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-black/10 px-4 py-1.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-wire-mute/70">
          drag a building to rearrange · click to inspect · pause the flow · trace one step
        </p>
        <p className="hidden font-mono text-[9.5px] uppercase tracking-[0.18em] text-wire-mute/50 sm:block">
          drag empty grid to pan · scroll to zoom
        </p>
      </footer>
    </div>
  );
}
