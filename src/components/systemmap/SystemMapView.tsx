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
import { normalizeSpec, type SystemMapSpec, type MapFlow } from "@/lib/systemMap";
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

function GeneratingScreen({ status, note }: { status: string; note?: string }) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % GEN_PHRASES.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-white">
      <LoadingState label={status} />
      <p className="text-xs text-wire-mute">{note || GEN_PHRASES[phrase]}</p>
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
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const spec: SystemMapSpec | null = useMemo(() => {
    if (!saved?.spec) return null;
    try {
      const parsed = JSON.parse(saved.spec) as SystemMapSpec;
      // Re-run layout normalization so maps saved before spacing rules
      // changed get respaced (buildings never touch, labels stay visible).
      return normalizeSpec(parsed, parsed.owner || owner, parsed.repo || repo, parsed.model);
    } catch {
      return null;
    }
  }, [saved, owner, repo]);

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
    setGenStatus("Analyzing repository");
    setGenNote(undefined);
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
          setGenStatus("Building code graph");
          setGenNote("This can take a few minutes for large repositories.");
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
        setGenStatus("Saving map");
        setGenNote(undefined);
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
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-white px-8">
        <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-wire-ember">
          Map generation failed
        </p>
        <p className="max-w-md text-center text-sm leading-relaxed text-wire-mute">{error}</p>
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

  if (!spec || generating) {
    return (
      <GeneratingScreen
        status={generating ? genStatus : "Loading map"}
        note={generating ? genNote : undefined}
      />
    );
  }

  const stats = spec.stats.slice(0, 4);

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
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* left: module registry */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-black/10 pb-4 lg:block">
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
                              ? "border-wire-ink bg-[#f4f4f5] text-wire-ink"
                              : "border-black/10 text-wire-mute hover:border-wire-ink/40 hover:text-wire-ink"
                          }`}
                        >
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
              Runtime topology
            </p>
            <p className="font-display text-[15px] font-bold tracking-tight text-wire-ink">
              {activeFlow?.name ?? spec.title}
            </p>
          </div>
          <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-wire-signalDeep" />
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-wire-mute/70">
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
                  <span className="inline-block bg-wire-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-wire-ink">
                    {activeFlow.payload}
                  </span>
                </div>
              </>
            ) : (
              <>
                <SectionLabel>{spec.title}</SectionLabel>
                <p className="whitespace-pre-line px-3 text-[12px] leading-relaxed text-wire-mute">
                  {tab === "what" ? spec.what : spec.how}
                </p>
              </>
            )}

            {!selectedModule ? (
              <>
                <div className="mx-3 my-4 border-t border-black/10" />
                <p className="px-3 font-mono text-[10px] leading-relaxed tracking-[0.06em] text-wire-mute/70">
                  {spec.tagline}
                </p>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      {/* ── Bottom hint bar ─────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-black/10 px-4 py-1.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-wire-mute/70">
          select a module · inspect a payload · pause the flow · trace one step
        </p>
        <p className="hidden font-mono text-[9.5px] uppercase tracking-[0.18em] text-wire-mute/50 sm:block">
          drag to pan · scroll to zoom
        </p>
      </footer>
    </div>
  );
}
