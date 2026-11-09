/**
 * P93: the feedback screens on a phone. After marking the screenshot the note and Send must be in
 * reach: the sheet scrolls, a finger draws only while marking (Done / Mark switch), and the layer
 * follows the part of the screen the on-screen keyboard leaves.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Annotator, phonePictureFit, type Shot } from "./annotator";
import { dropShift, lowestY } from "./core";
import { LiquidLayer, readVisible } from "./liquid-layer";

function media(phone: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: phone && q.includes("max-width: 767px"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

const shot = (): Shot => ({ canvas: document.createElement("canvas"), width: 390, height: 844, scale: 1, url: "data:image/png;base64,", via: "page" });

function annotator(onSend = vi.fn()) {
  render(<Annotator shot={shot()} pageLabel="Tasks" onCancel={() => {}} onSend={onSend} sending={false} />);
  return onSend;
}

const canvas = () => document.querySelector<SVGSVGElement>("svg[data-feedback-canvas]")!;
const marks = () => canvas().querySelectorAll(":scope > g").length;
function press(pointerType: "touch" | "mouse" | "pen", x = 100, y = 200, pointerId = 1) {
  fireEvent.pointerDown(canvas(), { pointerType, pointerId, button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(canvas(), { pointerType, pointerId, button: 0, clientX: x, clientY: y });
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  // jsdom lays nothing out: the picture is 300 x 650 on screen.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 650, width: 300, height: 650, toJSON() {} } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("P93 mark up this screen on a phone", () => {
  it("is one sheet that scrolls, with Send in a footer outside it", () => {
    media(true);
    annotator();
    const layout = document.querySelector("[data-layout]")!;
    expect(layout.getAttribute("data-layout")).toBe("phone");
    const scroller = document.querySelector<HTMLElement>("[data-feedback-scroll]")!;
    expect(scroller).not.toBeNull();
    expect(scroller.className).toContain("overflow-y-auto");
    // The picture and the note are inside what scrolls…
    expect(scroller.contains(canvas())).toBe(true);
    expect(scroller.contains(screen.getByRole("textbox"))).toBe(true);
    // …and Send and the Done switch are not: they stay in sight.
    const footer = layout.querySelector("footer")!;
    expect(scroller.contains(footer)).toBe(false);
    expect(footer.textContent).toContain("Send");
    expect(footer.textContent).toContain("Done, write a note");
  });

  it("draws with a finger only while marking", () => {
    media(true);
    annotator();
    expect(canvas().dataset.marking).toBe("on");
    expect(canvas().getAttribute("class")).toContain("touch-none");
    press("touch");
    expect(marks()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Done, write a note/ }));
    expect(canvas().dataset.marking).toBe("off");
    // The browser may scroll and zoom over the picture now, and a finger leaves no mark.
    expect(canvas().getAttribute("class")).toContain("touch-auto");
    expect(canvas().getAttribute("class")).not.toContain("touch-none");
    press("touch", 120, 260);
    expect(marks()).toBe(1);
    // A mouse or a pen still draws.
    press("mouse", 150, 300);
    expect(marks()).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /Mark the picture/ }));
    expect(canvas().dataset.marking).toBe("on");
    press("touch", 200, 400);
    expect(marks()).toBe(3);
  });

  it("Done takes you to the note; typing in it stops marking; picking a tool starts again", () => {
    media(true);
    annotator();
    fireEvent.click(screen.getByRole("button", { name: /Done, write a note/ }));
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    expect(canvas().dataset.marking).toBe("on");
    fireEvent.focus(screen.getByRole("textbox"));
    expect(canvas().dataset.marking).toBe("off");
  });

  it("a second finger is a pinch, not a mark", () => {
    media(true);
    annotator();
    fireEvent.pointerDown(canvas(), { pointerType: "touch", pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerDown(canvas(), { pointerType: "touch", pointerId: 2, button: 0, clientX: 250, clientY: 400 });
    fireEvent.pointerMove(canvas(), { pointerType: "touch", pointerId: 2, clientX: 280, clientY: 500 });
    fireEvent.pointerUp(canvas(), { pointerType: "touch", pointerId: 2, button: 0, clientX: 280, clientY: 500 });
    fireEvent.pointerUp(canvas(), { pointerType: "touch", pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    expect(marks()).toBe(0);
  });

  it("sends the note with the marks", () => {
    media(true);
    const onSend = annotator();
    press("touch");
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Hard to find" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send/ }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ note: "Hard to find", category: "other" }));
    expect(onSend.mock.calls[0]![0].marks).toHaveLength(1);
  });

  it("has 44 px buttons for fingers, and one colour button that goes round the colours", () => {
    media(true);
    annotator();
    for (const name of ["Circle", "Box", "Arrow", "Pen", "Undo", "Clear all marks", "Close"]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/size-11/);
    }
    const colour = screen.getByRole("button", { name: /Colour/ });
    const swatch = () => (colour.firstElementChild as HTMLElement).style.background;
    const first = swatch();
    fireEvent.click(colour);
    expect(swatch()).not.toBe(first);
  });

  it("keeps the wide layout on a desktop: the picture beside the note, drawing always on", () => {
    media(false);
    annotator();
    expect(document.querySelector("[data-layout]")!.getAttribute("data-layout")).toBe("wide");
    expect(document.querySelector("[data-feedback-scroll]")).toBeNull();
    expect(canvas().dataset.marking).toBe("on");
    expect(screen.queryByRole("button", { name: /Done, write a note/ })).toBeNull();
    press("mouse");
    expect(marks()).toBe(1);
    expect(screen.getByRole("button", { name: /Send feedback/ })).toBeInTheDocument();
  });
});

describe("P93 phone sizes", () => {
  it("fits the picture to the width and leaves a strip of the note in sight", () => {
    const tall = phonePictureFit({ width: 390, height: 844 }, { width: 366, height: 560 });
    expect(tall.h).toBeGreaterThanOrEqual(559);
    expect(tall.h).toBeLessThanOrEqual(560);
    expect(tall.w).toBeLessThan(366); // the height is what limits it
    const narrow = phonePictureFit({ width: 390, height: 844 }, { width: 200, height: 2000 });
    expect(narrow.w).toBeGreaterThanOrEqual(199);
    expect(narrow.w).toBeLessThanOrEqual(200);
    // Never smaller than 200 px high, even on a short landscape screen.
    expect(phonePictureFit({ width: 667, height: 375 }, { width: 643, height: 40 }).h).toBe(200);
  });

  it("keeps the button above the office's tab bar on a phone, and every drop on the screen", () => {
    expect(lowestY(false, 900)).toBe(0.88);
    expect(lowestY(true, 667)).toBeCloseTo(1 - 104 / 667);
    expect(lowestY(true, 2000)).toBe(0.88);
    expect(dropShift(400, 844)).toBe(0);
    expect(dropShift(800, 844)).toBe(844 - 123 - 800); // moved up
    expect(dropShift(60, 844)).toBe(123 - 60); // moved down
  });
});

describe("P93 the on-screen keyboard", () => {
  const win = (vv: Partial<VisualViewport> | undefined, innerHeight = 844) => ({ visualViewport: vv, innerHeight }) as unknown as Window;

  it("knows how much of the screen can be seen", () => {
    expect(readVisible(win(undefined))).toBeNull();
    expect(readVisible(win({ height: 844, offsetTop: 0, scale: 1 }))).toBeNull();
    expect(readVisible(win({ height: 480.4, offsetTop: 0, scale: 1 }))).toEqual({ height: 480, top: 0 });
    expect(readVisible(win({ height: 480, offsetTop: 120, scale: 1 }))).toEqual({ height: 480, top: 120 });
    // Zoomed in with two fingers: not the keyboard; the layer stays full size.
    expect(readVisible(win({ height: 300, offsetTop: 200, scale: 2 }))).toBeNull();
  });

  it("sizes the layer to the part above the keyboard, and back", async () => {
    media(true);
    const vv = Object.assign(new EventTarget(), { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => f(0), 0));
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    render(
      <LiquidLayer open origin={{ x: 300, y: 500 }} onClose={() => {}} label="Write feedback">
        <textarea aria-label="note" />
      </LiquidLayer>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.dataset.visible).toBe("all");
    await act(async () => {
      vv.height = 460;
      vv.dispatchEvent(new Event("resize"));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(dialog.dataset.visible).toBe("part");
    expect(dialog.style.height).toBe("460px");
    expect(dialog.style.top).toBe("0px");
    await act(async () => {
      vv.height = 844;
      vv.dispatchEvent(new Event("resize"));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(dialog.dataset.visible).toBe("all");
    expect(dialog.style.height).toBe("");
  });
});
