// P121b: copies Prima's SOP and workflow catalog (apps/prima/apps/web/src/sop/areas/*.ts) into the office guide as
// src/guide/prima-sops.json, so /guide/prima-sop shows the same flows. The office web image is built from apps/web
// only, so the copy is committed; src/guide/prima-sops.test.ts fails when it is out of date.
// Run from apps/web: node scripts/prima-sops.mjs   (check only: node scripts/prima-sops.mjs --check)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const prima = path.resolve(here, "../../prima/apps/web/src");
const out = path.resolve(here, "../src/guide/prima-sops.json");
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

export function buildPrimaSops() {
  const ts = require("typescript");
  const areas = path.join(prima, "sop/areas");
  const sops = [];
  for (const f of fs.readdirSync(areas).filter((x) => x.endsWith(".ts")).sort()) {
    const js = ts.transpileModule(read(path.join(areas, f)), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    vm.runInNewContext(js, { exports: mod.exports, module: mod, require: () => ({}) });
    for (const v of Object.values(mod.exports)) if (Array.isArray(v)) sops.push(...v);
  }
  // App names: Prima's home app cards (nav-catalog.ts) and their Malay (i18n.ts rows).
  const nav = read(path.join(prima, "nav-catalog.ts"));
  const i18n = read(path.join(prima, "i18n.ts"));
  const ms = (en) => {
    const m = i18n.match(new RegExp(`^\\s*\\['${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}', '([^']*)'`, "m"));
    return m ? m[1] : en;
  };
  const used = new Set(sops.map((s) => s.app));
  const apps = [...nav.matchAll(/id: '([a-z]+)',\s*\n\s*title: '([^']+)'/g)]
    .filter((m) => used.has(m[1]))
    .map((m) => ({ id: m[1], en: m[2], ms: ms(m[2]) }));
  const known = new Set(apps.map((a) => a.id));
  for (const id of used) if (!known.has(id)) apps.push({ id, en: id, ms: id });

  // Keep the catalog's own order inside each app; apps in the home screen's order.
  const rank = new Map(apps.map((a, i) => [a.id, i]));
  const keyed = sops.map((s, i) => ({ s, i }));
  keyed.sort((a, b) => (rank.get(a.s.app) ?? 99) - (rank.get(b.s.app) ?? 99) || a.i - b.i);
  return { apps, sops: keyed.map((k) => k.s) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = JSON.stringify(buildPrimaSops()) + "\n";
  if (process.argv.includes("--check")) {
    const now = fs.existsSync(out) ? read(out) : "";
    if (now !== text) {
      console.error("src/guide/prima-sops.json is out of date: run node scripts/prima-sops.mjs");
      process.exit(1);
    }
    console.log("prima-sops.json is up to date");
  } else {
    fs.writeFileSync(out, text);
    const n = JSON.parse(text);
    console.log(`wrote ${n.sops.length} flows in ${n.apps.length} apps`);
  }
}
