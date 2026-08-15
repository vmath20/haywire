// Manual npm web-login flow (workaround for npm CLI crashing in non-TTY envs).
// POST /-/v1/login → open loginUrl in browser → poll doneUrl → save token.
import { execFile } from "node:child_process";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REGISTRY = "https://registry.npmjs.org";

const start = await fetch(`${REGISTRY}/-/v1/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "npm-auth-type": "web" },
  body: JSON.stringify({}),
});
if (!start.ok) {
  console.error("login start failed:", start.status, await start.text());
  process.exit(1);
}
const { loginUrl, doneUrl } = await start.json();
console.log("LOGIN_URL:", loginUrl);
execFile("open", [loginUrl], () => {});

const deadline = Date.now() + 15 * 60_000;
while (Date.now() < deadline) {
  const res = await fetch(doneUrl, {
    headers: { "npm-auth-type": "web", accept: "application/json" },
  });
  if (res.status === 200) {
    const { token } = await res.json();
    if (!token) {
      console.error("done endpoint returned no token");
      process.exit(1);
    }
    const npmrc = path.join(os.homedir(), ".npmrc");
    const line = `//registry.npmjs.org/:_authToken=${token}`;
    const existing = existsSync(npmrc) ? readFileSync(npmrc, "utf8") : "";
    if (!existing.includes(line)) {
      appendFileSync(npmrc, (existing.endsWith("\n") || !existing ? "" : "\n") + line + "\n");
    }
    console.log("LOGIN_OK: token saved to ~/.npmrc");
    process.exit(0);
  }
  const retry = Number(res.headers.get("retry-after")) || 3;
  await new Promise((r) => setTimeout(r, retry * 1000));
}
console.error("LOGIN_TIMEOUT: browser authentication was not completed in 15 minutes");
process.exit(1);
