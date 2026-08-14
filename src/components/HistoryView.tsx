"use client";

import Link from "next/link";
import { GitBranch, MoreHorizontal, Plus } from "lucide-react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCreateGraphModal } from "@/components/DashboardShell";
import { LoadingState } from "@/components/LoadingState";
import { graphPath } from "@/lib/paths";

function formatWhen(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function HistoryView() {
  const { openCreate } = useCreateGraphModal();
  const { isAuthenticated } = useConvexAuth();
  const history = useQuery(api.graphs.history, isAuthenticated ? {} : "skip");

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-wire-ink sm:text-5xl">
          History
        </h1>
        <p className="mt-2 text-base text-wire-mute sm:text-lg">
          Every repository graph you’ve opened, in the same thumbnail layout as Graphs.
        </p>
      </header>

      {history === undefined ? (
        <div className="mt-16 flex justify-center">
          <LoadingState />
        </div>
      ) : history.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/10 bg-[#fafafa] px-6 py-16 text-center">
          <p className="font-display text-xl font-bold tracking-tight">No graphs yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-wire-mute">
            Open a repository and it will appear in your history automatically.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-wire-ink px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            Graph a repo
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {history.map((item) => (
            <Link
              key={item._id}
              href={graphPath(item.owner, item.repo)}
              className="group overflow-hidden rounded-2xl border border-black/8 bg-white transition hover:border-black/15 hover:shadow-[0_8px_24px_rgba(0,0,0,0.04)]"
            >
              <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[#f3f4f6]">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                ) : (
                  <GitBranch
                    className="h-10 w-10 text-wire-mute/70 transition group-hover:text-wire-ink"
                    strokeWidth={1.5}
                  />
                )}
                <span className="absolute right-3 top-3 rounded-md p-1 text-wire-mute opacity-0 transition group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
              </div>
              <div className="px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" aria-hidden />
                  <h2 className="truncate text-sm font-semibold tracking-tight">
                    {item.label || item.repo}
                  </h2>
                </div>
                <p className="mt-1 truncate text-xs text-wire-mute">
                  {item.owner}/{item.repo}
                  {item.nodeCount != null
                    ? ` · ${item.nodeCount.toLocaleString()} nodes`
                    : ""}
                  {" · "}
                  {formatWhen(item.lastViewedAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
