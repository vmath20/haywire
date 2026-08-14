import { NextRequest } from "next/server";
import { apiUrl } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

type HistoryTurn = { role: "user" | "assistant"; content: string };

type Body = {
  owner: string;
  repo: string;
  question: string;
  dfs?: boolean;
  budget?: number;
  graph_url?: string | null;
  history?: HistoryTurn[];
};

const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "moonshotai/kimi-k2.6";

/**
 * Reasoning models (e.g. gpt-oss) sometimes leak their internal analysis into
 * the content stream. Real answers always start at "## Answer", so drop any
 * leaked preamble before it.
 */
function stripLeakedReasoning(text: string): string {
  const idx = text.indexOf("## Answer");
  return idx > 0 ? text.slice(idx) : text;
}

function buildSystemPrompt(owner: string, repo: string, graphContext: string): string {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  return `You are Haywire, a coding assistant that answers questions about GitHub repositories using a knowledge-graph traversal (graphify-style BFS/DFS over code structure).

Repository: ${owner}/${repo}
GitHub: ${repoUrl}

Use ONLY the graph evidence below. Do not invent files, symbols, or relationships that are not supported by it. If the evidence is thin, say what is missing and what to ask next.

Graph evidence (NODE lines include src=path and loc=Lline):
${graphContext}

Write a polished markdown answer using this exact structure:

## Answer
1–3 sentences. Wrap every referenced class, function, or method in inline code backticks, e.g. \`XaiGrokOAuthProvider\`, \`auth_path()\`.
Use **bold** sparingly and *italics* for light emphasis.

## Evidence
Bullet list. Each bullet should start with an inline-code symbol from the graph, then a short note.
Example:
- \`XaiGrokOAuthProvider\` — OAuth provider for xAI / Grok
- \`ensure_fresh_auth()\` — refreshes tokens when needed

## How it connects
Short explanation of structural relationships. Keep citing symbols as \`likeThis\`.

## Follow-ups
- Two concrete next questions

Rules:
- Use ## / ### headings (never numbered "1. Answer" as a list item for section titles)
- Use proper markdown: headings, **bold**, *italics*, \`inline code\`, and lists
- Cite symbols with backticks only — do NOT paste GitHub URLs or markdown file links
- Never invent symbols or paths; only use names present in the graph evidence
- If the evidence header notes the question matched no symbol names, do NOT say the graph is empty or returned zero results. Instead, briefly note that the exact concept was not found in this repo's code graph, then answer as well as you can from the components shown (the repo's most-connected code)`;
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function fallbackAnswer(graphContext: string, owner: string, repo: string): string {
  const bullets = graphContext
    .split("\n")
    .map((line) => {
      const m = line.match(/^NODE\s+(.+?)\s+\[src=([^\s\]]+)\s+loc=L(\d+)/i);
      if (!m) return null;
      return `- \`${m[1]!.trim()}\` — ${m[2]}:${m[3]}`;
    })
    .filter(Boolean)
    .slice(0, 24)
    .join("\n");

  return [
    "## Answer",
    "Here is the graph traversal result (LLM unavailable). Inline symbols are linked to GitHub when possible.",
    "",
    "## Evidence",
    bullets || "_No NODE lines in graph context._",
    "",
    "## Follow-ups",
    `- Ask a more specific question about a module in [${owner}/${repo}](https://github.com/${owner}/${repo}).`,
  ].join("\n");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Resolve FastAPI /query URL without using protected VERCEL_URL deployment hosts. */
function backendQueryUrl(req: NextRequest): string {
  const configured = (
    process.env.HAYWIRE_API_URL ||
    process.env.NEXT_PUBLIC_HAYWIRE_API_URL ||
    ""
  ).replace(/\/$/, "");
  if (configured) {
    return configured.endsWith("/query") ? configured : `${configured}/query`;
  }

  const prodHost = (
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "haywire-omega.vercel.app"
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  // On Vercel, prefer the public production alias — deployment URLs are often SSO-protected
  // and server-side fetches to VERCEL_URL return 401 HTML/JSON without FastAPI detail.
  if (process.env.VERCEL) {
    return `https://${prodHost}/api/backend/query`;
  }

  return `${req.nextUrl.origin}${apiUrl("/query")}`;
}

async function readErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `Graph query failed (${res.status})`;
  try {
    const err = JSON.parse(text) as {
      detail?: unknown;
      error?: { message?: string };
      message?: string;
    };
    if (typeof err.detail === "string" && err.detail.trim()) return err.detail;
    if (Array.isArray(err.detail)) {
      const joined = err.detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg?: string }).msg) : ""))
        .filter(Boolean)
        .join("; ");
      if (joined) return joined;
    }
    if (err.error?.message) return err.error.message;
    if (typeof err.message === "string") return err.message;
  } catch {
    // not JSON
  }
  if (text.includes("Protected deployment")) {
    return "Backend URL is protected. Set HAYWIRE_API_URL to the public production API.";
  }
  return text.slice(0, 400) || `Graph query failed (${res.status})`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ detail: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const question = body.question?.trim();
  if (!owner || !repo) {
    return new Response(JSON.stringify({ detail: "owner and repo are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!question || question.length < 2) {
    return new Response(JSON.stringify({ detail: "question is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sse(payload)));
      };

      const started = Date.now();
      try {
        const queryEndpoint = backendQueryUrl(req);

        send({ type: "status", phase: "graph", message: "Traversing knowledge graph…" });

        // Follow-ups often use pronouns or broad words ("the models") that
        // match no symbol names. Enrich the seed-matching text with recent
        // user questions from the thread; the LLM itself still receives only
        // the raw question as the user message.
        const priorQuestions = (Array.isArray(body.history) ? body.history : [])
          .filter((t) => t.role === "user" && t.content.trim())
          .slice(-2)
          .map((t) => t.content.slice(0, 300))
          .join("\n");
        const seedQuestion = priorQuestions
          ? `${question}\n${priorQuestions}`
          : question;

        const graphRes = await fetch(queryEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner,
            repo,
            question: seedQuestion,
            dfs: Boolean(body.dfs),
            budget: body.budget ?? 3000,
            graph_url: body.graph_url || undefined,
          }),
          cache: "no-store",
        });

        if (!graphRes.ok) {
          send({ type: "error", detail: await readErrorDetail(graphRes) });
          controller.close();
          return;
        }

        const graphData = (await graphRes.json()) as {
          owner: string;
          repo: string;
          question: string;
          answer?: string;
          graph_context?: string;
          traversal?: unknown;
          mode: string;
          budget: number;
          elapsed_ms: number;
        };

        const graphContext = (graphData.graph_context || graphData.answer || "").trim();
        if (!graphContext) {
          send({ type: "error", detail: "Empty graph context" });
          controller.close();
          return;
        }

        send({
          type: "meta",
          owner: graphData.owner,
          repo: graphData.repo,
          question,
          graph_context: graphContext,
          traversal: graphData.traversal ?? null,
          mode: graphData.mode,
          budget: graphData.budget,
          graph_elapsed_ms: graphData.elapsed_ms,
        });

        const apiKey = process.env.OPENROUTER_API_KEY?.trim();
        if (!apiKey) {
          const text = fallbackAnswer(graphContext, owner, repo);
          for (let i = 0; i < text.length; i += 24) {
            send({ type: "token", text: text.slice(i, i + 24) });
          }
          send({
            type: "done",
            answer: text,
            model: null,
            llm_used: false,
            llm_error: "OPENROUTER_API_KEY is not set",
            prompt_tokens: estimateTokens(graphContext + question),
            completion_tokens: estimateTokens(text),
            total_tokens: estimateTokens(graphContext + question + text),
            cost_usd: 0,
            elapsed_ms: Date.now() - started,
          });
          controller.close();
          return;
        }

        send({ type: "status", phase: "llm", message: "Drafting answer…" });

        const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
          {
            role: "system",
            content: buildSystemPrompt(owner, repo, graphContext),
          },
        ];
        for (const turn of (Array.isArray(body.history) ? body.history : []).slice(-6)) {
          if (!turn.content.trim()) continue;
          messages.push({
            role: turn.role,
            content: turn.content.slice(0, 4000),
          });
        }
        messages.push({ role: "user", content: question });

        const models = Array.from(
          new Set([
            DEFAULT_MODEL,
            "z-ai/glm-5v-turbo",
            "google/gemma-4-31b-it:free",
          ]),
        );

        let usedModel: string | null = null;
        let fullText = "";
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        let costUsd = 0;
        let lastError = "";

        for (const model of models) {
          try {
            const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer":
                  process.env.NEXT_PUBLIC_SITE_URL || "https://haywire-omega.vercel.app",
                "X-Title": "Haywire",
              },
              body: JSON.stringify({
                model,
                messages,
                temperature: 0.2,
                max_tokens: 1800,
                stream: true,
                stream_options: { include_usage: true },
                // Never surface chain-of-thought for reasoning-capable models.
                reasoning: { exclude: true },
              }),
            });

            if (!orRes.ok || !orRes.body) {
              const data = await orRes.json().catch(() => ({}));
              lastError =
                (data as { error?: { message?: string } }).error?.message ||
                `OpenRouter ${orRes.status}`;
              continue;
            }

            usedModel = model;
            const reader = orRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            fullText = "";

            // Hold tokens until "## Answer" appears so leaked reasoning
            // preambles never reach the client. Flush raw if the marker
            // hasn't shown up after a generous window.
            let forwarding = false;
            let held = "";
            const HOLD_LIMIT = 1500;
            const forward = (delta: string) => {
              fullText += delta;
              if (forwarding) {
                send({ type: "token", text: delta });
                return;
              }
              held += delta;
              const idx = held.indexOf("## Answer");
              if (idx !== -1) {
                forwarding = true;
                const out = held.slice(idx);
                held = "";
                if (out) send({ type: "token", text: out });
              } else if (held.length > HOLD_LIMIT) {
                forwarding = true;
                send({ type: "token", text: held });
                held = "";
              }
            };
            const flushHeld = () => {
              if (!forwarding && held) {
                send({ type: "token", text: held });
                held = "";
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload) as {
                    model?: string;
                    choices?: { delta?: { content?: string } }[];
                    usage?: {
                      prompt_tokens?: number;
                      completion_tokens?: number;
                      total_tokens?: number;
                      cost?: number;
                    };
                  };
                  if (json.model) usedModel = json.model;
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) forward(delta);
                  if (json.usage) {
                    promptTokens = json.usage.prompt_tokens ?? promptTokens;
                    completionTokens = json.usage.completion_tokens ?? completionTokens;
                    totalTokens = json.usage.total_tokens ?? totalTokens;
                    if (typeof json.usage.cost === "number") costUsd = json.usage.cost;
                  }
                } catch {
                  // ignore partial JSON
                }
              }
            }

            flushHeld();
            fullText = stripLeakedReasoning(fullText);
            if (fullText.trim()) break;
            lastError = "Empty model response";
            usedModel = null;
          } catch (err) {
            lastError = err instanceof Error ? err.message : "OpenRouter request failed";
          }
        }

        if (!fullText.trim()) {
          fullText = fallbackAnswer(graphContext, owner, repo);
          for (let i = 0; i < fullText.length; i += 24) {
            send({ type: "token", text: fullText.slice(i, i + 24) });
          }
          promptTokens = estimateTokens(graphContext + question);
          completionTokens = estimateTokens(fullText);
          totalTokens = promptTokens + completionTokens;
          send({
            type: "done",
            answer: fullText,
            model: null,
            llm_used: false,
            llm_error: lastError || "OpenRouter unavailable",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            cost_usd: 0,
            elapsed_ms: Date.now() - started,
          });
          controller.close();
          return;
        }

        if (!promptTokens && !completionTokens) {
          promptTokens = estimateTokens(
            messages.map((m) => m.content).join("\n") + graphContext,
          );
          completionTokens = estimateTokens(fullText);
          totalTokens = promptTokens + completionTokens;
        } else if (!totalTokens) {
          totalTokens = promptTokens + completionTokens;
        }

        send({
          type: "done",
          answer: fullText,
          model: usedModel,
          llm_used: true,
          llm_error: null,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
          elapsed_ms: Date.now() - started,
        });
      } catch (err) {
        send({
          type: "error",
          detail: err instanceof Error ? err.message : "Query failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
