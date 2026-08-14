import Image from "next/image";
import Link from "next/link";
import { Github } from "lucide-react";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Examples", href: "/dashboard" },
      { label: "Graph a repo", href: "/signin?next=%2Fdashboard" },
      { label: "Sign in", href: "/signin" },
      { label: "Query", href: "/dashboard/query" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "GitHub", href: "https://github.com/vmath20/haywire", external: true },
      { label: "Open source", href: "https://github.com/vmath20/haywire", external: true },
      { label: "Issues", href: "https://github.com/vmath20/haywire/issues", external: true },
      { label: "Contact", href: "https://github.com/vmath20/haywire/issues/new", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "https://github.com/vmath20/haywire#readme", external: true },
      { label: "Star on GitHub", href: "https://github.com/vmath20/haywire", external: true },
      { label: "Privacy", href: "#privacy" },
      { label: "Terms", href: "#terms" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between lg:gap-16">
          <Link href="/" className="block shrink-0 self-start" aria-label="Haywire home">
            <Image
              src="/dark-logo.png"
              alt="Haywire"
              width={225}
              height={75}
              unoptimized
              className="h-8 w-auto bg-black sm:h-9"
            />
          </Link>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 sm:gap-14 lg:gap-20">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="font-serif text-lg font-normal tracking-tight text-white/95">
                  {col.title}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {"external" in link && link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-white/70 transition hover:text-white"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-sm text-white/70 transition hover:text-white"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex items-center justify-between py-6">
          <div className="flex items-center gap-4">
            <a
              href="https://x.com"
              target="_blank"
              rel="noreferrer"
              className="text-white/80 transition hover:text-white"
              aria-label="X"
            >
              <XMark />
            </a>
            <a
              href="https://www.linkedin.com"
              target="_blank"
              rel="noreferrer"
              className="text-white/80 transition hover:text-white"
              aria-label="LinkedIn"
            >
              <LinkedInMark />
            </a>
            <a
              href="https://www.youtube.com"
              target="_blank"
              rel="noreferrer"
              className="text-white/80 transition hover:text-white"
              aria-label="YouTube"
            >
              <YouTubeMark />
            </a>
            <a
              href="https://github.com/vmath20/haywire"
              target="_blank"
              rel="noreferrer"
              className="text-white/80 transition hover:text-white"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" strokeWidth={1.75} />
            </a>
          </div>
          <p className="text-xs text-white/55 sm:text-sm">© {new Date().getFullYear()} Haywire</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 sm:px-6 sm:pb-10">
        <Image
          src="/dark-logo.png"
          alt="Haywire"
          width={480}
          height={160}
          unoptimized
          className="h-auto w-full max-w-[14rem] bg-black sm:max-w-[18rem] md:max-w-[22rem]"
        />
      </div>
    </footer>
  );
}

function XMark() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.894L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function YouTubeMark() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}
