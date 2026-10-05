/**
 * Every t("…") / t(`…`) / msg("…") literal in the app needs a Malay entry. Missing ones are
 * listed so translators can fill them; the test fails while any are missing.
 *
 * I18N_ONLY=pages/tasks,components/ui narrows the list to the folders you are working on.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { translate } from "./index";
import { MS } from "./ms";

const SRC = join(__dirname, "..");
const CALL = /\b(?:t|msg)\(\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
const USES = /from "(?:@\/i18n|\.\.?\/(?:\.\.\/)*i18n)"/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "i18n" || name === "node_modules" ? [] : files(p);
    return /\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function keys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files(SRC)) {
    const text = readFileSync(f, "utf-8");
    if (!USES.test(text)) continue; // only files that use the translations
    for (const m of text.matchAll(CALL)) {
      const raw = m[2] ?? "";
      if (m[1] === "`" && raw.includes("${")) continue; // dynamic: must use {vars} instead
      const key = raw.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
      if (key && !out.has(key)) out.set(key, f.slice(SRC.length + 1).split(sep).join("/"));
    }
  }
  return out;
}

describe("i18n", () => {
  it("fills {vars} and falls back to English", () => {
    expect(translate("ms", "Good morning")).toBe("Selamat pagi");
    expect(translate("ms", "Not translated yet")).toBe("Not translated yet");
    expect(translate("en", "{n} tasks", { n: 3 })).toBe("3 tasks");
    expect(translate("en", "Open|verb")).toBe("Open");
  });

  it("has a Malay entry for every t() text", () => {
    const only = (process.env.I18N_ONLY ?? "").split(",").filter(Boolean);
    const all = [...keys()].filter(([k]) => !(k in MS));
    const missing = only.length ? all.filter(([, f]) => only.some((p) => f.startsWith(p))) : all;
    if (missing.length) {
      console.log(`${missing.length} texts need Malay:\n` + missing.slice(0, 200).map(([k, f]) => `  ${f}: ${JSON.stringify(k)}`).join("\n"));
    }
    expect(missing.length).toBe(0);
  });

  it("keeps every {var} in the Malay text", () => {
    const broken = Object.entries(MS).filter(([en, ms]) => {
      const need = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      const have = [...ms.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      return need !== have;
    });
    expect(broken).toEqual([]);
  });
});
