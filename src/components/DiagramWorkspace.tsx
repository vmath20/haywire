"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Download,
  Loader2,
  RefreshCw,
  ZoomIn,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { GraphViewer } from "@/components/GraphViewer";
import type { AnalyzeResult } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import clsx from "clsx";

type Props = {
  owner: string;
  repo: string;
};

type Stage = "idle" | "loading" | "ready" | "error";

export function DiagramWorkspace({ owner, repo }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMsg, setStatusMsg] = useState("Preparing…");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(true);
  const [showReport, setShowReport] = useState(false);

  const runAnalyze = useCallback(
    async (force = false) => {
      setStage("loading");
      setError(null);
      setStatusMsg(force ? "Regenerating graph…" : "Starting analysis…");
      setResult(null);

      try {
        // Try cached graph first when not forcing
        if (!force) {
          const cached = await fetch(apiUrl(`/graph/${owner}/${repo}`));
          if (cached.ok) {
            const data = (await cached.json()) as AnalyzeResult;
            setResult(data);
            setStage("ready");
            setStatusMsg("Loaded from cache");
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

        // Poll job status
        for (;;) {
          await new Promise((r) => setTimeout(r, 700));
          const res = await fetch(apiUrl(`/jobs/${job_id}`));
          if (!res.ok) throw new Error("Lost job status");
          const job = await res.json();
          const events = job.events as { event: string; message?: string; stage?: string }[];
          const lastStatus = [...events].reverse().find((e) => e.event === "status");
          if (lastStatus?.message) setStatusMsg(lastStatus.message);

          if (job.status === "done") {
            const graphRes = await fetch(apiUrl(`/graph/${owner}/${repo}`));
            if (!graphRes.ok) {
              throw new Error("Graph built but could not be loaded from cache");
            }
            setResult((await graphRes.json()) as AnalyzeResult);
            setStage("ready");
            return;
          }
          if (job.status === "error") {
            throw new Error(job.error?.message || "Graph build failed");
          }
        }
      } catch (e) {
        setStage("error");
        setError(e instanceof Error ? e.message : "Unexpected error");
      }
    },
    [owner, repo],
  );

  useEffect(() => {
    void runAnalyze(false);
  }, [runAnalyze]);

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

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1400px] flex-col px-3 py-3 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Link href="/" className="hover:text-stone-800">
              Home
            </Link>
            <span>/</span>
            <span className="font-mono text-stone-800">
              {owner}/{repo}
            </span>
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-teal-800 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </a>
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
            {owner}/{repo}{" "}
            <span className="text-stone-400">Graph</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runAnalyze(true)}
            disabled={stage === "loading"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", stage === "loading" && "animate-spin")} />
            Regenerate
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={!result}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            type="button"
            onClick={() => setZoomEnabled((z) => !z)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition",
              zoomEnabled
                ? "border-teal-700/30 bg-teal-50 text-teal-900"
                : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
            )}
          >
            <ZoomIn className="h-4 w-4" />
            {zoomEnabled ? "Zoom on" : "Enable Zoom"}
          </button>
          {result?.report && (
            <button
              type="button"
              onClick={() => setShowReport((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
            >
              Report
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_24px_60px_-40px_rgba(28,25,23,0.5)]">
        {stage === "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="relative">
              <div className="h-16 w-16 animate-pulse-soft rounded-full bg-teal-100" />
              <Loader2 className="absolute inset-0 m-auto h-8 w-8 animate-spin text-teal-800" />
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-stone-900">
                Building knowledge graph
              </p>
              <p className="mt-2 max-w-md text-sm text-stone-500">{statusMsg}</p>
              <p className="mt-4 text-xs text-stone-400">
                Code is parsed locally with tree-sitter — deterministic, no embeddings.
              </p>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <p className="font-display text-xl font-semibold text-stone-900">Could not build graph</p>
            <p className="max-w-lg text-sm text-stone-600">{error}</p>
            <button
              type="button"
              onClick={() => void runAnalyze(true)}
              className="mt-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        )}

        {stage === "ready" && result && (
          <div className="flex h-full min-h-0 flex-col">
            {result.summary.god_nodes?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-4 py-2.5 text-xs">
                <span className="font-semibold uppercase tracking-wide text-stone-400">
                  Hub nodes
                </span>
                {result.summary.god_nodes.slice(0, 6).map((g) => (
                  <span
                    key={g.id}
                    className="rounded-full bg-stone-100 px-2.5 py-1 font-mono text-stone-700"
                    title={`degree ${g.degree}`}
                  >
                    {g.label}
                  </span>
                ))}
                <span className="ml-auto font-mono text-stone-400">
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">Report</h2>
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-stone-700">
              {result.report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
