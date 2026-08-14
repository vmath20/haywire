"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, GitBranch, Plus, Search, Trash2 } from "lucide-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { EXAMPLES, parseGithubInput } from "@/lib/types";
import { graphPath } from "@/lib/paths";
import { useCreateGraphModal } from "@/components/DashboardShell";
import { DeletingState } from "@/components/LoadingState";

type Card = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  accent: boolean;
  thumbnailUrl: string | null;
  /** Present only for the user's own saved graphs (examples can't be deleted). */
  savedId: Id<"savedGraphs"> | null;
};

function GraphCard({ item, onDelete }: { item: Card; onDelete?: (item: Card) => void }) {
  return (
    <Link
      href={item.href}
      className="group overflow-hidden border-2 border-wire-ink/20 bg-white transition hover:border-wire-ink"
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
        {item.savedId && onDelete ? (
          <button
            type="button"
            aria-label={`Delete ${item.title}`}
            title="Delete graph"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(item);
            }}
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md bg-white/80 text-wire-mute opacity-0 backdrop-blur transition hover:bg-white hover:text-wire-ember group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2">
          {item.accent ? (
            <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" aria-hidden />
          ) : null}
          <h2 className="truncate text-sm font-semibold tracking-tight">{item.title}</h2>
        </div>
        <p className="mt-1 truncate text-xs text-wire-mute">
          {item.subtitle} · {item.meta}
        </p>
      </div>
    </Link>
  );
}

export function DashboardHome() {
  const router = useRouter();
  const { openCreate } = useCreateGraphModal();
  const { isAuthenticated } = useConvexAuth();
  const saved = useQuery(api.graphs.listMine, isAuthenticated ? {} : "skip") ?? [];
  const examples = useQuery(api.examples.list) ?? [];
  const [filter, setFilter] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoFocused, setRepoFocused] = useState(false);
  const removeGraph = useMutation(api.graphs.remove);
  const [pendingDelete, setPendingDelete] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) setPendingDelete(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete, deleting]);

  async function confirmDelete() {
    if (!pendingDelete?.savedId || deleting) return;
    setDeleting(true);
    try {
      await removeGraph({ id: pendingDelete.savedId });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const { exampleCards, recentCards } = useMemo(() => {
    const exampleCards: Card[] = (
      examples.length
        ? examples
        : EXAMPLES.map((ex) => ({
            owner: ex.owner,
            repo: ex.repo,
            label: ex.label,
            nodeCount: undefined as number | undefined,
            ready: false,
            thumbnailUrl: null as string | null,
          }))
    ).map((ex, i) => ({
      id: `ex-${ex.owner}/${ex.repo}`,
      title: ex.label,
      subtitle: `${ex.owner}/${ex.repo}`,
      meta:
        ex.nodeCount != null
          ? `${ex.nodeCount.toLocaleString()} nodes · Example`
          : ex.ready === false
            ? "Example · building"
            : "Example graph",
      href: graphPath(ex.owner, ex.repo),
      accent: i % 3 === 0,
      thumbnailUrl: ex.thumbnailUrl ?? null,
      savedId: null,
    }));

    const exampleKeys = new Set(exampleCards.map((c) => c.subtitle));
    const recentCards: Card[] = saved
      .filter((g) => !exampleKeys.has(`${g.owner}/${g.repo}`))
      .map((g) => ({
        id: g._id,
        title: g.label || g.repo,
        subtitle: `${g.owner}/${g.repo}`,
        meta:
          g.nodeCount != null
            ? `${g.nodeCount.toLocaleString()} nodes · Recent`
            : "Recent graph",
        href: graphPath(g.owner, g.repo),
        accent: true,
        thumbnailUrl: g.thumbnailUrl ?? null,
        savedId: g._id,
      }));

    return { exampleCards, recentCards };
  }, [saved, examples]);

  const graphCards = useMemo(() => {
    const items = [...recentCards, ...exampleCards];
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.meta.toLowerCase().includes(q),
    );
  }, [exampleCards, recentCards, filter]);

  function onGraphSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseGithubInput(repoInput);
    if (!parsed) {
      setRepoError("Enter a GitHub URL or owner/repo");
      return;
    }
    setRepoError(null);
    router.push(graphPath(parsed.owner, parsed.repo));
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10">
      <header className="max-w-2xl">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-wire-ink sm:text-5xl">
          Graphs
        </h1>
        <p className="mt-2 text-base text-wire-mute sm:text-lg">
          Graph GitHub repositories into interactive knowledge maps.
        </p>
      </header>

      <form onSubmit={onGraphSubmit} className="mt-8 max-w-xl">
        <div
          className={`flex flex-col gap-2 border-2 bg-white p-2 transition sm:flex-row sm:items-stretch ${
            repoFocused ? "border-wire-ink" : "border-wire-ink/20"
          }`}
        >
          <label className="flex flex-1 items-center gap-2 px-3">
            <span className="hidden shrink-0 text-base text-wire-mute/70 sm:inline">
              github.com/
            </span>
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onFocus={() => setRepoFocused(true)}
              onBlur={() => setRepoFocused(false)}
              placeholder="owner/repo"
              className="w-full bg-transparent py-3 text-base text-wire-ink outline-none placeholder:text-wire-mute/70"
              aria-label="GitHub repository"
            />
          </label>
          <button
            type="submit"
            className="group inline-flex items-center justify-center gap-2 bg-wire-signal px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-wire-ink transition hover:bg-wire-signalDeep"
          >
            Graph it
            <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        </div>
        {repoError ? <p className="mt-2 text-sm text-wire-ember">{repoError}</p> : null}
      </form>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-wire-mute">
          Your graphs
        </h2>

        <label className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wire-mute" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search"
            className="w-full border-2 border-wire-ink/20 bg-white py-2.5 pl-9 pr-3 text-sm text-wire-ink outline-none transition placeholder:text-wire-mute/70 focus:border-wire-ink"
          />
        </label>
      </div>

      {graphCards.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-black/10 bg-[#fafafa] px-6 py-16 text-center">
          <p className="font-display text-xl font-bold tracking-tight">No graphs yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-wire-mute">
            Paste a GitHub repo above to build your first graph.
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
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {graphCards.map((item) => (
            <GraphCard key={item.id} item={item} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => {
              if (!deleting) setPendingDelete(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
          >
            <h2 className="font-display text-lg font-bold tracking-tight text-wire-ink">
              Delete graph?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-wire-mute">
              <span className="font-medium text-wire-ink">“{pendingDelete.title}”</span>{" "}
              will be permanently deleted. This can’t be undone.
            </p>
            <div className="mt-5 flex min-h-[38px] items-center justify-end gap-2">
              {deleting ? (
                <div className="flex w-full justify-center py-0.5">
                  <DeletingState />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    className="rounded-lg border border-black/10 px-3.5 py-2 text-sm font-medium text-wire-ink transition hover:bg-black/[0.03]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    className="rounded-lg bg-[#dc2626] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#b91c1c]"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
