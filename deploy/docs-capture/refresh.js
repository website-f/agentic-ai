/**
 * One command to refresh the User Guide media: re-create and seed the demo database, start
 * the demo API (from source), a stand-in worker and Vite, capture shots and videos, stop.
 *
 *   NODE_PATH=<node_modules with playwright> node deploy/docs-capture/refresh.js [capture args]
 *   node deploy/docs-capture/refresh.js --serve      # only seed + serve, until Ctrl+C
 *   node deploy/docs-capture/refresh.js --no-seed    # keep the current demo data
 *
 * Needs the dev stack's Postgres (8506), Valkey (8507) and Temporal (8508) running, uv, and
 * Docker for the video transcode. Ports: API 8621, web 8622 (change with DEMO_API_PORT /
 * DEMO_WEB_PORT). Nothing here touches the dev database or the dev worker.
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..", "..");
const API_DIR = path.join(ROOT, "apps", "api");
const WEB_DIR = path.join(ROOT, "apps", "web");
const WORK = path.join(__dirname, ".work");
const API_PORT = process.env.DEMO_API_PORT || "8621";
const WEB_PORT = process.env.DEMO_WEB_PORT || "8622";
const args = process.argv.slice(2);
const SERVE_ONLY = args.includes("--serve");
const NO_SEED = args.includes("--no-seed");
const captureArgs = args.filter((a) => a !== "--serve" && a !== "--no-seed");

const ENV = {
  ...process.env,
  AGENTIC_DATABASE_URL: process.env.DEMO_DATABASE_URL || "postgresql+asyncpg://agentic:agentic_dev@localhost:8506/agentic_demo",
  AGENTIC_VALKEY_URL: "redis://localhost:8507/8",
  AGENTIC_TEMPORAL_ADDRESS: "localhost:8508",
  AGENTIC_TEMPORAL_TASK_QUEUE: "agentic-office", // never the dev worker's queue
  AGENTIC_VAULT_DIR: path.join(WORK, "vault"),
  AGENTIC_EMBED_BACKEND: "hash",
  AGENTIC_DEV_SEED: "false",
  AGENTIC_LOCAL_LLM_URL: "",
  AGENTIC_API_URL: `http://127.0.0.1:${API_PORT}`,
  PYTHONUNBUFFERED: "1",
};

const kids = [];
const log = (...a) => console.log("[refresh]", ...a);

function start(name, cmd, argv, cwd) {
  fs.mkdirSync(WORK, { recursive: true });
  const out = fs.openSync(path.join(WORK, `${name}.log`), "w");
  const p = spawn(cmd, argv, { cwd, env: ENV, stdio: ["ignore", out, out], shell: process.platform === "win32", windowsHide: true });
  kids.push({ name, p });
  log(`started ${name} (pid ${p.pid}, log .work/${name}.log)`);
  return p;
}

function stopAll() {
  for (const { name, p } of kids.reverse()) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore" });
      else process.kill(-p.pid);
    } catch {}
    log(`stopped ${name}`);
  }
  kids.length = 0;
}

function waitFor(url, ms = 90000) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () =>
      http
        .get(url, (r) => {
          r.resume();
          if (r.statusCode && r.statusCode < 500) resolve();
          else retry();
        })
        .on("error", retry);
    const retry = () => (Date.now() > end ? reject(new Error(`${url} did not answer`)) : setTimeout(tick, 700));
    tick();
  });
}

function run(cmd, argv, cwd) {
  execFileSync(cmd, argv, { cwd, env: ENV, stdio: "inherit", shell: process.platform === "win32" });
}

async function main() {
  process.on("SIGINT", () => {
    stopAll();
    process.exit(130);
  });
  if (!NO_SEED) {
    log("seeding the demo database");
    run("uv", ["run", "python", path.join(__dirname, "seed_demo.py"), "--db-url", ENV.AGENTIC_DATABASE_URL, "--vault-dir", ENV.AGENTIC_VAULT_DIR], API_DIR);
  }
  start("api", "uv", ["run", "uvicorn", "agentic.api.main:app", "--host", "127.0.0.1", "--port", API_PORT, "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"], API_DIR);
  start("worker", "uv", ["run", "python", path.join(__dirname, "demo_worker.py")], API_DIR);
  start("web", "npx", ["vite", "--host", "127.0.0.1", "--port", WEB_PORT, "--strictPort"], WEB_DIR);
  await waitFor(`http://127.0.0.1:${API_PORT}/healthz`);
  await waitFor(`http://127.0.0.1:${WEB_PORT}/`);
  log(`demo office at http://127.0.0.1:${WEB_PORT} (owner@demo.example / demo-office-2026)`);
  if (SERVE_ONLY) {
    log("serving until Ctrl+C");
    return new Promise(() => {});
  }
  try {
    run("node", [path.join(__dirname, "capture.js"), `--base=http://127.0.0.1:${WEB_PORT}`, ...captureArgs], ROOT);
  } finally {
    stopAll();
  }
}

main().catch((e) => {
  console.error(e);
  stopAll();
  process.exit(1);
});
