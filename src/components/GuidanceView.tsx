"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Check,
  Copy,
  MessageSquareText,
  MousePointerClick,
  Network,
} from "lucide-react";

/* ─── building blocks ─────────────────────────────────────────── */

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative mt-3 overflow-hidden rounded-xl border border-black/[0.07] bg-[#f6f7f8]">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-[#9ca3af] transition hover:bg-black/[0.05] hover:text-wire-ink"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </button>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-relaxed text-[#1f2937]">
        {code}
      </pre>
    </div>
  );
}

function Section({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-wire-ink text-white">
          {icon}
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-wire-mute">
            {eyebrow}
          </p>
          <h2 className="font-display text-xl font-bold tracking-tight text-wire-ink">
            {title}
          </h2>
        </div>
      </div>
      <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-[#374151]">
        {children}
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f3f4f6] font-mono text-[10.5px] font-semibold text-wire-ink">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-[#f3f4f6] px-1.5 py-0.5 font-mono text-[12px] font-medium text-wire-ink">
      {children}
    </code>
  );
}

/* ─── page ────────────────────────────────────────────────────── */

const MCP_TOOLS = [
  {
    name: "find_symbol",
    what: "Fuzzy-search functions, classes, and modules by name.",
    ask: "“Where is GPT defined in karpathy/nanochat?”",
  },
  {
    name: "who_calls",
    what: "Everything that calls or depends on a symbol, with exact call-site file:line. Depth up to 3 for transitive callers.",
    ask: "“What breaks if I change GPTConfig?”",
  },
  {
    name: "trace_path",
    what: "Shortest dependency path between two symbols through the graph.",
    ask: "“How does build_model reach GPT?”",
  },
  {
    name: "explain_module",
    what: "Structural summary of a file or directory: symbols defined, key symbols, what it depends on, what depends on it.",
    ask: "“Explain nanochat/gpt.py.”",
  },
];

const CURSOR_CONFIG = `{
  "mcpServers": {
    "haywire": {
      "command": "npx",
      "args": ["-y", "haywire-mcp"]
    }
  }
}`;

export function GuidanceView() {
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-wire-mute">
          Guidance
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-wire-ink">
          How Haywire works
        </h1>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-wire-mute">
          Haywire turns any GitHub repository into a knowledge graph of its
          code — every function, class, and module, and how they connect. Use
          it to explore unfamiliar codebases visually, ask questions grounded
          in real code, and give your coding agents the same structural
          understanding.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <Section
          icon={<Network className="h-4 w-4" strokeWidth={1.75} />}
          eyebrow="Step one"
          title="Graph a repository"
        >
          <ol className="space-y-2.5">
            <Step n={1}>
              Paste a GitHub URL (or <Kbd>owner/repo</Kbd>) into the{" "}
              <span className="font-medium text-wire-ink">Graph it</span> box on
              the home page, or pick one of the prebuilt examples.
            </Step>
            <Step n={2}>
              Haywire clones the repo, extracts every symbol and relationship
              (calls, imports, contains), and lays them out as an interactive
              graph. Small repos take seconds; large ones a few minutes.
            </Step>
            <Step n={3}>
              Colors are <span className="font-medium text-wire-ink">communities</span> —
              clusters of code that work together, usually matching real
              subsystems. Node size tracks how connected a symbol is.
            </Step>
          </ol>
          <p className="flex items-center gap-2 rounded-lg bg-[#f8f9fa] px-3 py-2 text-[13px] text-wire-mute">
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            Drag to pan, scroll to zoom, hover for details, double-click a node
            to open its source on GitHub. Graphs you build are saved to your
            sidebar.
          </p>
        </Section>

        <Section
          icon={<MessageSquareText className="h-4 w-4" strokeWidth={1.75} />}
          eyebrow="Step two"
          title="Query the codebase"
        >
          <p>
            Open <span className="font-medium text-wire-ink">Query</span>, pick
            a graphed repository, and ask anything — “how does authentication
            work?”, “where are patches preprocessed?”. Haywire walks the graph
            from the most relevant symbols and answers with citations from
            real code.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              The <span className="font-medium text-wire-ink">left column</span>{" "}
              is the answer. Click any cited symbol pill to jump to its code
              snippet on the right.
            </li>
            <li>
              The <span className="font-medium text-wire-ink">Code tab</span>{" "}
              shows the exact source snippets the answer is grounded in, with
              cited lines highlighted.
            </li>
            <li>
              The <span className="font-medium text-wire-ink">Graph tab</span>{" "}
              is the answer map — the subgraph of symbols behind the answer.
              Filled nodes are cited; double-click opens the source.
            </li>
            <li>
              Follow-up questions keep the thread and its evidence — earlier
              answers stay on the page.
            </li>
          </ul>
        </Section>

        <Section
          icon={<Bot className="h-4 w-4" strokeWidth={1.75} />}
          eyebrow="For coding agents"
          title="Haywire MCP — the graph in your editor"
        >
          <p>
            <Kbd>haywire-mcp</Kbd> is an MCP (Model Context Protocol) server
            that exposes Haywire&rsquo;s graphs to coding agents like Cursor
            and Claude Code. Your agent can ask structural questions about any
            GitHub repo while it codes — no cloning or grepping.
          </p>

          <div className="overflow-hidden rounded-xl border border-black/[0.07]">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-[#f8f9fa]">
                  <th className="px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-wire-mute">
                    Tool
                  </th>
                  <th className="px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-wider text-wire-mute">
                    What it answers
                  </th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((t) => (
                  <tr key={t.name} className="border-t border-black/[0.05] align-top">
                    <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[12px] font-semibold text-wire-ink">
                      {t.name}
                    </td>
                    <td className="px-3.5 py-2.5 text-[#374151]">
                      {t.what}{" "}
                      <span className="text-wire-mute">{t.ask}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="font-display text-[15px] font-bold text-wire-ink">
              Hook up to Cursor
            </h3>
            <p className="mt-1 text-[13.5px]">
              Add this to <Kbd>~/.cursor/mcp.json</Kbd> (global) or{" "}
              <Kbd>.cursor/mcp.json</Kbd> in a project, then reload MCP servers
              in Cursor settings:
            </p>
            <CodeBlock code={CURSOR_CONFIG} />
          </div>

          <div>
            <h3 className="font-display text-[15px] font-bold text-wire-ink">
              Hook up to Claude Code
            </h3>
            <CodeBlock code="claude mcp add haywire -- npx -y haywire-mcp" />
          </div>

          <p className="rounded-lg bg-[#f8f9fa] px-3 py-2 text-[13px] text-wire-mute">
            Every tool takes <Kbd>repo</Kbd> as <Kbd>owner/repo</Kbd> or a
            GitHub URL. Repos Haywire has already analyzed answer instantly; an
            unseen repo triggers a build on first use — small repos finish
            within the call, large ones return &ldquo;still building, retry
            shortly&rdquo; while the build continues server-side. Then try:
            &ldquo;using haywire, who calls GPTConfig in
            karpathy/nanochat?&rdquo;
          </p>
        </Section>

        <Section
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
          eyebrow="Keep track"
          title="Usage"
        >
          <p>
            The <span className="font-medium text-wire-ink">Usage</span> page
            tracks your activity over the last 30 days — spend, requests,
            token volume, and graph builds — with per-model breakdowns and an
            activity heatmap.
          </p>
        </Section>
      </div>

      <p className="mt-8 pb-4 text-center text-[12px] text-wire-mute">
        Questions or issues? Open one on{" "}
        <a
          href="https://github.com/vmath20/haywire"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-wire-ink underline decoration-[#b8ff3c] decoration-2 underline-offset-[3px]"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
