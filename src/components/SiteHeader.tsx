"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";

  return (
    <header
      className={clsx(
        "sticky top-0 z-40 transition-colors",
        onHome
          ? "border-b border-transparent bg-transparent"
          : "border-b border-wire-line/70 bg-wire-paper/85 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-wire-ink text-wire-signal">
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(184,255,60,0.35),transparent_55%)]" />
            <span className="relative font-display text-sm font-extrabold tracking-tight">Hw</span>
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-wire-ink">
            Haywire
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/browse"
            className="rounded-md px-3 py-2 text-sm font-medium text-wire-mute transition hover:text-wire-ink"
          >
            Browse
          </Link>
          <a
            href="https://github.com/vmath20/haywire"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-wire-ink/15 bg-wire-ink px-3 py-2 text-sm font-semibold text-wire-paper transition hover:bg-wire-ink/90"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">Star</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
