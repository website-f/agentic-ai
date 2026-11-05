/**
 * P75: the feedback widget's Bahasa Melayu, cut to what it can show. The office's dictionary
 * (src/i18n/ms, ~600 KB) is English text → Malay; the widget shows a few hundred of those
 * phrases. This plugin walks the widget's own source files (its imports under src/, from the
 * entry), gathers every string written in them (the English keys passed to t() and msg()), and
 * drops each dictionary entry none of them is. Used only by vite.widget.config.ts; the office
 * keeps its whole dictionary.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import ts from "typescript";
import type { Plugin } from "vite";

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)"([^"]+)"/g;
const STRING = /"((?:[^"\\\n]|\\.)*)"/g;

function resolveFile(src: string, from: string, spec: string): string | null {
  const bare = spec.split("?")[0] ?? spec;
  let base: string;
  if (bare.startsWith("@/")) base = join(src, bare.slice(2));
  else if (bare.startsWith(".")) base = resolve(dirname(from), bare);
  else return null; // a package: no dictionary keys of ours
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const f = base + ext;
    if (/\.tsx?$/.test(f) && existsSync(f)) return f;
  }
  return null;
}

/** Every string written in the files the entry reaches (the dictionary itself left out). */
export function widgetStrings(src: string, entry: string): Set<string> {
  const ms = join(src, "i18n", "ms");
  const seen = new Set<string>();
  const strings = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file) || file.startsWith(ms)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(IMPORT)) {
      const next = resolveFile(src, file, m[1]!);
      if (next) todo.push(next);
    }
    for (const m of code.matchAll(STRING)) {
      let s: string;
      try {
        s = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        continue;
      }
      strings.add(s);
      // t("Open|verb") falls back to the plain word's entry.
      const bar = s.indexOf("|");
      if (bar > 0) strings.add(s.slice(0, bar));
    }
  }
  return strings;
}

/** The dictionary file with only the entries whose English is in `keep`. */
export function trimDictionary(code: string, keep: Set<string>): string {
  const sf = ts.createSourceFile("ms.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cuts: [number, number][] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : null;
        const plain = ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer);
        if (key !== null && plain && !keep.has(key)) cuts.push([p.getFullStart(), p.getEnd()]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = code;
  // From the end, so earlier positions stay right; each cut takes its comma with it.
  for (const [start, end] of cuts.sort((a, b) => b[0] - a[0])) {
    const comma = out.slice(end).match(/^\s*,/);
    out = out.slice(0, start) + out.slice(end + (comma ? comma[0].length : 0));
  }
  return out;
}

export function widgetI18n(src: string, entry: string): Plugin {
  let keep: Set<string> | null = null;
  const ms = join(src, "i18n", "ms").replace(/\\/g, "/");
  return {
    name: "agentic:widget-i18n",
    enforce: "pre",
    buildStart() {
      keep = widgetStrings(src, entry);
    },
    transform(code, id) {
      const file = id.split("?")[0]!.replace(/\\/g, "/");
      if (!file.startsWith(`${ms}/`) || !file.endsWith(".ts") || file.endsWith("/index.ts")) return null;
      return { code: trimDictionary(code, keep ?? widgetStrings(src, entry)), map: null };
    },
  };
}
