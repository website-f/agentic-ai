import { describe, expect, it } from "vitest";

import { markParts, plainText, safeHref, unescapeHtml } from "./search";

describe("search snippets", () => {
  it("keeps <mark> and nothing else", () => {
    const html = "Had &lt;b&gt;<mark>RM 700.00</mark>&lt;/b&gt; ikut <mark>kelayakan</mark> &amp; syarat";
    expect(markParts(html)).toEqual([
      { text: "Had <b>", mark: false },
      { text: "RM 700.00", mark: true },
      { text: "</b> ikut ", mark: false },
      { text: "kelayakan", mark: true },
      { text: " & syarat", mark: false },
    ]);
    expect(plainText(html)).toBe("Had <b>RM 700.00</b> ikut kelayakan & syarat");
  });

  it("shows any other tag as text, never as HTML", () => {
    const parts = markParts('<img src=x onerror="alert(1)"><mark>ok</mark>');
    expect(parts[0]).toEqual({ text: '<img src=x onerror="alert(1)">', mark: false });
    expect(parts[1]).toEqual({ text: "ok", mark: true });
  });

  it("undoes html.escape", () => {
    expect(unescapeHtml("&quot;a&quot; &#x27;b&#x27; &#39;c&#39; &amp;amp;")).toBe("\"a\" 'b' 'c' &amp;");
    expect(unescapeHtml("&bogus; &#0;")).toBe("&bogus; &#0;");
  });

  it("only opens same-origin paths", () => {
    expect(safeHref("/files?f=fl_1&page=3")).toBe("/files?f=fl_1&page=3");
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("https://evil.example/x")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
