#!/usr/bin/env node
/* Agentic Office PC agent (P31). docs/PC-AGENT.md is the contract.
 *
 * Runs on a person's own Windows or Mac computer so THEIR OWN AI (their twin or private
 * assistant) can find and read files in the folders they chose, copy files into their
 * workspace, save a file they approved, and drive a visible browser window with a separate
 * "Agent" profile. Node 22+, no npm dependencies: one file the server serves at
 * /downloads/pc-agent/agent.cjs.
 *
 *   agentic-pc status | folders [add|remove <path>] | pause | resume | unlink | logs
 *            | uninstall | run | link <CODE> --server <URL> [--name <name>] | version
 */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const VERSION = "0.1.0";
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const OS_NAME = IS_WIN ? "windows" : IS_MAC ? "mac" : process.platform;
const HOME = os.homedir();

const CONFIG_DIR = process.env.AGENTIC_PC_HOME
  || (IS_WIN ? path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "AgenticOffice")
    : IS_MAC ? path.join(HOME, "Library", "Application Support", "AgenticOffice")
      : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"), "agentic-office"));
const PROGRAM_DIR = process.env.AGENTIC_PC_PROGRAM
  || (IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "AgenticOffice") : CONFIG_DIR);
const CONFIG = path.join(CONFIG_DIR, "config.json");
const ACTIVITY = path.join(CONFIG_DIR, "activity.jsonl");
const LOG = path.join(CONFIG_DIR, "agent.log");
const LOCK = path.join(CONFIG_DIR, "agent.lock");
const PROFILE = path.join(CONFIG_DIR, "browser-profile");
const MAC_PLIST = path.join(HOME, "Library", "LaunchAgents", "space.oriondesk.agentic.pc.plist");
const WIN_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WIN_RUN_NAME = "AgenticOfficePC";

const PING_EVERY = 25_000;
const SILENCE = 70_000; // the server pongs every ping; this long without a word = reconnect
const MAX_MESSAGE = 256 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
const SEARCH_MAX_ENTRIES = 50_000;
const SEARCH_MAX_MS = 8_000;
const LIST_MAX = 500;
const LOG_ROTATE = 2 * 1024 * 1024;

// ---------------------------------------------------------------- what is never reachable

// Folder names refused anywhere in a path (compared lower case).
const DENY_DIRS = new Set([
  ".ssh", ".gnupg", ".gpg", ".aws", ".azure", ".kube", ".docker", "keychains",
  "1password", "bitwarden", "keepass", "keepassxc", "lastpass", "dashlane", "enpass",
  "agenticoffice", "agentic-office", // this program's own token and logs
]);
// Browser profile folders (sequences of path parts, lower case).
const DENY_SEQUENCES = [
  ["google", "chrome"], ["google", "chrome beta"], ["chromium"], ["microsoft", "edge"],
  ["bravesoftware"], ["mozilla", "firefox"], ["firefox", "profiles"], ["library", "safari"],
  ["vivaldi"], ["opera software"], ["library", "cookies"],
];
const DENY_NAMES = new Set(["cookies", "login data", "web data", "local state", "key3.db", "key4.db", "logins.json", "cert9.db"]);
const DENY_EXTS = new Set([".kdbx", ".kdb", ".1pif", ".1pux", ".opvault", ".agilekeychain", ".pem", ".key", ".p12", ".pfx",
  ".keychain", ".keychain-db", ".ppk", ".gpg", ".asc", ".jks", ".keystore"]);
const DENY_PREFIXES = ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", ".env", ".netrc", ".npmrc", ".pypirc", ".git-credentials"];
// Never written to the PC: programs and scripts.
const NO_SAVE_EXTS = new Set([".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".psm1", ".vbs", ".vbe", ".js",
  ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".url", ".reg", ".dll", ".sys", ".cpl", ".jar", ".app", ".pkg", ".dmg",
  ".sh", ".command", ".scpt", ".workflow", ".msix", ".appx"]);
// Folders a search walks past (noise, not secrets).
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "$recycle.bin", "system volume information",
  "appdata", "library", ".trash", ".cache", "__pycache__", ".venv", "venv"]);

const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const samePathCase = IS_WIN || IS_MAC;
const norm = (p) => { const r = path.resolve(p); return samePathCase ? r.toLowerCase() : r; };

/** Why a path is refused whatever the folders, or null. */
function denied(p) {
  const parts = path.resolve(p).split(/[\\/]+/).filter(Boolean).map((x) => x.toLowerCase());
  for (let i = 0; i < parts.length; i++) {
    if (DENY_DIRS.has(parts[i])) return "a private system folder";
    if (i + 1 < parts.length && parts[i] === ".config" && parts[i + 1] === "gcloud") return "a private system folder";
    for (const seq of DENY_SEQUENCES) {
      if (seq.every((s, k) => parts[i + k] === s)) return "a browser's own data";
    }
  }
  const base = parts[parts.length - 1] || "";
  if (DENY_NAMES.has(base)) return "a browser's own data";
  if (DENY_EXTS.has(path.extname(base))) return "a key or password file";
  if (DENY_PREFIXES.some((x) => base.startsWith(x))) return "a key or secrets file";
  return null;
}

function inside(child, parent) {
  const c = norm(child), p = norm(parent);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

class AgentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function realOrSelf(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

/** The real path of `p` if it is inside one of `folders` and not denied; else throws. */
function allowedPath(p, folders) {
  if (typeof p !== "string" || !p.trim() || p.includes("\0")) throw new AgentError("not_allowed", "Give a full path.");
  if (!path.isAbsolute(p)) throw new AgentError("not_allowed", "Give a full path, from the drive (C:) or from /.");
  const real = realOrSelf(p);
  const why = denied(real) || denied(p);
  if (why) throw new AgentError("not_allowed", `That is ${why}; it is never shared with the AI.`);
  const ok = folders.some((f) => inside(real, realOrSelf(f)));
  if (!ok) throw new AgentError("not_allowed", "That is outside the folders shared with the AI.");
  return real;
}

function defaultFolders() {
  const names = ["Documents", "Desktop", "Downloads"];
  const out = [];
  for (const n of names) {
    for (const base of [HOME, path.join(HOME, "OneDrive")]) {
      const p = path.join(base, n);
      try { if (fs.statSync(p).isDirectory() && !out.some((o) => norm(o) === norm(p))) out.push(p); } catch { /* none */ }
    }
  }
  return out;
}

// ---------------------------------------------------------------- config, logs, activity

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; }
}

function writeConfig(cfg) {
  ensureDir(CONFIG_DIR);
  const tmp = CONFIG + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG);
  if (!IS_WIN) { try { fs.chmodSync(CONFIG, 0o600); } catch { /* best effort */ } }
}

function appendRotating(file, line) {
  try {
    ensureDir(CONFIG_DIR);
    try { if (fs.statSync(file).size > LOG_ROTATE) fs.renameSync(file, file + ".1"); } catch { /* new */ }
    fs.appendFileSync(file, line + "\n", { mode: 0o600 });
  } catch { /* logging never stops the agent */ }
}

function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  appendRotating(LOG, line);
  if (process.stdout.isTTY) console.log(line);
}

function activity(method, detail, ok, error) {
  appendRotating(ACTIVITY, JSON.stringify({ ts: new Date().toISOString(), method, ok, ...(error ? { error } : {}), detail }));
}

// ---------------------------------------------------------------- files

function matcher(query) {
  const words = fold(String(query || "")).split(/[\s_\-.]+/).filter(Boolean);
  return (name) => { const n = fold(name); return words.every((w) => n.includes(w)); };
}

async function searchFiles(params, folders) {
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
  const roots = params.folder ? [allowedPath(String(params.folder), folders)] : folders.map(realOrSelf);
  const exts = Array.isArray(params.exts) ? params.exts.map((e) => "." + String(e).toLowerCase().replace(/^\./, "")) : [];
  const after = params.modified_after ? Date.parse(params.modified_after) : NaN;
  const match = matcher(params.query);
  const started = Date.now();
  const found = [];
  let scanned = 0, stopped = false;
  const queue = roots.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } });
  while (queue.length && !stopped) {
    const dir = queue.shift();
    let handle;
    try { handle = await fsp.opendir(dir); } catch { continue; }
    try {
      for await (const ent of handle) {
        if (++scanned > SEARCH_MAX_ENTRIES || Date.now() - started > SEARCH_MAX_MS) { stopped = true; break; }
        if (ent.isSymbolicLink()) continue; // links could lead outside the folders
        const full = path.join(dir, ent.name);
        if (denied(full)) continue;
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name.toLowerCase()) && !ent.name.startsWith(".")) queue.push(full);
          continue;
        }
        if (!ent.isFile()) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.length && !exts.includes(ext)) continue;
        if (!match(ent.name)) continue;
        let st;
        try { st = await fsp.stat(full); } catch { continue; }
        if (!Number.isNaN(after) && st.mtimeMs < after) continue;
        found.push({ path: full, name: ent.name, ext: ext.replace(/^\./, ""), size: st.size, modified: st.mtime.toISOString() });
      }
    } finally {
      try { await handle.close(); } catch { /* already closed by the iterator */ }
    }
  }
  found.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return { items: found.slice(0, limit), truncated: stopped || found.length > limit, scanned };
}

async function listFolder(params, folders) {
  const dir = allowedPath(String(params.folder || ""), folders);
  let st;
  try { st = await fsp.stat(dir); } catch { throw new AgentError("not_found", "There is no such folder."); }
  if (!st.isDirectory()) throw new AgentError("not_found", "That is a file, not a folder.");
  const items = [];
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    if (items.length >= LIST_MAX) break;
    if (ent.isSymbolicLink() || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (denied(full)) continue;
    let s;
    try { s = await fsp.stat(full); } catch { continue; }
    items.push({ path: full, name: ent.name, is_dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, modified: s.mtime.toISOString() });
  }
  items.sort((a, b) => (a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name)));
  return { folder: dir, items };
}

/** File bytes go only to the server this PC is linked to. */
function sameServer(url, server) {
  try {
    const a = new URL(url), b = new URL(server);
    return a.origin === b.origin && (a.protocol === "https:" || a.hostname === "localhost" || a.hostname === "127.0.0.1");
  } catch { return false; }
}

async function uploadFile(params, folders, cfg) {
  const file = allowedPath(String(params.path || ""), folders);
  let st;
  try { st = await fsp.stat(file); } catch { throw new AgentError("not_found", "There is no such file."); }
  if (!st.isFile()) throw new AgentError("not_found", "That is a folder, not a file.");
  const cap = Math.max(1, Math.min(MAX_UPLOAD, Number(params.max_bytes) || MAX_UPLOAD));
  if (st.size > cap) throw new AgentError("too_big", `That file is ${Math.ceil(st.size / 1048576)} MB; the limit is ${Math.floor(cap / 1048576)} MB.`);
  if (!sameServer(params.upload_url, cfg.server)) throw new AgentError("not_allowed", "Files only go to the linked server.");
  const data = await fsp.readFile(file);
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const name = path.basename(file);
  const r = await fetch(params.upload_url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name) },
    body: data,
  });
  if (!r.ok) throw new AgentError(r.status === 413 ? "too_big" : "failed", `The server did not take the file (${r.status}).`);
  return { name, size: data.length, sha256 };
}

function safeName(name) {
  let n = path.basename(String(name || "")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "");
  if (!n) n = "file";
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = "_" + n;
  return n.slice(0, 200);
}

async function saveFile(params, folders, cfg) {
  const folder = allowedPath(String(params.folder || ""), folders);
  try { if (!(await fsp.stat(folder)).isDirectory()) throw new Error(); } catch { throw new AgentError("not_found", "There is no such folder."); }
  const name = safeName(params.name);
  const ext = path.extname(name).toLowerCase();
  if (NO_SAVE_EXTS.has(ext)) throw new AgentError("not_allowed", `The AI never saves programs or scripts (${ext}) to your computer.`);
  if (denied(path.join(folder, name))) throw new AgentError("not_allowed", "That name is not allowed.");
  if (!sameServer(params.download_url, cfg.server)) throw new AgentError("not_allowed", "Files only come from the linked server.");
  const r = await fetch(params.download_url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  if (!r.ok) throw new AgentError("failed", `The server did not send the file (${r.status}).`);
  const data = Buffer.from(await r.arrayBuffer());
  if (data.length > MAX_UPLOAD) throw new AgentError("too_big", "That file is too big.");
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const target = path.join(folder, i === 1 ? name : `${stem} (${i})${ext}`);
    try {
      await fsp.writeFile(target, data, { flag: "wx" }); // never overwrites
      return { path: target, size: data.length };
    } catch (e) {
      if (e.code !== "EEXIST") throw new AgentError("failed", `Could not write the file: ${e.code || e.message}`);
    }
  }
  throw new AgentError("failed", "Too many files with that name.");
}

// ---------------------------------------------------------------- the browser on this PC

function browserCandidates() {
  const env = (k) => process.env[k] || "";
  if (IS_WIN) {
    const pf = env("ProgramFiles") || "C:\\Program Files", pf86 = env("ProgramFiles(x86)") || "C:\\Program Files (x86)", lad = env("LOCALAPPDATA");
    return [
      ["chrome", path.join(pf, "Google", "Chrome", "Application", "chrome.exe")],
      ["chrome", path.join(pf86, "Google", "Chrome", "Application", "chrome.exe")],
      ["chrome", path.join(lad, "Google", "Chrome", "Application", "chrome.exe")],
      ["edge", path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe")],
      ["edge", path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe")],
    ];
  }
  if (IS_MAC) {
    return [
      ["chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      ["chrome", path.join(HOME, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")],
      ["edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    ];
  }
  return [["chrome", "/usr/bin/google-chrome"], ["chrome", "/usr/bin/chromium"], ["chrome", "/usr/bin/chromium-browser"], ["edge", "/usr/bin/microsoft-edge"]];
}

function installedBrowsers() {
  const out = new Map();
  for (const [kind, exe] of browserCandidates()) {
    if (!out.has(kind) && exe && fs.existsSync(exe)) out.set(kind, exe);
  }
  return out;
}

const browserState = { session: null };

async function waitFor(fn, ms, every = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
}

function closeBrowserSession(why) {
  const s = browserState.session;
  if (!s) return;
  browserState.session = null;
  log("browser closed:", why);
  try { s.local?.send(JSON.stringify({ id: 999999999, method: "Browser.close" })); } catch { /* gone */ }
  for (const ws of [s.local, s.remote]) { try { ws?.close(); } catch { /* gone */ } }
  setTimeout(() => { try { s.proc?.kill(); } catch { /* exited */ } }, 3000).unref();
}

async function openBrowser(params, cfg, wsBase) {
  const channel = String(params.channel || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(channel)) throw new AgentError("failed", "Bad channel.");
  if (browserState.session) {
    const s = browserState.session;
    if (s.remote?.readyState === WebSocket.OPEN) throw new AgentError("busy", "The AI is already using the browser on this computer.");
    closeBrowserSession("replaced");
  }
  const browsers = installedBrowsers();
  const kind = browsers.has("chrome") ? "chrome" : browsers.has("edge") ? "edge" : null;
  if (!kind) throw new AgentError("no_browser", "There is no Chrome or Edge on this computer.");
  ensureDir(PROFILE);
  const portFile = path.join(PROFILE, "DevToolsActivePort");
  try { fs.unlinkSync(portFile); } catch { /* none */ }
  let start = "about:blank";
  if (params.start_url) {
    try { const u = new URL(String(params.start_url)); if (u.protocol === "https:" || u.protocol === "http:") start = u.href; } catch { /* keep blank */ }
  }
  const proc = spawn(browsers.get(kind), [
    `--user-data-dir=${PROFILE}`, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
    "--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "--window-size=1280,900", start,
  ], { stdio: "ignore", detached: false, windowsHide: false });
  proc.on("error", (e) => log("browser failed to start:", e.message));
  const port = await waitFor(() => {
    try { const [p, wsPath] = fs.readFileSync(portFile, "utf8").split(/\r?\n/); return p && wsPath ? { port: Number(p), wsPath } : null; } catch { return null; }
  }, 20_000);
  if (!port) { try { proc.kill(); } catch { /* none */ } throw new AgentError("failed", "The browser did not start."); }
  let version = "";
  try { version = (await (await fetch(`http://127.0.0.1:${port.port}/json/version`)).json()).Browser || ""; } catch { /* optional */ }

  const session = { channel, proc, local: null, remote: null };
  browserState.session = session;
  const local = new WebSocket(`ws://127.0.0.1:${port.port}${port.wsPath}`);
  local.binaryType = "arraybuffer";
  session.local = local;
  await new Promise((resolve, reject) => {
    local.onopen = resolve;
    local.onerror = () => reject(new AgentError("failed", "Could not reach the browser's DevTools."));
  });
  const remote = new WebSocket(`${wsBase}/api/devices/cdp/${channel}`);
  remote.binaryType = "arraybuffer";
  session.remote = remote;
  await new Promise((resolve, reject) => {
    remote.onopen = () => { remote.send(JSON.stringify({ type: "hello", token: cfg.token })); resolve(); };
    remote.onerror = () => reject(new AgentError("failed", "Could not open the browser relay."));
  });
  remote.onmessage = (ev) => {
    if (typeof ev.data === "string" && ev.data.startsWith('{"type":"error"')) { closeBrowserSession("relay refused"); return; }
    if (local.readyState === WebSocket.OPEN) local.send(ev.data);
  };
  local.onmessage = (ev) => { if (remote.readyState === WebSocket.OPEN) remote.send(ev.data); };
  remote.onclose = () => { if (browserState.session === session) closeBrowserSession("relay ended"); };
  local.onclose = () => { if (browserState.session === session) closeBrowserSession("window closed"); };
  proc.on("exit", () => { if (browserState.session === session) closeBrowserSession("browser exited"); });
  return { browser: kind, version };
}

// ---------------------------------------------------------------- the connection

function wsBaseOf(server) {
  const u = new URL(server);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href.replace(/\/$/, "");
}

function hello(cfg) {
  return {
    type: "hello", token: cfg.token, version: VERSION, os: OS_NAME, arch: process.arch,
    hostname: os.hostname(), folders: cfg.folders || [], paused: !!cfg.paused, browsers: [...installedBrowsers().keys()],
  };
}

async function handleCall(msg, cfg, wsBase) {
  const folders = (cfg.folders || []).filter((f) => typeof f === "string");
  const p = msg.params && typeof msg.params === "object" ? msg.params : {};
  if (cfg.paused && msg.method !== "system.info") throw new AgentError("paused", "This computer is paused.");
  switch (msg.method) {
    case "system.info":
      return { os: OS_NAME, os_version: os.release(), hostname: os.hostname(), version: VERSION, folders, paused: !!cfg.paused, browsers: [...installedBrowsers().keys()], home: HOME };
    case "files.search": return searchFiles(p, folders);
    case "files.list": return listFolder(p, folders);
    case "files.upload": return uploadFile(p, folders, cfg);
    case "files.save": return saveFile(p, folders, cfg);
    case "browser.open": return openBrowser(p, cfg, wsBase);
    case "browser.close":
      if (browserState.session && (!p.channel || browserState.session.channel === p.channel)) closeBrowserSession("closed by the AI");
      return { closed: true };
    default: throw new AgentError("failed", `Unknown method ${msg.method}.`);
  }
}

function detailOf(method, p) {
  const out = {};
  for (const k of ["query", "folder", "path", "name", "start_url"]) if (p && p[k]) out[k] = String(p[k]).slice(0, 300);
  return out;
}

async function run() {
  let cfg = readConfig();
  if (!cfg.token || !cfg.server) {
    console.error("This computer is not linked yet. Copy the install line from the My computers page.");
    process.exit(1);
  }
  if (!takeLock()) { console.error("The agent is already running."); process.exit(0); }
  const wsBase = wsBaseOf(cfg.server);
  let delay = 2000;
  let stopping = false;
  let current = null;
  log(`agent ${VERSION} starting for ${cfg.server}`);

  // Changes made with the CLI (pause, folders) while this runs: tell the server.
  let lastState = JSON.stringify({ f: cfg.folders, p: !!cfg.paused });
  fs.watchFile(CONFIG, { interval: 2000 }, () => {
    const next = readConfig();
    if (!next.token) { log("unlinked on this computer: stopping"); stopping = true; try { current?.close(); } catch { /* */ } process.exit(0); }
    const st = JSON.stringify({ f: next.folders, p: !!next.paused });
    cfg = { ...cfg, folders: next.folders, paused: !!next.paused };
    if (st !== lastState && current?.readyState === WebSocket.OPEN) {
      lastState = st;
      current.send(JSON.stringify({ type: "state", folders: cfg.folders || [], paused: !!cfg.paused, browsers: [...installedBrowsers().keys()] }));
      if (cfg.paused) closeBrowserSession("paused");
    }
  });

  const connect = () => new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/api/devices/connect`);
    current = ws;
    let lastHeard = Date.now();
    let timer = null;
    const finish = (why) => { clearInterval(timer); log("disconnected:", why); resolve(); };
    ws.onopen = () => {
      ws.send(JSON.stringify(hello(cfg)));
      timer = setInterval(() => {
        if (Date.now() - lastHeard > SILENCE) { try { ws.close(); } catch { /* */ } return; }
        try { ws.send('{"type":"ping"}'); } catch { /* closing */ }
      }, PING_EVERY);
    };
    ws.onmessage = async (ev) => {
      lastHeard = Date.now();
      if (typeof ev.data !== "string" || ev.data.length > MAX_MESSAGE) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== "object") return;
      if (m.type === "welcome") {
        delay = 2000;
        const s = m.settings || {};
        cfg = { ...cfg, device_id: m.device_id, name: m.name, folders: Array.isArray(s.folders) && s.folders.length ? s.folders : cfg.folders, paused: !!s.paused };
        writeConfig({ ...readConfig(), device_id: cfg.device_id, name: cfg.name, folders: cfg.folders, paused: cfg.paused });
        lastState = JSON.stringify({ f: cfg.folders, p: !!cfg.paused });
        log(`linked as "${m.name}"; folders: ${(cfg.folders || []).join(", ")}${cfg.paused ? " (paused)" : ""}`);
      } else if (m.type === "settings") {
        cfg = { ...cfg, folders: Array.isArray(m.folders) ? m.folders : cfg.folders, paused: !!m.paused };
        writeConfig({ ...readConfig(), folders: cfg.folders, paused: cfg.paused });
        lastState = JSON.stringify({ f: cfg.folders, p: !!cfg.paused });
        if (cfg.paused) closeBrowserSession("paused from the web");
        log("settings from the web:", { folders: cfg.folders, paused: cfg.paused });
      } else if (m.type === "error") {
        log("server refused:", m.code, m.message || "");
        if (m.code === "bad_token" || m.code === "revoked") {
          stopping = true;
          const c = readConfig(); delete c.token; writeConfig(c);
          console.error(m.message || "This computer was unlinked.");
        }
      } else if (m.type === "call" && typeof m.id === "string") {
        const started = Date.now();
        try {
          const data = await handleCall(m, cfg, wsBase);
          activity(m.method, detailOf(m.method, m.params), true);
          ws.send(JSON.stringify({ type: "result", id: m.id, ok: true, data }));
        } catch (e) {
          const code = e instanceof AgentError ? e.code : "failed";
          const message = e instanceof AgentError ? e.message : String(e && e.message || e);
          activity(m.method, detailOf(m.method, m.params), false, code);
          try { ws.send(JSON.stringify({ type: "result", id: m.id, ok: false, error: { code, message: message.slice(0, 500) } })); } catch { /* gone */ }
        }
        log(`${m.method} in ${Date.now() - started} ms`);
      }
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = (ev) => finish(`${ev.code}${ev.reason ? " " + ev.reason : ""}`);
  });

  const shutdown = () => { stopping = true; closeBrowserSession("agent stopped"); try { current?.close(); } catch { /* */ } releaseLock(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    await connect();
    if (stopping) break;
    const wait = delay + Math.floor(Math.random() * 1000);
    delay = Math.min(delay * 2, 60_000);
    await new Promise((r) => setTimeout(r, wait));
  }
  releaseLock();
  process.exit(0); // 0: launchd's KeepAlive does not restart an unlinked agent
}

function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function lockPid() {
  try { return Number(fs.readFileSync(LOCK, "utf8").trim()) || 0; } catch { return 0; }
}

function takeLock() {
  ensureDir(CONFIG_DIR);
  if (pidAlive(lockPid())) return false;
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}

function releaseLock() {
  try { if (lockPid() === process.pid) fs.unlinkSync(LOCK); } catch { /* gone */ }
}

// ---------------------------------------------------------------- the command line

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function link(args) {
  const code = String(args[0] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const server = String(arg(args, "--server") || "").replace(/\/+$/, "");
  if (!code || !/^https?:\/\//.test(server)) {
    console.error("Use: agentic-pc link <CODE> --server https://your-office");
    process.exit(1);
  }
  const r = await fetch(`${server}/api/devices/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: String(arg(args, "--name") || ""), os: OS_NAME, arch: process.arch, version: VERSION }),
  });
  let body = {};
  try { body = await r.json(); } catch { /* not json */ }
  if (!r.ok || !body.token) {
    console.error(body?.error?.message || body?.detail || `Could not link this computer (${r.status}).`);
    process.exit(1);
  }
  const old = readConfig();
  writeConfig({ server, token: body.token, device_id: body.device_id, name: body.name, folders: old.folders?.length ? old.folders : defaultFolders(), paused: false });
  console.log(`Linked as "${body.name}".`);
}

function status() {
  const c = readConfig();
  const running = pidAlive(lockPid());
  console.log(`Agentic Office PC agent ${VERSION}`);
  if (!c.token) { console.log("Not linked. Copy the install line from the My computers page."); return; }
  console.log(`Linked as:  ${c.name || "?"}  (${c.server})`);
  console.log(`Running:    ${running ? "yes" : "no"}`);
  console.log(`Paused:     ${c.paused ? "yes (the AI cannot use this computer)" : "no"}`);
  console.log("Folders the AI may see:");
  for (const f of c.folders || []) console.log(`  ${f}`);
  console.log(`Browsers:   ${[...installedBrowsers().keys()].join(", ") || "none"}`);
}

function folders(args) {
  const c = readConfig();
  const list = c.folders || [];
  const [op, p] = args;
  if (op === "add" || op === "remove") {
    if (!p) { console.error(`Use: agentic-pc folders ${op} <path>`); process.exit(1); }
    const full = path.resolve(p);
    if (op === "add") {
      try { if (!fs.statSync(full).isDirectory()) throw new Error(); } catch { console.error("That folder does not exist."); process.exit(1); }
      const why = denied(realOrSelf(full));
      if (why) { console.error(`That is ${why}; it is never shared.`); process.exit(1); }
      if (!list.some((f) => norm(f) === norm(full))) list.push(full);
    } else {
      const i = list.findIndex((f) => norm(f) === norm(full));
      if (i < 0) { console.error("That folder is not shared."); process.exit(1); }
      list.splice(i, 1);
    }
    writeConfig({ ...c, folders: list });
  }
  for (const f of list) console.log(f);
  if (!list.length) console.log("No folders are shared: the AI sees no files.");
}

function setPaused(on) {
  const c = readConfig();
  writeConfig({ ...c, paused: on });
  console.log(on ? "Paused: the AI cannot use this computer until you resume." : "Resumed.");
}

async function unlink(quiet) {
  const c = readConfig();
  if (c.token && c.server) {
    try {
      await fetch(`${c.server}/api/devices/self/unlink`, {
        method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, body: "{}",
      });
    } catch { /* offline: the web page can still unlink it */ }
  }
  delete c.token;
  delete c.device_id;
  writeConfig(c);
  if (!quiet) console.log("Unlinked. The AI can no longer reach this computer.");
}

function logs() {
  let lines = [];
  try { lines = fs.readFileSync(ACTIVITY, "utf8").trim().split("\n").slice(-30); } catch { /* none */ }
  if (!lines.length || !lines[0]) { console.log("Nothing yet."); return; }
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const what = e.detail?.path || e.detail?.query || e.detail?.folder || e.detail?.start_url || "";
      console.log(`${e.ts.replace("T", " ").slice(0, 19)}  ${e.ok ? "ok " : "NO "} ${e.method.padEnd(13)} ${what}${e.error ? `  (${e.error})` : ""}`);
    } catch { /* skip */ }
  }
}

async function uninstall() {
  await unlink(true);
  const pid = lockPid();
  if (pidAlive(pid)) { try { process.kill(pid); } catch { /* gone */ } }
  if (IS_WIN) {
    spawnSync("reg", ["delete", WIN_RUN_KEY, "/v", WIN_RUN_NAME, "/f"], { stdio: "ignore" });
    const bin = path.join(PROGRAM_DIR, "bin");
    const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p) { [Environment]::SetEnvironmentVariable('Path', (($p -split ';') | Where-Object { $_ -and $_ -ne '${bin.replace(/'/g, "''")}' }) -join ';', 'User') }`;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true });
    await new Promise((r) => setTimeout(r, 1000)); // the stopped agent lets go of its log files
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    try { fs.rmSync(path.join(PROGRAM_DIR, "agent"), { recursive: true, force: true }); } catch { /* best effort */ }
    // node.exe (running this) cannot delete itself: remove the program folder a moment after
    // it exits, and once more at the next sign-in in case that is cut short.
    const rm = `rmdir /s /q "${PROGRAM_DIR}"`;
    spawnSync("reg", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce", "/v", "AgenticOfficeCleanup", "/d", `cmd.exe /d /c ${rm}`, "/f"], { stdio: "ignore" });
    spawn("cmd.exe", ["/d", "/c", `ping -n 3 127.0.0.1 >nul & ${rm}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (IS_MAC) {
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/space.oriondesk.agentic.pc`], { stdio: "ignore" });
    try { fs.unlinkSync(MAC_PLIST); } catch { /* none */ }
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  } else {
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  }
  console.log("Uninstalled: unlinked, stopped, removed from startup, and its files are deleted.");
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "link": return link(rest);
    case "run": return run();
    case "status": case undefined: return status();
    case "folders": return folders(rest);
    case "pause": return setPaused(true);
    case "resume": return setPaused(false);
    case "unlink": return unlink(false);
    case "logs": return logs();
    case "uninstall": return uninstall();
    case "version": case "--version": console.log(VERSION); return undefined;
    default:
      console.log("agentic-pc status | folders [add|remove <path>] | pause | resume | unlink | logs | uninstall | run | version");
      return undefined;
  }
}

module.exports = { denied, allowedPath, inside, safeName, sameServer, searchFiles, listFolder, matcher, NO_SAVE_EXTS, AgentError, VERSION };

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
