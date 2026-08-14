"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Download,
  Loader2,
  RefreshCw,
  ZoomIn,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GraphViewer } from "@/components/GraphViewer";
import type { AnalyzeResult } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import { persistGraphArtifacts } from "@/lib/persistGraph";
import { normalizeAnalyzePayload } from "@/lib/normalizeAnalyze";
import clsx from "clsx";

type Props = {
  owner: string;
  repo: string;
  /** When true, fill the dashboard content pane (no marketing header offset). */
  embedded?: boolean;
};

type Stage = "idle" | "loading" | "ready" | "error";

export function DiagramWorkspace({ owner, repo, embedded = false }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState("Preparing…");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [forceNonce, setForceNonce] = useState(0);
  const { isAuthenticated } = useConvexAuth();
  const savedRecord = useQuery(
    api.graphs.getByRepo,
    isAuthenticated ? { owner, repo } : "skip",
  );
  const exampleRecord = useQuery(api.examples.getByRepo, { owner, repo });
  const generateUploadUrl = useMutation(api.graphs.generateUploadUrl);
  const saveGraph = useMutation(api.graphs.save);
  const touchGraph = useMutation(api.graphs.touch);
  const persistedKey = useRef<string | null>(null);

  const persistFull = useCallback(
    async (data: AnalyzeResult) => {
      if (!isAuthenticated) return;
      const key = `${data.owner}/${data.repo}:${data.summary.node_count}:${data.summary.edge_count}`;
      if (persistedKey.current === key) return;
      try {
        await persistGraphArtifacts({
          result: data,
          generateUploadUrl: async () => generateUploadUrl(),
          save: async (args) =>
            saveGraph({
              ...args,
              graphStorageId: args.graphStorageId as Id<"_storage"> | undefined,
              reportStorageId: args.reportStorageId as Id<"_storage"> | undefined,
              thumbnailStorageId: args.thumbnailStorageId as Id<"_storage"> | undefined,
            }),
        });
        persistedKey.current = key;
      } catch {
        // Non-blocking
      }
    },
    [generateUploadUrl, isAuthenticated, saveGraph],
  );

  const runBackendAnalyze = useCallback(
    async (force: boolean) => {
      setStatusMsg(force ? "Regenerating graph…" : "Starting analysis…");

      if (!force) {
        const cached = await fetch(apiUrl(`/graph/${owner}/${repo}`));
        if (cached.ok) {
          const data = (await cached.json()) as AnalyzeResult;
          setResult(data);
          setStage("ready");
          setStatusMsg("Loaded from API cache");
          void persistFull(data);
          return;
        }
      }

      const start = await fetch(apiUrl("/analyze"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${owner}/${repo}`,
          force,
          code_only: true,
        }),
      });
      if (!start.ok) {
        const err = await start.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to start analysis");
      }
      const { job_id } = (await start.json()) as { job_id: string };

      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const res = await fetch(apiUrl(`/jobs/${job_id}`));
        if (!res.ok) throw new Error("Lost job status");
        const job = await res.json();
        const events = job.events as { event: string; message?: string; stage?: string }[];
        const lastStatus = [...events].reverse().find((e) => e.event === "status");
        if (lastStatus?.message) setStatusMsg(lastStatus.message);

        if (job.status === "done") {
          // Multi-instance: retry job-local graph, then disk/memory cache.
          for (let attempt = 0; attempt < 40; attempt++) {
            const fromJob = await fetch(apiUrl(`/jobs/${job_id}/graph`));
            if (fromJob.ok) {
              const data = (await fromJob.json()) as AnalyzeResult;
              setResult(data);
              setStage("ready");
              void persistFull(data);
              return;
            }
            const graphRes = await fetch(apiUrl(`/graph/${owner}/${repo}`));
            if (graphRes.ok) {
              const data = (await graphRes.json()) as AnalyzeResult;
              setResult(data);
              setStage("ready");
              void persistFull(data);
              return;
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          throw new Error("Graph built but could not be loaded from cache");
        }
        if (job.status === "error") {
          throw new Error(job.error?.message || "Graph build failed");
        }
        // "pending" = wrong replica; keep polling
      }
    },
    [owner, persistFull, repo],
  );

  // The boot effect must run once per repo (or explicit regenerate), NOT on
  // every savedRecord/exampleRecord update: booting itself saves artifacts and
  // touches lastViewedAt, which changes those reactive queries and would
  // otherwise re-trigger the effect in an endless regenerate loop.
  const bootedKey = useRef<string | null>(null);
  const bootGen = useRef(0);

  useEffect(() => {
    const gen = bootGen.current;
    return () => {
      // Invalidate in-flight boots on unmount only.
      if (bootGen.current === gen) bootGen.current++;
    };
  }, []);

  useEffect(() => {
    const force = forceNonce > 0;
    const key = `${owner}/${repo}:${forceNonce}`;

    // Still waiting on Convex queries — show progress but don't boot yet.
    if (isAuthenticated && !force && savedRecord === undefined) {
      setStage("loading");
      setStatusMsg("Checking saved graphs…");
      return;
    }
    if (!force && !savedRecord?.graphUrl && exampleRecord === undefined) {
      setStage("loading");
      setStatusMsg("Checking example library…");
      return;
    }

    if (bootedKey.current === key) return;
    bootedKey.current = key;
    const myGen = ++bootGen.current;
    const cancelled = () => bootGen.current !== myGen;

    async function boot() {
      setStage("loading");
      setError(null);
      setResult(null);
      setStatusMsg("Preparing…");
      persistedKey.current = null;

      try {
        if (!force && savedRecord?.graphUrl) {
          setStatusMsg("Loading your saved graph…");
          const res = await fetch(savedRecord.graphUrl);
          if (!res.ok) throw new Error("Could not load saved graph");
          const data = (await res.json()) as AnalyzeResult;
          if (cancelled()) return;
          setResult(data);
          setStage("ready");
          setStatusMsg("Loaded from your library");
          persistedKey.current = `${data.owner}/${data.repo}:${data.summary.node_count}:${data.summary.edge_count}`;
          void touchGraph({ owner, repo });
          if (!savedRecord.thumbnailUrl || !savedRecord.hasArtifact) {
            void persistFull(data);
          }
          return;
        }

        if (!force && exampleRecord?.graphUrl) {
          setStatusMsg("Loading prebuilt example…");
          // Prefer compact display subset when available (large repos).
          const viewUrl = exampleRecord.displayGraphUrl || exampleRecord.graphUrl;
          const usingSubset = Boolean(exampleRecord.displayGraphUrl);
          if (usingSubset) {
            setStatusMsg("Loading display graph…");
          }
          const res = await fetch(viewUrl);
          if (!res.ok) throw new Error("Could not load example graph");
          const raw = await res.json();
          const reportText = exampleRecord.reportUrl
            ? await fetch(exampleRecord.reportUrl)
                .then((r) => (r.ok ? r.text() : null))
                .catch(() => null)
            : null;
          let data = normalizeAnalyzePayload(raw, {
            owner,
            repo,
            nodeCount: exampleRecord.nodeCount,
            edgeCount: exampleRecord.edgeCount,
            communityCount: exampleRecord.communityCount,
            report: reportText,
          });
          // Client-side downsample as last resort if full blob was served
          if (!usingSubset && (data.graph.nodes?.length || 0) > 3500) {
            setStatusMsg("Preparing display subset…");
            const { buildDisplaySubset } = await import("@/lib/displayGraph");
            data = buildDisplaySubset(data);
          }
          if (cancelled()) return;
          setResult(data);
          setStage("ready");
          setStatusMsg(
            usingSubset || data.meta?.display_subset
              ? `Loaded display graph (${data.summary.node_count.toLocaleString()} of ${(exampleRecord.nodeCount ?? data.summary.node_count).toLocaleString()} nodes)`
              : "Loaded prebuilt example",
          );
          persistedKey.current = `${data.owner}/${data.repo}:${data.summary.node_count}:${data.summary.edge_count}`;
          // Avoid copying very large example artifacts into every user's library
          if ((exampleRecord.nodeCount ?? data.summary.node_count) < 20000 && !data.meta?.display_subset) {
            void persistFull(data);
          }
          return;
        }

        await runBackendAnalyze(force);
      } catch (e) {
        if (cancelled()) return;
        setStage("error");
        setError(e instanceof Error ? e.message : "Unexpected error");
      }
    }

    void boot();
  }, [
    exampleRecord,
    forceNonce,
    isAuthenticated,
    owner,
    persistFull,
    repo,
    runBackendAnalyze,
    savedRecord,
    touchGraph,
  ]);

  function exportJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.graph, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${owner}-${repo}-graph.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function regenerate() {
    setForceNonce((n) => n + 1);
  }

  return (
    <div
      className={clsx(
        "flex min-h-0 flex-col",
        embedded
          ? "h-full w-full px-3 py-3 sm:px-4"
          : "mx-auto h-[calc(100vh-4rem)] max-w-[1400px] px-3 py-3 sm:px-5",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-wire-mute">
            <Link href="/dashboard" className="hover:text-wire-ink">
              Graphs
            </Link>
            <span>/</span>
            <span className="font-mono text-wire-ink">
              {owner}/{repo}
            </span>
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-wire-ink underline decoration-wire-signal decoration-2 underline-offset-2"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </a>
          </div>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-wire-ink sm:text-3xl">
            {owner}/{repo}{" "}
            <span className="text-wire-mute">Graph</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => regenerate()}
            disabled={stage === "loading"}
            className="inline-flex items-center gap-1.5 border border-wire-ink/15 bg-wire-paper px-3 py-2 text-sm font-semibold text-wire-ink transition hover:border-wire-ink/40 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", stage === "loading" && "animate-spin")} />
            Regenerate
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={!result}
            className="inline-flex items-center gap-1.5 border border-wire-ink/15 bg-wire-paper px-3 py-2 text-sm font-semibold text-wire-ink transition hover:border-wire-ink/40 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            type="button"
            onClick={() => setZoomEnabled((z) => !z)}
            className={clsx(
              "inline-flex items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition",
              zoomEnabled
                ? "border-wire-ink bg-wire-signal text-wire-ink"
                : "border-wire-ink/15 bg-wire-paper text-wire-ink hover:border-wire-ink/40",
            )}
          >
            <ZoomIn className="h-4 w-4" />
            {zoomEnabled ? "Zoom on" : "Enable Zoom"}
          </button>
          {result?.report && (
            <button
              type="button"
              onClick={() => setShowReport((v) => !v)}
              className="inline-flex items-center gap-1.5 border border-wire-ink/15 bg-wire-paper px-3 py-2 text-sm font-semibold text-wire-ink transition hover:border-wire-ink/40"
            >
              Report
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-2 border-wire-ink/15 bg-wire-paper">
        {stage === "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="relative grid h-14 w-14 place-items-center border-2 border-wire-ink bg-wire-signal">
              <Loader2 className="h-6 w-6 animate-spin text-wire-ink" />
            </div>
            <div>
              <p className="font-display text-2xl font-extrabold text-wire-ink">
                Untangling the wires
              </p>
              <p className="mt-2 max-w-md text-sm text-wire-mute">{statusMsg}</p>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-wire-mute">
                Tree-sitter AST · no embeddings
              </p>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="h-10 w-10 text-wire-ember" />
            <p className="font-display text-2xl font-extrabold text-wire-ink">Could not build graph</p>
            <p className="max-w-lg text-sm text-wire-mute">{error}</p>
            <button
              type="button"
              onClick={() => regenerate()}
              className="mt-2 bg-wire-ink px-4 py-2 text-sm font-semibold text-wire-paper"
            >
              Try again
            </button>
          </div>
        )}

        {stage === "ready" && result && (
          <div className="flex h-full min-h-0 flex-col">
            {result.summary.god_nodes?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-wire-ink/10 px-4 py-2.5 text-xs">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-wire-mute">
                  Hub nodes
                </span>
                {result.summary.god_nodes.slice(0, 6).map((g) => (
                  <span
                    key={g.id}
                    className="border border-wire-ink/10 bg-wire-mist/40 px-2.5 py-1 font-mono text-wire-ink"
                    title={`degree ${g.degree}`}
                  >
                    {g.label}
                  </span>
                ))}
                <span className="ml-auto font-mono text-wire-mute">
                  {result.summary.confidence.EXTRACTED || 0} EXTRACTED ·{" "}
                  {result.summary.confidence.INFERRED || 0} INFERRED
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <GraphViewer result={result} zoomEnabled={zoomEnabled} />
            </div>
          </div>
        )}
      </div>

      {showReport && result?.report && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-wire-ink/50 p-4 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto border-2 border-wire-ink bg-wire-paper p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-extrabold">Report</h2>
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="px-3 py-1.5 text-sm text-wire-mute hover:text-wire-ink"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-wire-ink/80">
              {result.report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
