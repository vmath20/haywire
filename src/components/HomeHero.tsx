"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, GitBranch } from "lucide-react";
import { EXAMPLES, parseGithubInput } from "@/lib/types";

export function HomeHero() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-4 pb-16 pt-8 sm:px-6">
      <div className="absolute inset-x-0 top-16 mx-auto h-64 max-w-3xl rounded-full bg-teal-500/10 blur-3xl" />

      <p className="animate-fade-up relative mb-4 inline-flex items-center gap-2 rounded-full border border-teal-800/15 bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-teal-900/80 shadow-sm backdrop-blur">
        <GitBranch className="h-3.5 w-3.5" />
        Knowledge graph for any repo
      </p>

      <h1 className="animate-fade-up relative text-center font-display text-[clamp(2.5rem,7vw,5rem)] font-semibold leading-[0.95] tracking-tight text-stone-900 [animation-delay:80ms]">
        <span className="block">Repository to</span>
        <span className="mt-1 block bg-gradient-to-r from-teal-800 via-teal-700 to-amber-700 bg-clip-text text-transparent">
          graph
        </span>
      </h1>

      <p className="animate-fade-up relative mt-5 max-w-xl text-center text-base leading-relaxed text-stone-600 sm:text-lg [animation-delay:140ms]">
        Paste any GitHub link. Haywire clones it, parses the code with tree-sitter
        (no LLM), and renders an interactive force-directed knowledge graph.
      </p>

      <form
        onSubmit={onSubmit}
        className="animate-fade-up relative mt-8 w-full max-w-2xl [animation-delay:200ms]"
      >
        <div className="flex flex-col gap-3 rounded-2xl border border-stone-300/80 bg-white p-2 shadow-[0_20px_50px_-28px_rgba(28,25,23,0.45)] sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 px-3">
            <span className="hidden font-mono text-xs text-stone-400 sm:inline">github.com/</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="owner/repo or full GitHub URL"
              className="w-full bg-transparent py-3 text-sm text-stone-900 outline-none placeholder:text-stone-400 sm:text-base"
              aria-label="GitHub repository"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
          >
            Graph
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      </form>

      <div className="animate-fade-up relative mt-6 flex flex-wrap items-center justify-center gap-2 [animation-delay:260ms]">
        <span className="mr-1 text-sm text-stone-500">Try these:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={`${ex.owner}/${ex.repo}`}
            type="button"
            onClick={() => router.push(`/${ex.owner}/${ex.repo}`)}
            className="rounded-full border border-stone-300 bg-white/80 px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:border-teal-700/40 hover:text-teal-900"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <p className="animate-fade-in relative mt-10 max-w-md text-center text-sm text-stone-500 [animation-delay:400ms]">
        Open any repo at <span className="font-mono text-stone-700">/owner/repo</span> to
        explore its knowledge graph.
      </p>
    </section>
  );
}
