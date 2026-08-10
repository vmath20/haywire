import Link from "next/link";
import { EXAMPLES } from "@/lib/types";

export default function BrowsePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-wire-mute">Catalog</p>
      <h1 className="mt-3 font-display text-5xl font-extrabold tracking-tight text-wire-ink sm:text-6xl">
        Browse examples
      </h1>
      <p className="mt-4 max-w-xl text-lg text-wire-mute">
        Open a repository graph instantly — or paste any public GitHub URL on the home page.
      </p>

      <ul className="mt-12 divide-y divide-wire-ink/10 border-y border-wire-ink/10">
        {EXAMPLES.map((ex, i) => (
          <li key={`${ex.owner}/${ex.repo}`}>
            <Link
              href={`/${ex.owner}/${ex.repo}`}
              className="group flex items-baseline justify-between gap-4 py-6 transition hover:bg-wire-signal/20"
            >
              <div className="flex items-baseline gap-4 sm:gap-8">
                <span className="font-mono text-xs text-wire-mute">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="font-display text-2xl font-bold tracking-tight text-wire-ink sm:text-3xl">
                    {ex.label}
                  </div>
                  <div className="mt-1 font-mono text-sm text-wire-mute">
                    {ex.owner}/{ex.repo}
                  </div>
                </div>
              </div>
              <span className="font-mono text-xs uppercase tracking-wider text-wire-mute transition group-hover:text-wire-ink">
                Open →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
