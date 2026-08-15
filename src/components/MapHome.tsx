"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Boxes, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { mapPath } from "@/lib/systemMap";
import { DeletingState } from "@/components/LoadingState";

function parseRepoInput(raw: string): { owner: string; repo: string } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const m = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

export function MapHome() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const maps = useQuery(api.maps.listMine, isAuthenticated ? {} : "skip") ?? [];
  const removeMap = useMutation(api.maps.remove);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: Id<"systemMaps">;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const cards = useMemo(
    () =>
      maps.map((m) => ({
        id: m._id,
        owner: m.owner,
        repo: m.repo,
        label: m.label || m.repo,
        href: mapPath(m.owner, m.repo),
      })),
    [maps],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRepoInput(value);
    if (!parsed) {
      setInputError("Enter a repository as owner/repo or a full GitHub URL.");
      return;
    }
    setInputError(null);
    router.push(mapPath(parsed.owner, parsed.repo));
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await removeMap({ id: pendingDelete.id });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight text-wire-ink">
            Map
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-wire-mute">
            Turn any GitHub repository into an isometric system map — its
            infrastructure as buildings on a grid, with payloads tracing real
            control and data paths.
          </p>
        </header>

        <form onSubmit={onSubmit} className="mt-8 max-w-xl">
          <div
            className={`flex flex-col gap-2 border-2 bg-white p-2 transition sm:flex-row sm:items-stretch ${
              focused ? "border-wire-ink" : "border-wire-ink/20"
            }`}
          >
            <label className="flex flex-1 items-center gap-2 px-3">
              <span className="hidden shrink-0 text-base text-wire-mute/70 sm:inline">
                github.com/
              </span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="owner/repo"
                className="w-full bg-transparent py-3 text-base text-wire-ink outline-none placeholder:text-wire-mute/60"
              />
            </label>
            <button
              type="submit"
              className="group inline-flex items-center justify-center gap-2 bg-wire-signal px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-wire-ink transition hover:bg-wire-signalDeep"
            >
              Map it
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </div>
          {inputError ? <p className="mt-2 text-sm text-wire-ember">{inputError}</p> : null}
        </form>

        <h2 className="mt-12 font-display text-lg font-bold tracking-tight text-wire-ink">
          Your maps
        </h2>

        {cards.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-black/10 bg-[#fafafa] px-6 py-16 text-center">
            <Boxes className="mx-auto h-8 w-8 text-wire-mute/50" strokeWidth={1.25} />
            <p className="mt-3 text-sm text-wire-mute">
              No maps yet — enter a repository above to build your first one.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <div key={c.id} className="group/item relative">
                <Link
                  href={c.href}
                  className="group block overflow-hidden border-2 border-wire-ink/20 bg-white transition hover:border-wire-ink"
                >
                  <div className="flex h-28 items-center justify-center bg-[#f3f4f6]">
                    {/* mini isometric mark */}
                    <svg viewBox="-40 -30 80 60" className="h-16 w-24">
                      {[
                        { x: -14, y: 0, h: 14 },
                        { x: 4, y: -8, h: 22 },
                        { x: 14, y: 6, h: 10 },
                      ].map((b, i) => (
                        <g key={i}>
                          <path
                            d={`M ${b.x} ${b.y - b.h} l 10 5 v ${b.h * 0.8} l -10 -5 Z`}
                            fill="#e0e5eb"
                            stroke="#98a2af"
                            strokeWidth={0.7}
                          />
                          <path
                            d={`M ${b.x} ${b.y - b.h} l -10 5 v ${b.h * 0.8} l 10 -5 Z`}
                            fill="#edf0f4"
                            stroke="#98a2af"
                            strokeWidth={0.7}
                          />
                          <path
                            d={`M ${b.x} ${b.y - b.h} l 10 5 l -10 5 l -10 -5 Z`}
                            fill="#ffffff"
                            stroke="#98a2af"
                            strokeWidth={0.7}
                          />
                        </g>
                      ))}
                      <path
                        d="M -24 14 L 24 14"
                        stroke="#8fd414"
                        strokeWidth={1}
                        opacity={0.8}
                      />
                    </svg>
                  </div>
                  <div className="px-4 py-3">
                    <p className="truncate text-sm font-semibold text-wire-ink">{c.label}</p>
                    <p className="mt-0.5 truncate text-xs text-wire-mute">
                      {c.owner}/{c.repo}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete map ${c.label}`}
                  title="Delete map"
                  onClick={() => setPendingDelete({ id: c.id, label: c.label })}
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-black/40 text-white/70 opacity-0 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:opacity-100 group-hover/item:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
              Delete map?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-wire-mute">
              <span className="font-medium text-wire-ink">“{pendingDelete.label}”</span> will
              be permanently deleted. This can’t be undone.
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
