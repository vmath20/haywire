# haywire-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes Haywire's code
knowledge graphs to coding agents (Cursor, Claude Code, etc.) as tools. Agents
can ask structural questions about any GitHub repository — who calls what, how
two symbols connect, what a module depends on — without cloning or grepping.

## Tools

All tools take `repo` as `"owner/repo"` or a full GitHub URL.

| Tool | What it answers |
| --- | --- |
| `find_symbol` | "Where is `GPT` defined?" — fuzzy symbol search with location, kind, community, and connectivity. |
| `who_calls` | "What breaks if I change `GPTConfig`?" — direct (and optionally transitive) callers, with call-site file:line. |
| `trace_path` | "How does `build_model` reach `GPT`?" — shortest dependency path between two symbols. |
| `explain_module` | "What does `nanochat/gpt.py` do structurally?" — symbols defined, key symbols, dependencies in/out, subsystems. |

Graphs Haywire has already analyzed (examples, previously built repos) load
instantly. An unseen repo triggers a build on first use: small repos finish
within the call; large ones return "still building — retry shortly" while the
build continues server-side.

## Build

```bash
cd mcp
npm install
npm run build
```

## Hook up to Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "haywire": {
      "command": "node",
      "args": ["/absolute/path/to/win2/mcp/dist/index.js"]
    }
  }
}
```

## Hook up to Claude Code

```bash
claude mcp add haywire -- node /absolute/path/to/win2/mcp/dist/index.js
```

## Configuration (optional)

| Env var | Default | Purpose |
| --- | --- | --- |
| `HAYWIRE_API_URL` | `https://haywire-omega.vercel.app/api/backend` | Graph builder backend |
| `HAYWIRE_CONVEX_URL` | `https://handsome-bat-11.convex.cloud` | Convex deployment serving prebuilt example graphs |

## Smoke tests

```bash
node scripts/smoke.mjs                    # all four tools against a prebuilt graph
node scripts/smoke-build.mjs owner/repo   # fresh-build path
```
