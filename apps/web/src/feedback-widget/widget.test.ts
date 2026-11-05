import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ruleOnPage } from "@/components/feedback/panels";
import { MS } from "@/i18n/ms";

import { trimDictionary, widgetStrings } from "../../widget-i18n-plugin";
import { fromContract, oneTelling, primaLang, primaPath, primaView, readPrimaPage } from "./prima";

const rule = (page: string) => ({ id: "rl_1", title: "t", body: "", page });

describe("P75 feedback widget: the Prima screen", () => {
  it("reads the screen from the hash and records where it was sent from", () => {
    expect(primaView("#staffpay")).toBe("staffpay");
    expect(primaView("#/it-procurement?x=1")).toBe("it-procurement");
    expect(primaView("#<img src=x>")).toBe("");
    expect(primaPath("/prima/", "#staffpay")).toBe("/prima/#staffpay");
    expect(primaPath("/prima/index.html", "")).toBe("/prima/");
  });

  it("follows Prima's language: English stays English, BM and the mix are Malay", () => {
    expect(primaLang("en")).toBe("en");
    expect(primaLang("ms")).toBe("ms");
    expect(primaLang("mix")).toBe("ms");
    expect(primaLang(null)).toBe("ms"); // Prima's default is the mix
  });

  it("takes Prima's description only for the screen it is about, as plain text", () => {
    expect(fromContract({ view: "it", title: "IT" }, "work")).toBeNull();
    expect(fromContract({ view: "work" }, "work")).toBeNull();
    const got = fromContract(
      { view: "work", title: "  Work\n", role: { label: "IT Manager" }, steps: ["a", 3, ""], rules: [{ id: "IT-1", title: "Short.", body: "Short. More.", source: "Policy" }, "bad", { body: "no title" }] },
      "work",
    );
    expect(got).toMatchObject({ view: "work", title: "Work", role: { label: "IT Manager", blurb: "" }, steps: ["a"] });
    expect(got?.rules).toEqual([{ id: "IT-1", title: "Short.", body: "More.", source: "Policy" }]);
    // The first screen (no hash yet) takes Prima's word for which it is.
    expect(fromContract({ view: "it", title: "IT" }, "")?.view).toBe("it");
  });

  it("tells a rule once", () => {
    const r = { id: "", source: "" };
    expect(oneTelling({ ...r, title: "Same.", body: "Same." }).body).toBe("");
    expect(oneTelling({ ...r, title: "A long first sen…", body: "A long first sentence. And more." })).toMatchObject({ title: "A long first sentence. And more.", body: "" });
    expect(oneTelling({ ...r, title: "Other", body: "Different" }).body).toBe("Different");
  });

  it("falls back to the screen's own heading", () => {
    document.body.innerHTML = `<main><h1>Gaji staf</h1><p>Untuk gaji bulanan.</p></main>`;
    window.location.hash = "#staffpay";
    window.__primaPage = { view: "staffpay", title: "Staff payroll", role: { label: "Company manager" } };
    const p = readPrimaPage();
    expect(p).toMatchObject({ view: "staffpay", title: "Gaji staf", name: "Prima · Staff payroll", blurb: "Untuk gaji bulanan.", role: { label: "Company manager" } });
    window.__primaPage = undefined;
    document.body.innerHTML = `<header class="k-head"><div><h1>Kerja</h1><p class="k-head-sub">Senarai kerja.</p></div></header>`;
    expect(readPrimaPage()).toMatchObject({ title: "Kerja", name: "Prima · Kerja", blurb: "Senarai kerja.", rules: [] });
    window.location.hash = "";
  });

  it("ties the developer's rules to Prima screens", () => {
    expect(ruleOnPage(rule("/prima"), "/prima/#staffpay")).toBe(true);
    expect(ruleOnPage(rule("/prima/#staffpay"), "/prima/#staffpay")).toBe(true);
    expect(ruleOnPage(rule("/prima/#staffpay"), "/prima/#work")).toBe(false);
    expect(ruleOnPage(rule("/tasks"), "/tasks/abc")).toBe(true);
    expect(ruleOnPage(rule("/tasks"), "/tasksx")).toBe(false);
    expect(ruleOnPage(rule(""), "/tasks")).toBe(false);
    expect(ruleOnPage(rule("/agents"), "/agents/new", "/agents")).toBe(true);
  });
});

describe("P75 feedback widget: its Malay, cut to what it shows", () => {
  // Vitest runs in apps/web.
  const src = join(process.cwd(), "src");
  const entry = join(src, "feedback-widget", "main.tsx");
  const keep = widgetStrings(src, entry);

  it("finds the words of the widget's own screens and of what they use", () => {
    for (const s of ["Mark up this screen", "Prima's rules for this screen", "Send feedback", "Owner", "Not working", "Close"]) expect(keep.has(s)).toBe(true);
    // The office's own pages stay out: most of the dictionary is not the widget's.
    const used = Object.keys(MS).filter((k) => keep.has(k)).length;
    expect(used).toBeGreaterThan(100);
    expect(used / Object.keys(MS).length).toBeLessThan(0.2);
  });

  it("every English text the widget shows keeps its Malay", () => {
    const missing = [...keep].filter((s) => MS[s] !== undefined).filter((s) => !trimDictionary(`export const D = { ${JSON.stringify(s)}: ${JSON.stringify(MS[s])}, "zzz unused": "x" };`, keep).includes(JSON.stringify(s)));
    expect(missing).toEqual([]);
  });

  it("drops the rest and keeps the file valid", () => {
    const out = trimDictionary(`export const D: Record<string, string> = {\n  // a comment\n  "Send feedback": "Hantar maklum balas",\n  "zz office only": "Ejen baharu",\n  Owner: "Pemilik",\n  "x": \`y\`,\n};\n`, keep);
    expect(out).toContain('"Send feedback": "Hantar maklum balas"');
    expect(out).toContain('Owner: "Pemilik"');
    expect(out).not.toContain("Ejen baharu");
    expect(out).not.toContain("`y`");
    expect(() => new Function(out.replace("export const D: Record<string, string> =", "return"))).not.toThrow();
  });
});
