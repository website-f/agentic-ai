// node --test apps/pc-agent/agent.test.cjs
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.AGENTIC_PC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-pc-home-"));
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
