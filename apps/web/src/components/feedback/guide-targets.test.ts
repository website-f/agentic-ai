import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boxOf, findStep, labelOf, matchByWords, names, plain } from "./guide-targets";

// jsdom lays nothing out: each element says where it is with data-box="x y w h".
function layOut() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const [x = 0, y = 0, w = 0, h = 0] = (this.getAttribute("data-box") ?? "0 0 0 0").split(" ").map(Number);
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.hasAttribute("data-box") ? [{}] : []) as unknown as DOMRectList;
  });
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
}

describe("P79 Show me on this page: finding each step", () => {
  beforeEach(layOut);
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("reads words the same in any script and case", () => {
    expect(plain("  Give your AI a task, NOW! ")).toBe("give your ai a task now");
    expect(plain("Beri AI tugasan: «Hantar»")).toBe("beri ai tugasan hantar");
  });

  it("takes a name as a name: its case, whole words, not just a sentence's first word", () => {
    expect(names("Approve bills in Payables, then Approve.", "Payables")).toBe(true);
    expect(names("Hire agents into them.", "Agents")).toBe(false);
    expect(names("Agents asking means an agent is stuck.", "Agents")).toBe(false);
    expect(names("Search to see what an agent knows.", "Search")).toBe(false);
    expect(names("New here? Follow Getting started, one step at a time.", "Getting started")).toBe(true);
    expect(names("Link a computer: copy one line into it.", "Link a computer")).toBe(true);
    expect(names("Check Runs and Incidents for failures.", "Incidents")).toBe(true);
    expect(names("Steps tick themselves when they are done.", "done")).toBe(false);
    document.body.innerHTML = `<button style="text-transform:uppercase">Library <span>3</span></button>`;
    expect(labelOf(document.querySelector("button")!)).toBe("Library 3");
  });

  it("finds the button or heading a step names, the longest name winning", () => {
    document.body.innerHTML = `
      <nav><a href="/work" data-box="0 100 200 30">My work</a></nav>
      <main>
        <h2 data-box="300 100 400 30">Waiting for you</h2>
        <button data-box="300 200 120 36">Give your AI a task</button>
        <button data-box="300 260 60 36">Task</button>
        <button data-box="300 300 60 36">OK</button>
        <section data-box="300 400 400 200"><h3 data-box="300 400 200 20">My work</h3></section>
      </main>`;
    expect(matchByWords("Type what you need in Give your AI a task, in your own words.")?.textContent).toBe("Give your AI a task");
    expect(matchByWords("Answer anything under Waiting for you first.")?.localName).toBe("h2");
    // On the page itself before the menu.
    expect(matchByWords("Accept or send back finished work in My work.")?.localName).toBe("h3");
    // Too short to trust, or nothing that matches.
    expect(matchByWords("Press OK.")).toBeNull();
    expect(matchByWords("Something not on this page.")).toBeNull();
  });

  it("leaves out what is hidden and the feedback button itself", () => {
    document.body.innerHTML = `
      <main>
        <button>Send feedback</button>
        <div data-feedback-ignore=""><button data-box="0 0 50 50">Send feedback</button></div>
        <div aria-hidden="true"><button data-box="0 0 50 50">Send feedback</button></div>
      </main>`;
    expect(matchByWords("Press Send feedback.")).toBeNull();
  });

  it("takes the step's own target first, then its words", () => {
    document.body.innerHTML = `
      <main>
        <button data-guide="new-claim" data-box="10 10 80 30">+</button>
        <button data-box="10 60 80 30">New claim</button>
      </main>`;
    expect(findStep({ text: "Press New claim.", target: "[data-guide=new-claim]" })?.textContent).toBe("+");
    expect(findStep({ text: "Press New claim.", target: "[data-guide=gone]" })?.textContent).toBe("New claim");
    expect(findStep({ text: "Press New claim.", target: "::not a selector((" })?.textContent).toBe("New claim");
  });

  it("knows when the element is scrolled away", () => {
    document.body.innerHTML = `<button data-box="10 900 80 30">Below</button><button data-box="10 -90 80 30">Above</button><button data-box="1150 790 100 40">Edge</button>`;
    const [below, above, edge] = Array.from(document.querySelectorAll("button"));
    expect(boxOf(below!).off).toBe("below");
    expect(boxOf(above!).off).toBe("above");
    expect(boxOf(edge!)).toEqual({ x: 1150, y: 790, w: 50, h: 10, off: null });
  });
});
