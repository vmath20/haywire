// Exercise the analyze+poll build path with a small repo not in the examples.
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
await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0.0.1" },
});
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

const repo = process.argv[2] || "karpathy/micrograd";
const res = await rpc("tools/call", {
  name: "find_symbol",
  arguments: { repo, query: process.argv[3] || "Value", limit: 5 },
});
const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
console.log("isError:", Boolean(res.result?.isError));
console.log(text.slice(0, 1500));
proc.kill();
process.exit(0);
