import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LoadingState } from "@/components/LoadingState";

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] flex-col bg-white text-wire-ink">
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-wire-mute">
            Error 404 · Dead node
          </p>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
            This page went
            <br />
            off the graph.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-wire-mute">
            The node you&rsquo;re looking for doesn&rsquo;t exist, was deleted, or never got
            wired up in the first place.
          </p>

          <div className="mt-8">
            <LoadingState label="Signal lost" variant="Orbit" />
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 bg-wire-signal px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-wire-ink transition hover:bg-wire-signalDeep"
            >
              Back to graphs
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 border-2 border-wire-ink/15 px-6 py-[10px] text-sm font-semibold text-wire-ink transition hover:border-wire-ink"
            >
              Go home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
