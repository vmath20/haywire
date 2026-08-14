// Smoke test: drive the MCP server over stdio with raw JSON-RPC.
import { spawn } from "node:child_process";

const proc = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const pending = new Map();
proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const init = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.1" },
});
console.log("server:", init.result.serverInfo);
notify("notifications/initialized", {});

const tools = await rpc("tools/list", {});
console.log("tools:", tools.result.tools.map((t) => t.name).join(", "));

async function call(name, args) {
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
  console.log(text.length > 2200 ? text.slice(0, 2200) + "\n…[truncated]" : text);
}

const repo = "karpathy/nanochat";
await call("find_symbol", { repo, query: "GPT", limit: 5 });
await call("who_calls", { repo, symbol: "GPTConfig", depth: 1, limit: 8 });
await call("trace_path", { repo, from: "build_model", to: "GPT" });
await call("explain_module", { repo, module: "nanochat/gpt.py" });

proc.kill();
process.exit(0);
