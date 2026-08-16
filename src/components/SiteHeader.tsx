"use client";

import Image from "next/image";
import Link from "next/link";
import { Github } from "lucide-react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useConvexAuth } from "convex/react";

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <header
      className={clsx(
        "sticky top-0 z-40 bg-white transition-colors",
        onHome ? "border-b border-transparent" : "border-b border-wire-line/70",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center" aria-label="Haywire home">
          <Image
            src="/logo.svg"
            alt="Haywire"
            width={225}
            height={75}
            priority
            className="h-8 w-auto sm:h-9"
            unoptimized
          />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <a
            href="https://github.com/vmath20/haywire"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-wire-ink/15 bg-wire-ink px-3 py-2 text-sm font-semibold text-wire-paper transition hover:bg-wire-ink/90"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">Star</span>
          </a>

          {isLoading ? (
            <span className="h-9 w-20 animate-pulse rounded-md bg-wire-line/50" />
          ) : isAuthenticated ? (
            <Link
              href="/dashboard"
              className="rounded-md border border-wire-ink/15 px-3 py-2 text-sm font-semibold text-wire-ink transition hover:bg-wire-ink/5"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/signin"
              className="rounded-md border border-wire-ink/15 px-3 py-2 text-sm font-semibold text-wire-ink transition hover:bg-wire-ink/5"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
