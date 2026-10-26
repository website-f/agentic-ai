#!/usr/bin/env node
/* Agentic Office PC agent (P31). docs/PC-AGENT.md is the contract.
 *
 * Runs on a person's own Windows, Mac or Linux computer so THEIR OWN AI (their twin or private
 * assistant) can find and read files in the folders they chose, copy files into their
 * workspace, save a file they approved, and drive a visible browser window with a separate
 * "Agent" profile. Node 22+, no npm dependencies: one file the server serves at
 * /downloads/pc-agent/agent.cjs.
 *
 *   agentic-pc status | folders [add|remove <path>] | remote [off|view|control] | pause | resume | unlink | logs
 *            | uninstall | run | link <CODE> --server <URL> [--name <name>] | version
 */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const VERSION = "0.2.0";
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

// ---------------------------------------------------------------- health, screen, mouse and keys (P42)

// Only for the computer's own person, from the web (never an AI), and only as far as this
// computer allows: `agentic-pc remote off | view | control`. Off until they choose.
const REMOTE_LEVELS = ["off", "view", "control"];
const NOTIFY_AFTER = 120_000; // a new remote session after this long quiet shows a notice here
const remoteSeen = { view: 0, control: 0 };

function remoteOf(cfg) { return REMOTE_LEVELS.includes(cfg.remote) ? cfg.remote : "off"; }

function needRemote(cfg, level) {
  if (REMOTE_LEVELS.indexOf(remoteOf(cfg)) >= REMOTE_LEVELS.indexOf(level)) return;
  throw new AgentError("not_allowed", `Remote ${level} is off on this computer. On it, run: agentic-pc remote ${level}`);
}

function has(cmd) {
  const r = spawnSync(IS_WIN ? "where" : "which", [cmd], { stdio: "ignore", windowsHide: true });
  return r.status === 0;
}

function notify(title, body) {
  try {
    if (IS_WIN) {
      const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(10000, $env:AGENTIC_TITLE, $env:AGENTIC_BODY, 'Info')
Start-Sleep -Seconds 11
$n.Dispose()`;
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")],
        { env: { ...process.env, AGENTIC_TITLE: title, AGENTIC_BODY: body }, detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (IS_MAC) {
      const js = "var e=$.NSProcessInfo.processInfo.environment; var a=Application.currentApplication(); a.includeStandardAdditions=true; "
        + "a.displayNotification(e.objectForKey('AGENTIC_BODY').js, {withTitle: e.objectForKey('AGENTIC_TITLE').js})";
      spawn("osascript", ["-l", "JavaScript", "-e", js], { env: { ...process.env, AGENTIC_TITLE: title, AGENTIC_BODY: body }, detached: true, stdio: "ignore" }).unref();
    } else if (has("notify-send")) {
      spawn("notify-send", ["-u", "critical", "--", title, body], { detached: true, stdio: "ignore" }).unref();
    }
  } catch { /* the activity log still has it */ }
}

/** The person sees on the computer itself that it is being watched or used. */
function remoteStarted(level) {
  const now = Date.now();
  const quiet = now - remoteSeen[level] > NOTIFY_AFTER;
  remoteSeen[level] = now;
  if (!quiet) return;
  log(`remote ${level} started from the web`);
  notify("Agentic Office", level === "control"
    ? "Your computer is being controlled from the web (Agentic Office). To stop it: agentic-pc remote off"
    : "Your screen is being viewed from the web (Agentic Office). To stop it: agentic-pc remote off");
}

async function cpuBusy(ms = 300) {
  const take = () => os.cpus().reduce((s, c) => { const t = c.times; s.idle += t.idle; s.all += t.user + t.nice + t.sys + t.idle + t.irq; return s; }, { idle: 0, all: 0 });
  const a = take();
  await new Promise((r) => setTimeout(r, ms));
  const b = take();
  const all = b.all - a.all;
  return all > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / all)) : null;
}

async function diskOf(p) {
  try {
    const s = await fsp.statfs(p);
    return { path: p, total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch { return null; }
}

async function health(cfg, folders) {
  const roots = [IS_WIN ? path.parse(HOME).root : "/", ...folders];
  const seen = new Set();
  const disks = [];
  for (const r of roots) {
    const d = await diskOf(r);
    if (!d || seen.has(`${d.total}:${d.free}`)) continue; // the same drive twice
    seen.add(`${d.total}:${d.free}`);
    disks.push(d);
  }
  const cpus = os.cpus();
  return {
    os: OS_NAME, os_version: os.release(), hostname: os.hostname(), arch: process.arch, version: VERSION,
    uptime_s: Math.round(os.uptime()), agent_uptime_s: Math.round(process.uptime()),
    cpu: { model: (cpus[0] && cpus[0].model || "").trim(), cores: cpus.length, busy_pct: await cpuBusy(), load: IS_WIN ? null : os.loadavg().map((l) => Math.round(l * 100) / 100) },
    memory: { total: os.totalmem(), free: os.freemem() },
    disks,
    user: os.userInfo().username,
    paused: !!cfg.paused, remote: remoteOf(cfg), folders: folders.length,
  };
}

// Windows: a small helper program, compiled once on this computer with the C# compiler that
// comes with Windows (.NET Framework 4), does the screen and the mouse and keys. Antivirus
// rightly distrusts PowerShell scripts that grab the screen; an ordinary program is how
// remote-desktop tools do it. Its source is right here, and it is rebuilt when this changes.
const WIN_HELPER_CS = `using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

static class AgenticPcHelper {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
  static void Btn(uint down, uint up) { mouse_event(down, 0, 0, 0, UIntPtr.Zero); mouse_event(up, 0, 0, 0, UIntPtr.Zero); }
  static int Px(string frac, int size, int offset) {
    double f = Math.Max(0, Math.Min(1, double.Parse(frac, CultureInfo.InvariantCulture)));
    return offset + (int)Math.Round(f * (size - 1));
  }

  [STAThread]
  static int Main(string[] a) {
    SetProcessDPIAware();
    Rectangle b = SystemInformation.VirtualScreen;
    try {
      if (a[0] == "shot") {  // shot <out.jpg> <max width> <quality>
        int w = Math.Min(int.Parse(a[2]), b.Width);
        int h = (int)Math.Round((double)b.Height * w / b.Width);
        using (Bitmap full = new Bitmap(b.Width, b.Height))
        using (Graphics g = Graphics.FromImage(full)) {
          g.CopyFromScreen(b.Left, b.Top, 0, 0, full.Size);
          using (Bitmap small = new Bitmap(w, h))
          using (Graphics g2 = Graphics.FromImage(small)) {
            g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
            g2.DrawImage(full, 0, 0, w, h);
            ImageCodecInfo jpeg = ImageCodecInfo.GetImageEncoders().First(e => e.MimeType == "image/jpeg");
            EncoderParameters ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, long.Parse(a[3]));
            small.Save(a[1], jpeg, ep);
          }
        }
        Console.WriteLine(b.Width + " " + b.Height);
        return 0;
      }
      if (a[0] == "mouse") {  // mouse <x 0..1> <y 0..1> <move|click|double|right|scroll> <dy> [dry]
        int x = Px(a[1], b.Width, b.Left), y = Px(a[2], b.Height, b.Top);
        if (a.Length > 5 && a[5] == "dry") { Console.WriteLine(x + " " + y); return 0; }
        SetCursorPos(x, y);
        if (a[3] == "click") Btn(2, 4);
        if (a[3] == "double") { Btn(2, 4); Thread.Sleep(70); Btn(2, 4); }
        if (a[3] == "right") Btn(8, 16);
        if (a[3] == "scroll") mouse_event(0x800, 0, 0, -120 * int.Parse(a[4]), UIntPtr.Zero);
        Console.WriteLine("ok");
        return 0;
      }
      if (a[0] == "keys") {  // keys [dry]; the SendKeys text is in AGENTIC_KEYS
        string keys = Environment.GetEnvironmentVariable("AGENTIC_KEYS") ?? "";
        if (a.Length > 1 && a[1] == "dry") { Console.WriteLine(keys); return 0; }
        SendKeys.SendWait(keys);
        Console.WriteLine("ok");
        return 0;
      }
    } catch (Exception e) {
      Console.Error.WriteLine(e.Message);
      return 1;
    }
    return 2;
  }
}
`;

let winHelperPath = null;
/** The helper program, compiled on first use (and again when its source changes). */
function winHelper() {
  if (winHelperPath && fs.existsSync(winHelperPath)) return winHelperPath;
  const hash = crypto.createHash("sha256").update(WIN_HELPER_CS).digest("hex").slice(0, 10);
  const dir = path.join(PROGRAM_DIR, "helper");
  const exe = path.join(dir, `agentic-pc-helper-${hash}.exe`);
  if (!fs.existsSync(exe)) {
    const windir = process.env.WINDIR || "C:\Windows";
    const csc = [path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"), path.join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")]
      .find((c) => fs.existsSync(c));
    if (!csc) throw new AgentError("no_screen", "This Windows has no .NET Framework 4, which seeing the screen needs.");
    ensureDir(dir);
    for (const old of fs.readdirSync(dir)) if (old.startsWith("agentic-pc-helper-")) fs.rmSync(path.join(dir, old), { force: true });
    const src = path.join(dir, `agentic-pc-helper-${hash}.cs`);
    fs.writeFileSync(src, WIN_HELPER_CS);
    const r = spawnSync(csc, ["/nologo", "/target:exe", "/optimize+", `/out:${exe}`,
      "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll", "/r:System.Core.dll", src], { encoding: "utf8", timeout: 60_000, windowsHide: true });
    fs.rmSync(src, { force: true });
    if (r.status !== 0 || !fs.existsSync(exe)) {
      log("helper did not build:", (r.stdout || r.stderr || "").slice(0, 500));
      throw new AgentError("no_screen", "Could not build the screen helper on this computer.");
    }
  }
  winHelperPath = exe;
  return exe;
}

function runHelper(args, env = {}, timeout = 20_000) {
  return spawnSync(winHelper(), args, { env: { ...process.env, ...env }, encoding: "utf8", timeout, windowsHide: true });
}

function sizeFromSips(file) {
  const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const w = /pixelWidth:\s*(\d+)/.exec(r.stdout || ""), h = /pixelHeight:\s*(\d+)/.exec(r.stdout || "");
  return w && h ? [Number(w[1]), Number(h[1])] : [0, 0];
}

/** One JPEG of the whole screen, at most `w` wide. Returns [width, height] of the real screen. */
function captureTo(file, w, q) {
  if (IS_WIN) {
    const r = runHelper(["shot", file, String(w), String(q)]);
    const m = /(\d+) (\d+)/.exec(r.stdout || "");
    if (r.status !== 0 || !m) throw new AgentError("no_screen", "Could not take a picture of the screen (is it locked, or is nobody signed in?).");
    return [Number(m[1]), Number(m[2])];
  }
  if (IS_MAC) {
    const r = spawnSync("screencapture", ["-x", "-t", "jpg", file], { timeout: 15_000 });
    if (r.status !== 0 || !fs.existsSync(file)) {
      throw new AgentError("no_screen", "macOS did not allow a screen picture. Allow it in System Settings > Privacy & Security > Screen Recording for the program running agentic-pc (Terminal or node).");
    }
    const size = sizeFromSips(file);
    spawnSync("sips", ["--resampleWidth", String(Math.min(w, size[0] || w)), "-s", "formatOptions", String(q), file], { stdio: "ignore", timeout: 15_000 });
    return size;
  }
  const wayland = !!process.env.WAYLAND_DISPLAY;
  let r;
  if (wayland && has("grim")) r = spawnSync("grim", ["-t", "jpeg", "-q", String(q), file], { timeout: 15_000 });
  else if (has("import")) r = spawnSync("import", ["-silent", "-window", "root", "-quality", String(q), file], { timeout: 15_000 });
  else throw new AgentError("no_screen", wayland ? "Install grim to see this screen from the web." : "Install ImageMagick (the import command) to see this screen from the web.");
  if (r.status !== 0 || !fs.existsSync(file)) throw new AgentError("no_screen", "Could not take a picture of the screen.");
  let size = [0, 0];
  if (has("identify")) {
    const id = spawnSync("identify", ["-format", "%w %h", file], { encoding: "utf8" });
    const m = /(\d+) (\d+)/.exec(id.stdout || "");
    if (m) size = [Number(m[1]), Number(m[2])];
  }
  if (has("convert") && size[0] > w) spawnSync("convert", [file, "-resize", `${w}x`, "-quality", String(q), file], { stdio: "ignore", timeout: 15_000 });
  return size;
}

async function captureScreen(params, cfg) {
  needRemote(cfg, "view");
  if (!sameServer(params.upload_url, cfg.server)) throw new AgentError("not_allowed", "The screen only goes to the linked server.");
  const w = Math.max(320, Math.min(3840, Number(params.max_width) || 1600));
  const q = Math.max(20, Math.min(90, Number(params.quality) || 65));
  remoteStarted("view");
  const file = path.join(os.tmpdir(), `agentic-screen-${crypto.randomBytes(6).toString("hex")}.jpg`);
  try {
    const [sw, sh] = captureTo(file, w, q);
    const data = await fsp.readFile(file);
    const cap = Math.max(1, Math.min(MAX_UPLOAD, Number(params.max_bytes) || MAX_UPLOAD));
    if (data.length > cap) throw new AgentError("too_big", "The screen picture is too big; try a smaller size.");
    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    const r = await fetch(params.upload_url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/octet-stream", "X-File-Name": "screen.jpg" },
      body: data,
    });
    if (!r.ok) throw new AgentError("failed", `The server did not take the picture (${r.status}).`);
    return { name: "screen.jpg", size: data.length, sha256, screen_width: sw, screen_height: sh };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

// Named keys the web may send: our name -> [Windows SendKeys, macOS key code, xdotool name].
const KEYS = {
  enter: ["{ENTER}", 36, "Return"], tab: ["{TAB}", 48, "Tab"], esc: ["{ESC}", 53, "Escape"],
  backspace: ["{BACKSPACE}", 51, "BackSpace"], delete: ["{DELETE}", 117, "Delete"], space: [" ", 49, "space"],
  up: ["{UP}", 126, "Up"], down: ["{DOWN}", 125, "Down"], left: ["{LEFT}", 123, "Left"], right: ["{RIGHT}", 124, "Right"],
  home: ["{HOME}", 115, "Home"], end: ["{END}", 119, "End"], pageup: ["{PGUP}", 116, "Prior"], pagedown: ["{PGDN}", 121, "Next"],
  f1: ["{F1}", 122, "F1"], f2: ["{F2}", 120, "F2"], f3: ["{F3}", 99, "F3"], f4: ["{F4}", 118, "F4"], f5: ["{F5}", 96, "F5"],
  f6: ["{F6}", 97, "F6"], f7: ["{F7}", 98, "F7"], f8: ["{F8}", 100, "F8"], f9: ["{F9}", 101, "F9"], f10: ["{F10}", 109, "F10"],
  f11: ["{F11}", 103, "F11"], f12: ["{F12}", 111, "F12"],
};
const MODS = { ctrl: ["^", "control down", "ctrl"], alt: ["%", "option down", "alt"], shift: ["+", "shift down", "shift"], cmd: [null, "command down", "super"] };

/** "ctrl+shift+t" -> { mods: ["ctrl","shift"], key: "t" }; refuses anything else. */
function parseCombo(combo) {
  const parts = String(combo || "").toLowerCase().split("+").filter(Boolean);
  const key = parts.pop();
  if (!key || (!KEYS[key] && !/^[a-z0-9]$/.test(key))) throw new AgentError("not_allowed", `Unknown key: ${combo}`);
  for (const m of parts) if (!MODS[m]) throw new AgentError("not_allowed", `Unknown key: ${combo}`);
  return { mods: [...new Set(parts)], key };
}

/** Windows SendKeys: text typed as it is (its special characters braced), or one combination. */
function sendKeysText(text) { return String(text).replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}"); }
function sendKeysCombo(combo) {
  const { mods, key } = parseCombo(combo);
  if (mods.includes("cmd")) throw new AgentError("not_allowed", "The Windows key cannot be sent from the web.");
  return mods.map((m) => MODS[m][0]).join("") + (KEYS[key] ? KEYS[key][0] : key);
}
function xdoCombo(combo) {
  const { mods, key } = parseCombo(combo);
  return [...mods.map((m) => MODS[m][2]), KEYS[key] ? KEYS[key][2] : key].join("+");
}
function macCombo(combo) {
  const { mods, key } = parseCombo(combo);
  return { code: KEYS[key] ? KEYS[key][1] : null, char: KEYS[key] ? null : key, using: mods.map((m) => MODS[m][1]) };
}

/** A share of the screen (0..1) to a pixel on it. */
function toPixel(frac, size, offset = 0) {
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  return offset + Math.round(f * Math.max(0, size - 1));
}

const MAC_INPUT = `ObjC.import('CoreGraphics'); ObjC.import('AppKit');
var p = JSON.parse($.NSProcessInfo.processInfo.environment.objectForKey('AGENTIC_INPUT').js);
if (p.kind === 'mouse') {
  var f = $.NSScreen.screens.objectAtIndex(0).frame;
  var pt = $.CGPointMake(Math.round(p.x * (f.size.width - 1)), Math.round(p.y * (f.size.height - 1)));
  var post = function (type, button, clicks) { var e = $.CGEventCreateMouseEvent($(), type, pt, button); if (clicks) $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, clicks); $.CGEventPost($.kCGHIDEventTap, e); };
  post($.kCGEventMouseMoved, $.kCGMouseButtonLeft, 0);
  if (p.action === 'click' || p.action === 'double') { post($.kCGEventLeftMouseDown, $.kCGMouseButtonLeft, 1); post($.kCGEventLeftMouseUp, $.kCGMouseButtonLeft, 1); }
  if (p.action === 'double') { post($.kCGEventLeftMouseDown, $.kCGMouseButtonLeft, 2); post($.kCGEventLeftMouseUp, $.kCGMouseButtonLeft, 2); }
  if (p.action === 'right') { post($.kCGEventRightMouseDown, $.kCGMouseButtonRight, 1); post($.kCGEventRightMouseUp, $.kCGMouseButtonRight, 1); }
  if (p.action === 'scroll') { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateScrollWheelEvent($(), $.kCGScrollEventUnitLine, 1, -p.dy)); }
} else {
  var se = Application('System Events');
  if (p.text) se.keystroke(p.text);
  else if (p.combo.code !== null) se.keyCode(p.combo.code, { using: p.combo.using });
  else se.keystroke(p.combo.char, { using: p.combo.using });
}
'ok';`;

function sendInput(params, cfg) {
  needRemote(cfg, "control");
  remoteStarted("control");
  const kind = params.kind === "key" ? "key" : "mouse";
  const action = ["move", "click", "double", "right", "scroll"].includes(params.action) ? params.action : "click";
  const dy = Math.max(-20, Math.min(20, Math.trunc(Number(params.dy) || 0)));
  const text = String(params.text || "").slice(0, 2000);
  const key = String(params.key || "");
  if (kind === "key" && !text && !key) throw new AgentError("failed", "Nothing to type.");
  let r;
  if (IS_WIN) {
    if (kind === "key") r = runHelper(["keys"], { AGENTIC_KEYS: text ? sendKeysText(text) : sendKeysCombo(key) });
    else r = runHelper(["mouse", String(Math.max(0, Math.min(1, Number(params.x) || 0))), String(Math.max(0, Math.min(1, Number(params.y) || 0))), action, String(dy)]);
  } else if (IS_MAC) {
    const combo = kind === "key" && !text ? macCombo(key) : null;
    r = spawnSync("osascript", ["-l", "JavaScript", "-e", MAC_INPUT],
      { env: { ...process.env, AGENTIC_INPUT: JSON.stringify({ kind, x: params.x, y: params.y, action, dy, text, combo }) }, encoding: "utf8", timeout: 15_000 });
    if (r.status !== 0) throw new AgentError("not_allowed", "macOS did not allow it. Allow the program running agentic-pc in System Settings > Privacy & Security > Accessibility.");
  } else {
    if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) throw new AgentError("not_allowed", "Remote control needs an X11 session (xdotool) on Linux.");
    if (!has("xdotool")) throw new AgentError("not_allowed", "Install xdotool to control this computer from the web.");
    let args;
    if (kind === "key") args = text ? ["type", "--delay", "8", "--", text] : ["key", "--", xdoCombo(key)];
    else {
      const g = /(\d+) (\d+)/.exec(spawnSync("xdotool", ["getdisplaygeometry"], { encoding: "utf8" }).stdout || "");
      if (!g) throw new AgentError("no_screen", "Could not find the screen.");
      args = ["mousemove", "--sync", String(toPixel(params.x, Number(g[1]))), String(toPixel(params.y, Number(g[2])))];
      if (action === "click") args.push("click", "1");
      if (action === "double") args.push("click", "--repeat", "2", "1");
      if (action === "right") args.push("click", "3");
      if (action === "scroll" && dy) args.push("click", "--repeat", String(Math.abs(dy)), dy > 0 ? "5" : "4");
    }
    r = spawnSync("xdotool", args, { encoding: "utf8", timeout: 15_000 });
  }
  if (r.status !== 0) throw new AgentError("failed", "The computer did not take the input (is the screen locked?).");
  return { done: true };
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
    remote: remoteOf(cfg),
  };
}

async function handleCall(msg, cfg, wsBase) {
  const folders = (cfg.folders || []).filter((f) => typeof f === "string");
  const p = msg.params && typeof msg.params === "object" ? msg.params : {};
  if (cfg.paused && msg.method !== "system.info" && msg.method !== "system.health") throw new AgentError("paused", "This computer is paused.");
  switch (msg.method) {
    case "system.info":
      return { os: OS_NAME, os_version: os.release(), hostname: os.hostname(), version: VERSION, folders, paused: !!cfg.paused, browsers: [...installedBrowsers().keys()], home: HOME };
    case "system.health": return health(cfg, folders);
    case "screen.capture": return captureScreen(p, cfg);
    case "input.send": return sendInput(p, cfg);
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
  if (method === "input.send" && p) out.action = p.kind === "key" ? "keys" : String(p.action || "click"); // never what was typed
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
  const stateOf = (c) => JSON.stringify({ f: c.folders, p: !!c.paused, r: remoteOf(c) });
  let lastState = stateOf(cfg);
  fs.watchFile(CONFIG, { interval: 2000 }, () => {
    const next = readConfig();
    if (!next.token) { log("unlinked on this computer: stopping"); stopping = true; try { current?.close(); } catch { /* */ } process.exit(0); }
    const st = stateOf(next);
    cfg = { ...cfg, folders: next.folders, paused: !!next.paused, remote: remoteOf(next) };
    if (st !== lastState && current?.readyState === WebSocket.OPEN) {
      lastState = st;
      current.send(JSON.stringify({ type: "state", folders: cfg.folders || [], paused: !!cfg.paused, remote: remoteOf(cfg), browsers: [...installedBrowsers().keys()] }));
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
        lastState = stateOf(cfg);
        log(`linked as "${m.name}"; folders: ${(cfg.folders || []).join(", ")}${cfg.paused ? " (paused)" : ""}`);
      } else if (m.type === "settings") {
        cfg = { ...cfg, folders: Array.isArray(m.folders) ? m.folders : cfg.folders, paused: !!m.paused };
        writeConfig({ ...readConfig(), folders: cfg.folders, paused: cfg.paused });
        lastState = stateOf(cfg);
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
  console.log(`Remote:     ${remoteOf(c)} (you, from the web: off | view the screen | control mouse and keys)`);
}

function remote(args) {
  const c = readConfig();
  const [level] = args;
  if (level !== undefined) {
    if (!REMOTE_LEVELS.includes(level)) { console.error("Use: agentic-pc remote off | view | control"); process.exit(1); }
    writeConfig({ ...c, remote: level });
  }
  const now = level || remoteOf(c);
  console.log({
    off: "Remote is off: nobody can see or use this screen from the web.",
    view: "Remote view is on: you can see this screen from the web (you also turn it on there, with your password). A notice shows here when someone looks.",
    control: "Remote control is on: you can see this screen and use its mouse and keyboard from the web (you also turn it on there, with your password). A notice shows here when it starts.",
  }[now]);
  if (now !== "off") console.log("Turn it off any time: agentic-pc remote off");
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
    const xdg = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
    spawnSync("systemctl", ["--user", "disable", "--now", "agentic-pc.service"], { stdio: "ignore" });
    for (const f of [path.join(xdg, "systemd", "user", "agentic-pc.service"), path.join(xdg, "autostart", "agentic-pc.desktop")]) {
      try { fs.unlinkSync(f); } catch { /* none */ }
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
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
    case "remote": return remote(rest);
    case "pause": return setPaused(true);
    case "resume": return setPaused(false);
    case "unlink": return unlink(false);
    case "logs": return logs();
    case "uninstall": return uninstall();
    case "version": case "--version": console.log(VERSION); return undefined;
    default:
      console.log("agentic-pc status | folders [add|remove <path>] | remote [off|view|control] | pause | resume | unlink | logs | uninstall | run | version");
      return undefined;
  }
}

module.exports = {
  denied, allowedPath, inside, safeName, sameServer, searchFiles, listFolder, matcher, NO_SAVE_EXTS, AgentError, VERSION,
  needRemote, parseCombo, sendKeysText, sendKeysCombo, xdoCombo, macCombo, toPixel, health, runHelper,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
