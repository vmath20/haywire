"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { EXAMPLES, parseGithubInput } from "@/lib/types";
import { WireCanvas } from "@/components/WireCanvas";

export function HomeHero() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  function submit(raw: string) {
    const parsed = parseGithubInput(raw);
    if (!parsed) {
      setError("Enter a GitHub URL or owner/repo");
      return;
    }
    setError(null);
    router.push(`/${parsed.owner}/${parsed.repo}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(value);
  }

  return (
    <section className="relative isolate min-h-[calc(100vh-4rem)] overflow-hidden">
      <div className="wire-grid absolute inset-0 opacity-70" aria-hidden />
      <WireCanvas />

      {/* Soft vignette so type stays readable over the graph */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(238,241,244,0.55)_0%,rgba(238,241,244,0.2)_45%,transparent_70%)]"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-end px-4 pb-16 pt-10 sm:px-6 sm:pb-20 lg:justify-center lg:pb-24">
        <div className="max-w-4xl">
          <p className="animate-fade-up font-mono text-[11px] uppercase tracking-[0.28em] text-wire-mute">
            Knowledge graphs from source
          </p>

          <h1 className="animate-brand-in mt-4 font-display text-[clamp(3.5rem,14vw,9.5rem)] font-extrabold leading-[0.82] tracking-[-0.04em] text-wire-ink">
            Haywire
          </h1>

          <p className="animate-fade-up mt-6 max-w-md text-lg leading-snug text-wire-mute sm:text-xl [animation-delay:180ms]">
            Paste a GitHub repo. Watch the codebase untangle into a live, clickable graph.
          </p>

          <form
            onSubmit={onSubmit}
            className="animate-fade-up mt-10 max-w-xl [animation-delay:280ms]"
          >
            <div
              className={`flex flex-col gap-2 border-2 bg-wire-paper/90 p-2 backdrop-blur-sm transition sm:flex-row sm:items-stretch ${
                focused ? "border-wire-ink" : "border-wire-ink/20"
              }`}
            >
              <label className="flex flex-1 items-center gap-2 px-3">
                <span className="hidden shrink-0 font-mono text-xs text-wire-mute sm:inline">
                  github.com/
                </span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
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
            {error && <p className="mt-2 text-sm text-wire-ember">{error}</p>}
          </form>
        </div>

        <div className="animate-fade-up mt-14 flex flex-wrap items-baseline gap-x-5 gap-y-2 border-t border-wire-ink/10 pt-6 [animation-delay:380ms]">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-wire-mute">
            Jump in
          </span>
          {EXAMPLES.map((ex) => (
            <button
              key={`${ex.owner}/${ex.repo}`}
              type="button"
              onClick={() => router.push(`/${ex.owner}/${ex.repo}`)}
              className="font-display text-lg font-bold tracking-tight text-wire-ink underline decoration-wire-signal decoration-2 underline-offset-4 transition hover:decoration-wire-ember"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="pointer-events-none absolute bottom-6 right-6 hidden items-center gap-2 sm:flex"
        aria-hidden
      >
        <span className="h-2 w-2 animate-signal-pulse rounded-sm bg-wire-signal" />
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-wire-mute">
          Live wire
        </span>
      </div>
    </section>
  );
}
