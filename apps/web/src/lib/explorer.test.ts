import { describe, expect, it } from "vitest";

import {
  applyLabels, columnName, EMPTY_SELECTION, fileType, labelTone, parentOf, planPaste, sanitizeHtml, selectionReducer, sortItems, splitExt,
  type Clipboard, type ExplorerFile, type Item, type Selection,
} from "./explorer";

const order = ["a", "b", "c", "d", "e"];

describe("selection", () => {
  const click = (s: Selection, key: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => selectionReducer(s, { type: "click", key, order, ...mods });

  it("a plain click picks one; Ctrl adds and takes off", () => {
    let s = click(EMPTY_SELECTION, "b");
    expect(s.keys).toEqual(["b"]);
    s = click(s, "d", { ctrl: true });
    expect(s.keys).toEqual(["b", "d"]);
    s = click(s, "b", { ctrl: true });
    expect(s.keys).toEqual(["d"]);
    expect(click(s, "a").keys).toEqual(["a"]);
  });

  it("Shift picks the range from the anchor, both ways, and Ctrl+Shift adds it", () => {
    let s = click(EMPTY_SELECTION, "b");
    s = click(s, "d", { shift: true });
    expect(s.keys).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
    s = click(s, "a", { shift: true });
    expect(s.keys).toEqual(["a", "b"]);
    const t = click(click(EMPTY_SELECTION, "e"), "a", { ctrl: true });
    expect(click(t, "c", { ctrl: true, shift: true }).keys.sort()).toEqual(["a", "b", "c", "e"]);
  });

  it("select all, clear, context and prune", () => {
    const all = selectionReducer(EMPTY_SELECTION, { type: "all", order });
    expect(all.keys).toEqual(order);
    expect(selectionReducer(all, { type: "context", key: "c" })).toBe(all);
    expect(selectionReducer(EMPTY_SELECTION, { type: "context", key: "c" }).keys).toEqual(["c"]);
    const pruned = selectionReducer(all, { type: "prune", order: ["a", "e"] });
    expect(pruned.keys).toEqual(["a", "e"]);
    expect(selectionReducer(pruned, { type: "prune", order: ["a", "e"] })).toBe(pruned);
    expect(selectionReducer(all, { type: "clear" })).toEqual(EMPTY_SELECTION);
    expect(selectionReducer(EMPTY_SELECTION, { type: "toggle", key: "x" }).keys).toEqual(["x"]);
  });
});

describe("paste", () => {
  const clip = (mode: Clipboard["mode"], items: Clipboard["items"]): Clipboard => ({ mode, branchId: "b1", items });

  it("moves files elsewhere and skips moving into the folder they are in", () => {
    const p = planPaste(clip("cut", [
      { kind: "file", id: "1", name: "a.pdf", folder: "HR" },
      { kind: "file", id: "2", name: "b.pdf", folder: "" },
    ]), "HR");
    expect(p.files).toEqual(["2"]);
    expect(p.skipped).toEqual([{ name: "a.pdf", reason: "same_place" }]);
  });

  it("copies files into their own folder too", () => {
    expect(planPaste(clip("copy", [{ kind: "file", id: "1", name: "a.pdf", folder: "HR" }]), "HR").files).toEqual(["1"]);
  });

  it("never puts a folder inside itself", () => {
    const p = planPaste(clip("cut", [{ kind: "folder", path: "HR/Leave" }, { kind: "folder", path: "Finance" }]), "HR/Leave/2026");
    expect(p.skipped).toEqual([{ name: "Leave", reason: "into_itself" }]);
    expect(p.folders).toEqual([{ from: "Finance", to: "HR/Leave/2026/Finance" }]);
    expect(planPaste(clip("cut", [{ kind: "folder", path: "HR/Leave" }]), "HR").skipped[0]?.reason).toBe("same_place");
    expect(planPaste(clip("cut", [{ kind: "folder", path: "HR/Leave" }]), "").folders).toEqual([{ from: "HR/Leave", to: "Leave" }]);
  });
});

describe("safe html", () => {
  it("keeps the allowed tags without attributes", () => {
    expect(sanitizeHtml('<h2 class="x" style="color:red">Title</h2><p id="p">One <strong>two</strong> <em>three</em></p>'))
      .toBe("<h2>Title</h2><p>One <strong>two</strong> <em>three</em></p>");
    expect(sanitizeHtml("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><hr>"))
      .toBe("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><hr>");
  });

  it("drops scripts, handlers, links and images", () => {
    const out = sanitizeHtml('<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(2)">link</a></p><img src=x onerror="alert(3)"><style>p{}</style><!-- c -->');
    expect(out).toBe("<p>hilink</p>");
    expect(out).not.toMatch(/script|onerror|href|img|alert/);
  });

  it("unwraps unknown tags and keeps text escaped", () => {
    expect(sanitizeHtml("<div><span>a &lt;b&gt;</span></div><iframe src=x>bad</iframe>")).toBe("a &lt;b&gt;");
  });
});

describe("helpers", () => {
  it("labels: no repeats whatever the case, removals, capped", () => {
    expect(applyLabels(["Urgent", "Q3"], ["urgent", " For  audit "], ["q3"])).toEqual(["Urgent", "For audit"]);
    expect(applyLabels([], Array.from({ length: 20 }, (_, i) => `l${i}`), [])).toHaveLength(12);
    expect(labelTone("Urgent")).toBe(labelTone("urgent"));
  });

  it("paths, extensions, columns and types", () => {
    expect(parentOf("A/B/C")).toBe("A/B");
    expect(parentOf("A")).toBe("");
    expect(splitExt("report.final.pdf")).toEqual(["report.final", ".pdf"]);
    expect(splitExt(".env")).toEqual([".env", ""]);
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(fileType({ mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "x.xlsx" })).toBe("sheet");
    expect(fileType({ mime: "text/csv", name: "x.csv" })).toBe("sheet");
    expect(fileType({ mime: "video/mp4", name: "x.mp4" })).toBe("media");
  });

  it("sorts folders first", () => {
    const f = (id: string, name: string, size: number): Item => ({ key: `f:${id}`, kind: "file", name, file: { id, name, size, mime: "", created_at: "2026-01-01" } as ExplorerFile });
    const d = (name: string, size: number): Item => ({ key: `d:${name}`, kind: "folder", path: name, name, files: 1, size, flagged: 0 });
    const items = [f("1", "b", 5), d("Z", 1), f("2", "a10", 9), f("3", "a2", 1), d("A", 50)];
    expect(sortItems(items, "name", "asc").map((i) => i.name)).toEqual(["A", "Z", "a2", "a10", "b"]);
    expect(sortItems(items, "size", "desc").map((i) => i.name)).toEqual(["A", "Z", "a10", "b", "a2"]);
  });
});
