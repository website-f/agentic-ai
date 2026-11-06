import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translate } from "@/i18n";

import { primaLayoutSteps } from "./prima-tour";

// A Prima screen as its kit draws it (apps/prima/apps/web/src/kit.tsx).
const SCREEN = `
  <main>
    <header class="k-head">
      <div class="k-head-text"><h1>Contracts</h1><p class="k-head-sub">Each site is mobilised against 12 workstreams.</p></div>
      <div class="k-head-actions"><button>New contract</button><button>Export</button></div>
    </header>
    <div class="k-stats"><button class="k-stat">Live 142</button></div>
    <div role="tablist"><button role="tab">Needs attention</button><button role="tab">Live</button><button role="tab">All</button></div>
    <label class="k-search"><input placeholder="Search client"></label>
    <section class="k-card"><div class="k-card-head"><div class="k-card-title"><h2>Needs attention</h2><p>23 contracts</p></div></div></section>
    <section class="k-card"><div class="k-card-head"><div class="k-card-title"><h2>Renewals</h2></div></div></section>
    <section class="k-card" hidden><div class="k-card-head"><div class="k-card-title"><h2>Hidden</h2></div></div></section>
  </main>`;

describe("P79 Show me on this page over a Prima screen", () => {
  beforeEach(() => {
    // jsdom lays nothing out: everything not hidden counts as drawn.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
    });
    document.body.innerHTML = SCREEN;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("walks the screen's parts in order, each with its element", () => {
    const before = document.body.innerHTML;
    const steps = primaLayoutSteps((s, v) => translate("en", s, v));
    expect(steps.map((s) => s.text)).toEqual([
      "Contracts: Each site is mobilised against 12 workstreams.",
      "Press New contract to start a new one: a form opens at the side.",
      "Also at the top: Export.",
      "The tabs split the screen into parts: Needs attention, Live and All. Pick one to see it.",
      "The numbers show where things stand. Press one to see just those.",
      "Search here to find one quickly.",
      "Needs attention: 23 contracts",
      "Renewals is shown here.",
    ]);
    expect(steps[1]!.el?.textContent).toBe("New contract");
    expect(steps.every((s) => s.el instanceof Element)).toBe(true);
    // Prima's page is read, not changed.
    expect(document.body.innerHTML).toBe(before);
  });

  it("speaks Malay with the screen's own names", () => {
    const steps = primaLayoutSteps((s, v) => translate("ms", s, v));
    expect(steps[1]!.text).toBe("Tekan New contract untuk mula yang baharu: borang dibuka di tepi.");
    expect(steps[3]!.text).toContain("Needs attention, Live dan All");
  });

  it("has nothing to say about a screen without Prima's layout", () => {
    document.body.innerHTML = "<main><p>Loading</p></main>";
    expect(primaLayoutSteps((s) => s)).toEqual([]);
  });
});
