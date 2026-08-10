import Link from "next/link";
import { EXAMPLES } from "@/lib/types";

export default function BrowsePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-stone-900">
        Browse examples
      </h1>
      <p className="mt-3 max-w-2xl text-stone-600">
        Click any repository to generate (or reopen) its Haywire knowledge graph.
      </p>
      <ul className="mt-10 grid gap-3 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <li key={`${ex.owner}/${ex.repo}`}>
            <Link
              href={`/${ex.owner}/${ex.repo}`}
              className="block rounded-2xl border border-stone-200 bg-white/80 p-5 shadow-sm transition hover:border-teal-700/30 hover:shadow-md"
            >
              <div className="font-display text-xl font-semibold text-stone-900">{ex.label}</div>
              <div className="mt-1 font-mono text-sm text-stone-500">
                {ex.owner}/{ex.repo}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
