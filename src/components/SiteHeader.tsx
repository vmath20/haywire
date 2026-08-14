"use client";

import Image from "next/image";
import Link from "next/link";
import { Github, LogOut } from "lucide-react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");

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
          <Link
            href="/dashboard/query"
            className="rounded-md px-3 py-2 text-sm font-medium text-wire-mute transition hover:text-wire-ink"
          >
            Query
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

          {isLoading ? (
            <span className="hidden h-9 w-20 animate-pulse rounded-md bg-wire-line/50 sm:inline-block" />
          ) : isAuthenticated ? (
            <div className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-sm font-semibold text-wire-ink transition hover:bg-wire-ink/5"
              >
                Dashboard
              </Link>
              {viewer?.name || viewer?.email ? (
                <span className="hidden max-w-[10rem] truncate px-2 text-sm text-wire-mute sm:inline">
                  {viewer.name ?? viewer.email}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex items-center gap-2 rounded-md border border-wire-ink/15 px-3 py-2 text-sm font-medium text-wire-ink transition hover:bg-wire-ink/5"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
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
