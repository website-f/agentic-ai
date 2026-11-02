// node --test apps/pc-agent/agent.test.cjs
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.AGENTIC_PC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-pc-home-"));
process.env.AGENTIC_PC_PROGRAM = process.env.AGENTIC_PC_HOME;
const a = require("./agent.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-pc-"));
const shared = path.join(root, "Documents");
const other = path.join(root, "Other");
fs.mkdirSync(path.join(shared, "Quotes", "2026"), { recursive: true });
fs.mkdirSync(path.join(shared, ".ssh"), { recursive: true });
fs.mkdirSync(path.join(shared, "Google", "Chrome", "User Data"), { recursive: true });
fs.mkdirSync(other, { recursive: true });
fs.writeFileSync(path.join(shared, "Quotes", "2026", "Sebut Harga Pengawal Keselamatan.pdf"), "x");
fs.writeFileSync(path.join(shared, "Quotes", "quote-old.docx"), "x");
fs.writeFileSync(path.join(shared, ".ssh", "id_rsa"), "secret");
fs.writeFileSync(path.join(shared, "Google", "Chrome", "User Data", "Login Data"), "secret");
fs.writeFileSync(path.join(shared, "vault.kdbx"), "secret");
fs.writeFileSync(path.join(shared, ".env.local"), "secret");
fs.writeFileSync(path.join(other, "private.pdf"), "x");

test("files inside a shared folder are allowed", () => {
  const p = path.join(shared, "Quotes", "quote-old.docx");
  assert.equal(path.resolve(a.allowedPath(p, [shared])).toLowerCase(), fs.realpathSync.native(p).toLowerCase());
});

test("outside the shared folders is refused, including ../ escapes", () => {
  assert.throws(() => a.allowedPath(path.join(other, "private.pdf"), [shared]), { code: "not_allowed" });
  assert.throws(() => a.allowedPath(path.join(shared, "..", "Other", "private.pdf"), [shared]), { code: "not_allowed" });
  assert.throws(() => a.allowedPath("relative/file.pdf", [shared]), { code: "not_allowed" });
});

test("keys, password vaults, browser data and .env are refused even inside a shared folder", () => {
  for (const p of [
    path.join(shared, ".ssh", "id_rsa"),
    path.join(shared, "Google", "Chrome", "User Data", "Login Data"),
    path.join(shared, "vault.kdbx"),
    path.join(shared, ".env.local"),
  ]) assert.throws(() => a.allowedPath(p, [shared]), { code: "not_allowed" }, p);
});

test("search matches all words, accent and case blind, never shows denied files", async () => {
  const out = await a.searchFiles({ query: "sebut harga" }, [shared]);
  assert.deepEqual(out.items.map((i) => i.name), ["Sebut Harga Pengawal Keselamatan.pdf"]);
  const all = await a.searchFiles({ query: "" }, [shared]);
  const names = all.items.map((i) => i.name);
  assert.ok(!names.includes("id_rsa") && !names.includes("Login Data") && !names.includes("vault.kdbx") && !names.includes(".env.local"));
  const docx = await a.searchFiles({ query: "quote", exts: ["docx"] }, [shared]);
  assert.deepEqual(docx.items.map((i) => i.name), ["quote-old.docx"]);
});

test("listing hides dot folders and denied entries", async () => {
  const out = await a.listFolder({ folder: shared }, [shared]);
  const names = out.items.map((i) => i.name);
  assert.ok(names.includes("Quotes"));
  assert.ok(!names.includes(".ssh") && !names.includes("vault.kdbx"));
});

test("saved names are made safe and programs are never saved", () => {
  assert.equal(a.safeName("..\\..\\evil.pdf"), "evil.pdf");
  assert.equal(a.safeName("a<b>:c.txt"), "a_b__c.txt");
  assert.equal(a.safeName("CON.txt"), "_CON.txt");
  for (const ext of [".exe", ".ps1", ".bat", ".vbs", ".lnk", ".sh"]) assert.ok(a.NO_SAVE_EXTS.has(ext));
});

test("file bytes only travel to the linked server", () => {
  assert.ok(a.sameServer("https://agent.oriondesk.space/api/devices/uploads/x", "https://agent.oriondesk.space"));
  assert.ok(!a.sameServer("https://evil.example/api/devices/uploads/x", "https://agent.oriondesk.space"));
  assert.ok(!a.sameServer("http://agent.oriondesk.space/x", "https://agent.oriondesk.space"));
  assert.ok(a.sameServer("http://localhost:8500/x", "http://localhost:8500"));
});

// ---------------------------------------------------------------- P42 remote

test("remote needs the level allowed on this computer", () => {
  assert.throws(() => a.needRemote({}, "view"), (e) => e.code === "not_allowed");
  assert.throws(() => a.needRemote({ remote: "view" }, "control"), (e) => e.code === "not_allowed");
  assert.throws(() => a.needRemote({ remote: "everything" }, "view"), (e) => e.code === "not_allowed");
  a.needRemote({ remote: "view" }, "view");
  a.needRemote({ remote: "control" }, "view");
  a.needRemote({ remote: "control" }, "control");
});

test("typed text is sent as text, never as SendKeys commands", () => {
  assert.equal(a.sendKeysText("50% off (today) {x} a+b ^c ~"), "50{%} off {(}today{)} {{}x{}} a{+}b {^}c {~}");
  assert.equal(a.sendKeysText("line1\nline2"), "line1{ENTER}line2");
});

test("key combinations map per system and refuse unknown keys", () => {
  assert.equal(a.sendKeysCombo("ctrl+c"), "^c");
  assert.equal(a.sendKeysCombo("ctrl+shift+esc"), "^+{ESC}");
  assert.equal(a.sendKeysCombo("alt+f4"), "%{F4}");
  assert.equal(a.sendKeysCombo("enter"), "{ENTER}");
  assert.equal(a.xdoCombo("ctrl+alt+t"), "ctrl+alt+t");
  assert.equal(a.xdoCombo("pagedown"), "Next");
  assert.deepEqual(a.macCombo("cmd+c"), { code: null, char: "c", using: ["command down"] });
  assert.deepEqual(a.macCombo("shift+tab"), { code: 48, char: null, using: ["shift down"] });
  for (const bad of ["ctrl+", "hyper+c", "ctrl+cc", "rm -rf", "ctrl+{ENTER}"]) {
    assert.throws(() => a.parseCombo(bad), (e) => e.code === "not_allowed", bad);
  }
  assert.throws(() => a.sendKeysCombo("cmd+r"), (e) => e.code === "not_allowed");
});

test("a share of the screen becomes a pixel on it", () => {
  assert.equal(a.toPixel(0, 1920), 0);
  assert.equal(a.toPixel(1, 1920), 1919);
  assert.equal(a.toPixel(0.5, 1081), 540);
  assert.equal(a.toPixel(2, 1920), 1919);
  assert.equal(a.toPixel(-1, 1920, -1920), -1920);
});

test("health reports cpu, memory and disks", async () => {
  const h = await a.health({ remote: "view" }, [shared]);
  assert.ok(h.cpu.cores > 0 && h.memory.total > 0 && h.disks.length >= 1);
  assert.equal(h.remote, "view");
  assert.ok(h.disks[0].total >= h.disks[0].free);
});

test("on Windows the helper builds, and finds the pixel and the keys without touching anything", { skip: process.platform !== "win32" }, () => {
  const m = a.runHelper(["mouse", "0", "0", "click", "0", "dry"], {}, 90_000);
  assert.equal(m.status, 0, m.stderr);
  assert.match(m.stdout.trim(), /^-?\d+ -?\d+$/);
  const k = a.runHelper(["keys", "dry"], { AGENTIC_KEYS: "^c" });
  assert.equal(k.stdout.trim(), "^c");
});

// ---------------------------------------------------------------- P52: never stuck offline

const http = require("node:http");
const { spawn } = require("node:child_process");

const waitFor = async (check, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};

test("a connection that hangs is cut, retried and reported; the status page needs its key", async () => {
  // A "server" that accepts the connection and never answers (what a stuck network looks like).
  const sockets = [];
  const hang = http.createServer(() => {});
  hang.on("upgrade", (_req, socket) => { socket.on("error", () => {}); sockets.push(socket); });
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-pc-run-"));
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ server: `http://127.0.0.1:${hang.address().port}`, token: "t", folders: [] }));
  const child = spawn(process.execPath, [path.join(__dirname, "agent.cjs"), "run"], {
    env: { ...process.env, AGENTIC_PC_HOME: home, AGENTIC_PC_PROGRAM: home, AGENTIC_PC_CONNECT_TIMEOUT: "700" },
    stdio: "ignore",
  });
  try {
    const read = (f) => { try { return fs.readFileSync(path.join(home, f), "utf8"); } catch { return ""; } };
    const offline = await waitFor(() => { try { const s = JSON.parse(read("status.json")); return s.state === "offline" ? s : null; } catch { return null; } }, 8000);
    assert.ok(offline, "reported offline");
    assert.match(offline.last_error, /no answer from the office server/);
    assert.ok(offline.next_try);
    assert.ok(await waitFor(() => (read("agent.log").match(/trying again in/g) || []).length >= 2, 10000), "kept retrying");
    // The status page: only with its key, only for 127.0.0.1.
    const base = `http://127.0.0.1:${offline.control_port}`;
    assert.equal((await fetch(`${base}/state`)).status, 403);
    const st = await fetch(`${base}/state`, { headers: { "X-Key": offline.control_key } });
    assert.equal(st.status, 200);
    const body = await st.json();
    assert.equal(body.linked, true);
    assert.deepEqual(body.tunnel, { on: false, hosts: [], open: 0 });
    assert.equal((await fetch(`${base}/?k=${offline.control_key}`)).headers.get("x-frame-options"), "DENY");
    const other = await new Promise((resolve) => {
      http.get({ host: "127.0.0.1", port: offline.control_port, path: `/state?k=${offline.control_key}`, headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", () => resolve(0));
    });
    assert.equal(other, 403);
    // Reconnect now: tries again at once.
    const before = (read("agent.log").match(/disconnected:/g) || []).length;
    const r = await fetch(`${base}/reconnect`, { method: "POST", headers: { "X-Key": offline.control_key } });
    assert.equal(r.status, 200);
    assert.ok(await waitFor(() => (read("agent.log").match(/disconnected:/g) || []).length > before, 4000));
  } finally {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    for (const s of sockets) s.destroy();
    hang.close();
  }
});

test("linking refuses a plain http office address except on this same machine (P52)", async () => {
  const lan = await a.linkWith("http://office.example.com", "ABCD2345");
  assert.equal(lan.ok, false);
  assert.match(lan.error, /https/);
  // localhost is allowed over http (development); it then fails only because nothing answers.
  const local = await a.linkWith("http://127.0.0.1:9", "ABCD2345");
  assert.equal(local.ok, false);
  assert.doesNotMatch(local.error, /https:\/\/ address/);
});

// ---------------------------------------------------------------- P57: one site through this computer

const net = require("node:net");
const { EventEmitter } = require("node:events");

test("tunnel sites match exactly or as a subdomain, never look-alikes", () => {
  const hosts = ["eperolehan.gov.my"];
  assert.ok(a.hostAllowed("eperolehan.gov.my", hosts));
  assert.ok(a.hostAllowed("www.eperolehan.gov.my", hosts));
  assert.ok(a.hostAllowed("WWW.EPEROLEHAN.GOV.MY", hosts));
  for (const bad of ["eperolehan.gov.my.evil.com", "xeperolehan.gov.my", "gov.my", "evil.com", "", "eperolehan.gov.my:443", "eperolehan.gov.my."]) {
    assert.ok(!a.hostAllowed(bad, hosts), bad);
  }
  assert.ok(!a.hostAllowed("eperolehan.gov.my", []));
});

test("tunnel command line: on, sites, off, and bad sites refused", () => {
  assert.equal(a.parseTunnelArgs([], {}), null);
  assert.deepEqual(a.parseTunnelArgs(["on"], {}), { on: true, hosts: ["eperolehan.gov.my"] });
  assert.deepEqual(a.parseTunnelArgs(["on", "EPerolehan.gov.my", "portal.example.com", "eperolehan.gov.my"], {}), { on: true, hosts: ["eperolehan.gov.my", "portal.example.com"] });
  assert.deepEqual(a.parseTunnelArgs(["off"], { on: true, hosts: ["a.example.com"] }), { on: false, hosts: ["a.example.com"] });
  for (const bad of ["https://eperolehan.gov.my", "eperolehan.gov.my:443", "eperolehan.gov.my/login", "localhost", "-bad.example.com", "a..b.com", "*.gov.my", "eperolehan.gov.my."]) {
    assert.throws(() => a.parseTunnelArgs(["on", bad], {}), /not a site name/, bad);
  }
  assert.throws(() => a.parseTunnelArgs(["on", ...Array.from({ length: 11 }, (_, i) => `s${i}.example.com`)], {}), /At most 10/);
  assert.throws(() => a.parseTunnelArgs(["maybe"], {}), /Use:/);
  assert.throws(() => a.parseTunnelArgs(["off", "x.com"], {}), /Use:/);
  // the stored setting: off unless on is exactly true; on with no sites means the default
  assert.deepEqual(a.tunnelOf({}), { on: false, hosts: [] });
  assert.deepEqual(a.tunnelOf({ tunnel: { on: "yes", hosts: ["x.example.com"] } }), { on: false, hosts: ["x.example.com"] });
  assert.deepEqual(a.tunnelOf({ tunnel: { on: true, hosts: ["Bad Host", 5] } }), { on: true, hosts: ["eperolehan.gov.my"] });
  assert.deepEqual(a.hello({ token: "t", tunnel: { on: true, hosts: ["eperolehan.gov.my"] } }).tunnel, { on: true, hosts: ["eperolehan.gov.my"] });
  assert.deepEqual(a.hello({ token: "t" }).tunnel, { on: false, hosts: [] });
});

test("the activity of net.open keeps only the site and port", () => {
  assert.deepEqual(a.detailOf("net.open", { channel: "abcdefgh12", host: "eperolehan.gov.my", port: 443, data: "secret" }), { host: "eperolehan.gov.my", port: 443 });
});

const ON = { token: "tok", tunnel: { on: true, hosts: ["eperolehan.gov.my"] } };
const GOOD = { channel: "chan_12345678", host: "www.eperolehan.gov.my", port: 443 };
const noConnect = () => { throw new Error("must not connect"); };

test("net.open is refused when off, paused, for other sites, other ports and bad params", async () => {
  const deps = { connect: noConnect, WebSocket: function () { throw new Error("must not open"); } };
  await assert.rejects(a.openTunnel(GOOD, { token: "t" }, "ws://x", deps), { code: "not_allowed", message: "Sending sites through this computer is off. On it, run: agentic-pc tunnel on" });
  await assert.rejects(a.openTunnel(GOOD, { ...ON, paused: true }, "ws://x", deps), { code: "paused" });
  await assert.rejects(a.openTunnel({ ...GOOD, host: "eperolehan.gov.my.evil.com" }, ON, "ws://x", deps), { code: "not_allowed", message: "This computer only lets through: eperolehan.gov.my" });
  await assert.rejects(a.openTunnel({ ...GOOD, host: "xeperolehan.gov.my" }, ON, "ws://x", deps), { code: "not_allowed" });
  await assert.rejects(a.openTunnel({ ...GOOD, port: 80 }, ON, "ws://x", deps), { code: "bad_request" });
  await assert.rejects(a.openTunnel({ ...GOOD, port: "443" }, ON, "ws://x", deps), { code: "bad_request" });
  await assert.rejects(a.openTunnel({ ...GOOD, channel: "../x" }, ON, "ws://x", deps), { code: "bad_request" });
  await assert.rejects(a.openTunnel({ ...GOOD, host: "https://eperolehan.gov.my" }, ON, "ws://x", deps), { code: "bad_request" });
  // at most 24 at once
  const fillers = Array.from({ length: 24 }, () => ({ host: "eperolehan.gov.my", close() { a.tunnels.delete(this); } }));
  for (const f of fillers) a.tunnels.add(f);
  try { await assert.rejects(a.openTunnel(GOOD, ON, "ws://x", deps), { code: "busy" }); } finally { for (const f of fillers) a.tunnels.delete(f); }
});

/** A stand-in for the relay WebSocket: same surface as the global WebSocket. */
class FakeWS {
  constructor(url, behave = "open") {
    this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; this.closed = false;
    FakeWS.last = this;
    setTimeout(() => {
      if (behave === "open") { this.readyState = 1; this.onopen?.(); } else { this.readyState = 3; this.onerror?.(); }
    }, 5);
  }
  send(d) { if (this.readyState !== 1) throw new Error("not open"); this.sent.push(d); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.closed = true; setTimeout(() => this.onclose?.(), 0); }
  deliver(data) { this.onmessage?.({ data }); }
}

test("net.open pipes a real local TCP connection both ways and records only sizes", async () => {
  const echo = net.createServer((s) => { s.on("error", () => {}); s.pipe(s); });
  await new Promise((r) => echo.listen(0, "127.0.0.1", r));
  const port = echo.address().port;
  let asked = null;
  const deps = { connect: (o) => { asked = o; return net.connect({ host: "127.0.0.1", port }); }, WebSocket: FakeWS };
  try {
    const out = await a.openTunnel(GOOD, ON, "wss://office.example", deps);
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(asked, { host: "www.eperolehan.gov.my", port: 443 });
    const ws = FakeWS.last;
    assert.equal(ws.url, "wss://office.example/api/devices/cdp/chan_12345678");
    assert.equal(ws.binaryType, "arraybuffer");
    assert.deepEqual(JSON.parse(ws.sent[0]), { type: "hello", token: "tok" });
    assert.equal(a.tunnels.size, 1);
    const payload = Buffer.from("encrypted-bytes-0123456789");
    ws.deliver(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length)); // an ArrayBuffer, like the real one
    const back = await waitFor(() => { const got = Buffer.concat(ws.sent.slice(1).map((d) => Buffer.from(d))); return got.length >= payload.length ? got : null; }, 3000);
    assert.ok(back && back.equals(payload), "the bytes came back through the relay");
    // the relay ends: the TCP side ends too, and the activity line has the site and sizes only
    ws.readyState = 3; ws.onclose();
    assert.ok(await waitFor(() => a.tunnels.size === 0, 2000));
    const act = fs.readFileSync(path.join(process.env.AGENTIC_PC_HOME, "activity.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => JSON.stringify(l).includes("net.tunnel")).pop();
    assert.ok(act, "a net.tunnel activity line");
    const text = JSON.stringify(act);
    assert.match(text, /www\.eperolehan\.gov\.my/);
    assert.match(text, /"bytes_up":26/);
    assert.match(text, /"bytes_down":26/);
    assert.doesNotMatch(text, /encrypted-bytes/);
  } finally {
    a.tunnels.clear();
    echo.close();
  }
});

test("net.open fails cleanly when the site or the relay cannot be reached", async () => {
  const gone = net.createServer();
  await new Promise((r) => gone.listen(0, "127.0.0.1", r));
  const deadPort = gone.address().port;
  await new Promise((r) => gone.close(r));
  await assert.rejects(a.openTunnel(GOOD, ON, "ws://x", { connect: () => net.connect({ host: "127.0.0.1", port: deadPort }), WebSocket: FakeWS }),
    { code: "failed", message: "Could not reach www.eperolehan.gov.my." });
  assert.equal(a.tunnels.size, 0);
  const srv = net.createServer((s) => s.on("error", () => {}));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  let sock = null;
  try {
    await assert.rejects(a.openTunnel(GOOD, ON, "ws://x", {
      connect: () => (sock = net.connect({ host: "127.0.0.1", port: srv.address().port })),
      WebSocket: class extends FakeWS { constructor(u) { super(u, "error"); } },
    }), { code: "failed", message: "Could not open the relay." });
    assert.equal(a.tunnels.size, 0);
    assert.ok(sock.destroyed, "the TCP side is closed when the relay fails");
  } finally { srv.close(); }
});

class FakeSocket extends EventEmitter {
  constructor() { super(); this.written = []; this.paused = false; this.destroyed = false; }
  write(b) { this.written.push(b); return true; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.emit("close"); }
}
const openWs = () => ({ readyState: 1, bufferedAmount: 0, sent: [], send(d) { this.sent.push(d); }, close() { this.readyState = 3; this.closedByUs = true; } });

test("the pipe holds back the site when the relay is slow, and resumes when it drains", async () => {
  const s = new FakeSocket(); const w = openWs();
  const p = a.pipeTunnel(s, w, { pollMs: 5 });
  w.bufferedAmount = 5 * 1024 * 1024;
  s.emit("data", Buffer.alloc(10));
  assert.equal(s.paused, true);
  w.bufferedAmount = 0;
  assert.ok(await waitFor(() => !s.paused, 1000), "resumed");
  w.onmessage({ data: new Uint8Array([1, 2, 3]).buffer });
  assert.deepEqual([...s.written[0]], [1, 2, 3]);
  w.onmessage({ data: "a text frame is ignored" });
  assert.equal(s.written.length, 1);
  assert.deepEqual(p.stats, { up: 3, down: 10 });
  p.close("done");
});

test("the pipe ends both sides on a relay error, on either close, and when idle", async () => {
  const cases = [
    ["relay refused", (s, w) => w.onmessage({ data: '{"type":"error","code":"gone"}' })],
    ["relay closed", (s, w) => w.onclose()],
    ["site closed", (s) => s.emit("end")],
    ["site error", (s) => s.emit("error", new Error("reset"))],
    ["idle", () => {}],
  ];
  for (const [why, act] of cases) {
    const s = new FakeSocket(); const w = openWs();
    let ended = null;
    a.pipeTunnel(s, w, { idleMs: why === "idle" ? 30 : 60_000, onClose: (r) => { ended = r; } });
    act(s, w);
    assert.ok(await waitFor(() => ended, 1500), why);
    assert.equal(ended, why);
    assert.ok(s.destroyed, `${why}: socket closed`);
    if (why !== "relay closed") assert.ok(w.closedByUs, `${why}: relay closed`);
  }
});

test("P59: the office's AI opens the browser here only for sites this computer allows", () => {
  const { companyBrowserAllowed, AgentError } = require("./agent.cjs");
  const on = { tunnel: { on: true, hosts: ["eperolehan.gov.my"] } };
  assert.doesNotThrow(() => companyBrowserAllowed({ company: true, sites: ["eperolehan.gov.my"] }, on));
  assert.doesNotThrow(() => companyBrowserAllowed({ channel: "x" }, { tunnel: { on: false } })); // the person's own AI
  assert.throws(() => companyBrowserAllowed({ company: true, sites: ["eperolehan.gov.my"] }, { tunnel: { on: false } }), (e) => e instanceof AgentError && e.code === "not_allowed");
  assert.throws(() => companyBrowserAllowed({ company: true, sites: ["example.com"] }, on), (e) => e.code === "not_allowed");
  assert.throws(() => companyBrowserAllowed({ company: true, sites: [] }, on), (e) => e.code === "not_allowed");
});
