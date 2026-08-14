/** Build a GitHub blob URL for a file (and optional line). */
export function githubBlobUrl(
  owner: string,
  repo: string,
  path: string,
  line?: number | string | null,
): string {
  const clean = path.replace(/^\/+/, "").replace(/\\/g, "/");
  const base = `https://github.com/${owner}/${repo}/blob/HEAD/${clean}`;
  if (line == null || line === "") return base;
  const n = String(line).replace(/^L/i, "");
  return Number.isFinite(Number(n)) ? `${base}#L${n}` : base;
}

export type SymbolRef = {
  path: string;
  line?: number;
  /** Original NODE label from graphify. */
  label: string;
};

function addSymbolVariants(map: Map<string, SymbolRef>, label: string, ref: SymbolRef) {
  const variants = new Set<string>();
  const trimmed = label.trim();
  variants.add(trimmed);
  variants.add(trimmed.replace(/^\./, ""));
  variants.add(trimmed.replace(/\(\)$/, ""));
  variants.add(trimmed.replace(/^\./, "").replace(/\(\)$/, ""));
  // Method-style ".foo()" → "foo()" / "foo"
  if (trimmed.startsWith(".")) {
    variants.add(trimmed.slice(1));
    variants.add(trimmed.slice(1).replace(/\(\)$/, ""));
  }
  for (const key of variants) {
    if (!key) continue;
    if (!map.has(key)) map.set(key, ref);
  }
}

/**
 * Parse graphify NODE lines into symbol → source location.
 * Example: NODE XaiGrokOAuthProvider [src=plugins/.../xai_grok.py loc=L50 community=…]
 */
export function parseGraphSymbolMap(graphContext: string): Map<string, SymbolRef> {
  const map = new Map<string, SymbolRef>();
  if (!graphContext) return map;

  const re =
    /^NODE\s+(.+?)\s+\[src=([^\s\]]+)\s+loc=L(\d+)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(graphContext)) !== null) {
    const label = m[1]!.trim();
    const path = m[2]!.trim();
    const line = Number(m[3]);
    const ref: SymbolRef = {
      label,
      path,
      line: Number.isFinite(line) ? line : undefined,
    };
    addSymbolVariants(map, label, ref);
  }
  return map;
}

export function lookupSymbol(
  map: Map<string, SymbolRef>,
  raw: string,
): SymbolRef | undefined {
  const text = raw.trim();
  if (!text || !map.size) return undefined;
  return (
    map.get(text) ||
    map.get(text.replace(/^\./, "")) ||
    map.get(text.replace(/\(\)$/, "")) ||
    map.get(text.replace(/^\./, "").replace(/\(\)$/, ""))
  );
}

/**
 * Clean broken / nested GitHub markdown links produced by earlier linkifiers
 * or model mistakes. Prefer short path/code citations over long URL text.
 */
export function sanitizeAnswerMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  let out = markdown;

  // [label](…nested github urls…) → [label](bestCleanUrl) then often simplified below
  out = out.replace(/\[([^\]]+)\]\(([^)]*github\.com[^)]*)\)/gi, (_full, label: string, inner: string) => {
    const urls = inner.match(/https:\/\/github\.com\/[^\s)\]]+/gi) ?? [];
    const repaired = urls
      .map((u) =>
        u
          .replace(/[\[\]]/g, "")
          .replace(/\/blob\/HEAD\/ithub\.com\//i, "/blob/HEAD/")
          .replace(/^https:\/\/g(?=ithub\.com)/i, "https://g"),
      )
      .filter((u) => /github\.com\/[^/]+\/[^/]+\/blob\//i.test(u));
    const best = repaired[repaired.length - 1];
    if (!best) {
      // Drop irreparable link; keep readable label as code
      return `\`${label}\``;
    }
    return `[${label}](${best})`;
  });

  // Path-looking markdown links → inline code (UI links symbols, not long paths)
  out = out.replace(
    /\[((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?::\d+)?)\]\(https:\/\/github\.com\/[^)]+\)/g,
    "`$1`",
  );

  // Orphaned broken fragments like https://g[ithub.com/...
  out = out.replace(/https:\/\/g\[?ithub\.com\/[^\s)\]]+/gi, "");
  out = out.replace(/\(\s*\)/g, "");
  out = out.replace(/[ \t]{2,}/g, " ");

  return out;
}

/** Resolve a symbol name to a GitHub URL when possible. */
export function symbolGithubUrl(
  owner: string,
  repo: string,
  map: Map<string, SymbolRef>,
  symbol: string,
): string | null {
  const ref = lookupSymbol(map, symbol);
  if (!ref) return null;
  return githubBlobUrl(owner, repo, ref.path, ref.line);
}
