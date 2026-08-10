"use client";

import Link from "next/link";
import { Github, Menu, Moon } from "lucide-react";
import { useState } from "react";

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-[#faf8f5]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-800 text-sm font-semibold text-teal-50 shadow-sm transition group-hover:bg-teal-700">
            Hw
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-stone-900">
            Haywire
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <Link
            href="/browse"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-200/60 hover:text-stone-900"
          >
            Browse
          </Link>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-200/60 hover:text-stone-900"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Menu className="h-4 w-4" />
              Menu
            </span>
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-200/60 hover:text-stone-900"
            title="Light theme"
          >
            <Moon className="h-4 w-4" />
          </button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 shadow-sm transition hover:border-stone-400"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </nav>

        {menuOpen && (
          <div className="absolute right-4 top-14 w-56 rounded-xl border border-stone-200 bg-white p-2 shadow-lg animate-fade-in sm:right-6">
            <Link
              href="/"
              className="block rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
              onClick={() => setMenuOpen(false)}
            >
              Home
            </Link>
            <Link
              href="/browse"
              className="block rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
              onClick={() => setMenuOpen(false)}
            >
              Example graphs
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
