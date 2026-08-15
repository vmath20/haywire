"use client";

/**
 * Full-screen isometric system-map viewer: dark control-room layout with a
 * top stats bar, module registry on the left, the IsoScene canvas in the
 * middle, and a WHAT IT DOES / HOW IT'S BUILT explainer panel on the right.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { SystemMapSpec, MapFlow } from "@/lib/systemMap";
import { IsoScene } from "./IsoScene";

const GEN_PHRASES = [
  "cloning repository…",
  "parsing symbols…",
  "tracing dependencies…",
  "clustering modules…",
  "raising buildings…",
  "routing payload lanes…",
  "writing the field notes…",
];

function GeneratingScreen({ status }: { status: string }) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % GEN_PHRASES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0a0d12] font-mono">
      <div className="flex items-end gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-3 rounded-[2px]"
            style={{
              height: `${14 + (i % 3) * 10}px`,
              backgroundColor: "#232b3c",
              animation: `map-slab 1.4s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
      <p className="text-[12px] uppercase tracking-[0.22em] text-[#8b96a9]">{status}</p>
      <p className="text-[11px] tracking-[0.12em] text-[#4c5568]">{GEN_PHRASES[phrase]}</p>
      <style>{`@keyframes map-slab { 0%,100% { transform: scaleY(0.5); opacity: 0.4; } 50% { transform: scaleY(1); opacity: 1; } }`}</style>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-4 text-[9.5px] uppercase tracking-[0.2em] text-[#4c5568]">
      {children}
    </p>
  );
}

function FileChip({ name }: { name: string }) {
  const short = name.split("/").pop() || name;
  return (
    <span
      title={name}
      className="inline-block rounded-sm bg-[#1a212f] px-1.5 py-0.5 text-[10px] text-[#9aa7bd]"
    >
      {short}
    </span>
  );
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
  const [genStatus, setGenStatus] = useState("analyzing repository");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const spec: SystemMapSpec | null = useMemo(() => {
    if (!saved?.spec) return null;
    try {
      return JSON.parse(saved.spec) as SystemMapSpec;
    } catch {
      return null;
    }
  }, [saved]);

  // View state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [traceIndex, setTraceIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<"what" | "how">("what");
  const [resetNonce, setResetNonce] = useState(0);

  const flows = spec?.flows ?? [];
  const activeFlow: MapFlow | null =
    flows.find((f) => f.id === activeFlowId) ?? flows[0] ?? null;

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setGenStatus("analyzing repository");
    try {
      const graphUrl = savedGraph?.graphUrl || example?.graphUrl || null;
      // Retry loop: the backend may still be building the code graph.
      for (let attempt = 0; attempt < 30; attempt++) {
        const res = await fetch("/api/map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo, graph_url: graphUrl }),
        });
        if (res.status === 202) {
          setGenStatus("building the code graph — this can take a few minutes");
          await new Promise((r) => setTimeout(r, 12_000));
          continue;
        }
        const data = (await res.json()) as {
          spec?: SystemMapSpec;
          detail?: string;
        };
        if (!res.ok || !data.spec) {
          throw new Error(data.detail || `Map generation failed (${res.status})`);
        }
        setGenStatus("saving map");
        await saveMap({
          owner,
          repo,
          label: repo,
          spec: JSON.stringify(data.spec),
          model: data.spec.model,
        });
        return;
      }
      throw new Error(
        "The code graph is taking unusually long to build. Leave this page open and try again in a few minutes.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Map generation failed");
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

  const selectedModule = spec?.modules.find((m) => m.id === selectedId) ?? null;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0a0d12] px-8 font-mono">
        <p className="text-[12px] uppercase tracking-[0.22em] text-[#c97878]">
          map generation failed
        </p>
        <p className="max-w-md text-center text-[12px] leading-relaxed text-[#8b96a9]">{error}</p>
        <button
          type="button"
          onClick={() => {
            startedRef.current = false;
            void generate();
          }}
          className="mt-2 border border-[#39445a] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#c9d3e0] transition hover:border-[#7fb0ff] hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!spec || generating) {
    return <GeneratingScreen status={generating ? genStatus : "loading map"} />;
  }

  const stats = spec.stats.slice(0, 4);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0d12] font-mono text-[#c9d3e0]">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-stretch border-b border-[#1c2330]">
        <div className="flex min-w-0 flex-col justify-center border-r border-[#1c2330] px-4 py-2.5">
          <p className="text-[9px] uppercase tracking-[0.22em] text-[#4c5568]">Repository</p>
          <p className="truncate text-[12.5px] font-semibold text-[#e8edf5]">
            {owner}/{repo}
          </p>
        </div>
        {stats.map((s) => (
          <div
            key={s.label}
            className="hidden flex-col justify-center border-r border-[#1c2330] px-4 py-2.5 md:flex"
          >
            <p className="whitespace-nowrap text-[9px] uppercase tracking-[0.22em] text-[#4c5568]">
              {s.label}
            </p>
            <p className="text-[12.5px] text-[#e8edf5]">{s.value}</p>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2 px-3">
          {flows.length > 0 ? (
            <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[#4c5568]">
              Flow
              <select
                value={activeFlow?.id ?? ""}
                onChange={(e) => {
                  setActiveFlowId(e.target.value);
                  setTraceIndex(null);
                  setSelectedId(null);
                }}
                className="border border-[#39445a] bg-[#10151f] px-2 py-1.5 text-[11px] normal-case tracking-normal text-[#e8edf5] outline-none"
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
            className="border border-[#39445a] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#c9d3e0] transition hover:border-[#7fb0ff]"
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
            className="hidden border border-[#39445a] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#c9d3e0] transition hover:border-[#7fb0ff] sm:block"
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
            className="border border-[#39445a] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#c9d3e0] transition hover:border-[#7fb0ff]"
          >
            Reset view
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* left: module registry */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-[#1c2330] pb-4 lg:block">
          {spec.categories.map((cat) => {
            const mods = spec.modules.filter((m) => m.category === cat.id);
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
                              ? "border-[#7fb0ff] bg-[#131a29] text-[#e8edf5]"
                              : "border-[#242d3f] text-[#9aa7bd] hover:border-[#39445a] hover:text-[#c9d3e0]"
                          }`}
                        >
                          <span className="w-6 shrink-0 text-[9.5px] font-semibold tracking-[0.08em] text-[#5f6d8a]">
                            {m.id}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                          <span className="text-[9.5px] text-[#4c5568]">{m.stack}</span>
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
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute left-4 top-3 z-10">
            <p className="text-[9px] uppercase tracking-[0.22em] text-[#4c5568]">
              Runtime topology
            </p>
            <p className="text-[15px] font-semibold text-[#e8edf5]">
              {activeFlow?.name ?? spec.title}
            </p>
          </div>
          <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3f7bfd]" />
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#4c5568]">
              payloads in motion
            </span>
          </div>

          <IsoScene
            modules={spec.modules}
            flows={flows}
            activeFlow={activeFlow}
            paused={paused}
            traceIndex={traceIndex}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setTab("what");
            }}
            resetNonce={resetNonce}
          />

          {/* legend */}
          <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex items-center gap-4 text-[9.5px] uppercase tracking-[0.14em] text-[#5f6d8a]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-5 bg-[#3f7bfd]" /> flow
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-px w-5"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg,#8a93a6 0 5px,transparent 5px 9px)",
                }}
              />{" "}
              retry
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#6ea8ff]" /> payload
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-px w-5"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg,#5f6d8a 0 2px,transparent 2px 6px)",
                }}
              />{" "}
              feedback
            </span>
          </div>
        </div>

        {/* right: explainer panel */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-[#1c2330] md:flex">
          <div className="flex shrink-0 border-b border-[#1c2330]">
            <button
              type="button"
              onClick={() => setTab("what")}
              className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] transition ${
                tab === "what"
                  ? "bg-[#e8edf5] font-semibold text-[#0a0d12]"
                  : "text-[#5f6d8a] hover:text-[#c9d3e0]"
              }`}
            >
              What it does
            </button>
            <button
              type="button"
              onClick={() => setTab("how")}
              className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] transition ${
                tab === "how"
                  ? "bg-[#e8edf5] font-semibold text-[#0a0d12]"
                  : "text-[#5f6d8a] hover:text-[#c9d3e0]"
              }`}
            >
              How it&apos;s built
            </button>
          </div>

          <div className="min-h-0 flex-1 px-4 pb-6">
            {selectedModule ? (
              <>
                <SectionLabel>Selected module</SectionLabel>
                <p className="px-3 text-[14px] font-semibold leading-snug text-[#e8edf5]">
                  {selectedModule.name}
                </p>
                <p className="mt-3 whitespace-pre-line px-3 text-[11.5px] leading-relaxed text-[#9aa7bd]">
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
                <p className="px-3 text-[14px] font-semibold leading-snug text-[#e8edf5]">
                  {activeFlow.name}
                </p>
                {activeFlow.tagline ? (
                  <p className="mt-2 px-3 text-[11px] leading-relaxed text-[#5f6d8a]">
                    {activeFlow.tagline}
                  </p>
                ) : null}
                <div className="mx-3 my-3 border-t border-[#1c2330]" />
                <p className="whitespace-pre-line px-3 text-[11.5px] leading-relaxed text-[#9aa7bd]">
                  {tab === "what" ? activeFlow.what || spec.what : spec.how}
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
                  <span className="inline-block bg-[#e8edf5] px-1.5 py-0.5 text-[10px] font-semibold text-[#0a0d12]">
                    {activeFlow.payload}
                  </span>
                </div>
              </>
            ) : (
              <>
                <SectionLabel>{spec.title}</SectionLabel>
                <p className="whitespace-pre-line px-3 text-[11.5px] leading-relaxed text-[#9aa7bd]">
                  {tab === "what" ? spec.what : spec.how}
                </p>
              </>
            )}

            {!selectedModule ? (
              <>
                <div className="mx-3 my-4 border-t border-[#1c2330]" />
                <p className="px-3 text-[10px] leading-relaxed tracking-[0.06em] text-[#4c5568]">
                  {spec.tagline}
                </p>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {/* ── Bottom hint bar ─────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-[#1c2330] px-4 py-1.5">
        <p className="text-[9.5px] uppercase tracking-[0.18em] text-[#4c5568]">
          select a module · inspect a payload · pause the flow · trace one step
        </p>
        <p className="hidden text-[9.5px] uppercase tracking-[0.18em] text-[#333c4e] sm:block">
          drag to pan · scroll to zoom
        </p>
      </footer>
    </div>
  );
}
