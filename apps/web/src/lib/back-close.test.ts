import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeSheet, openSheet, resetBackCloseForTests } from "./back-close";

/** history.back() fires popstate a moment later (a task); give it time. */
const tick = () => new Promise((r) => setTimeout(r, 40));
const popped = tick;
const sheetIds = () => ((window.history.state as { __sheets?: string[] } | null)?.__sheets ?? []);

describe("back-close (P96: the phone's Back closes the open sheet)", () => {
  beforeEach(() => {
    resetBackCloseForTests();
    window.history.replaceState({ __TSR_index: 3, key: "k" }, "");
  });
  afterEach(() => resetBackCloseForTests());

  it("opening adds one entry at the same address, keeping the router's state", () => {
    window.history.pushState({ __TSR_index: 3, key: "k" }, ""); // drops any forward entries
    const before = window.history.length;
    const href = window.location.href;
    openSheet(() => {});
    expect(window.history.length).toBe(before + 1);
    expect(window.location.href).toBe(href);
    expect(sheetIds()).toHaveLength(1);
    expect((window.history.state as { __TSR_index: number }).__TSR_index).toBe(3);
  });

  it("Back closes the sheet and the router never hears the pop", async () => {
    const close = vi.fn();
    const router = vi.fn();
    window.addEventListener("popstate", router);
    openSheet(close);
    const p = popped();
    window.history.back();
    await p;
    expect(close).toHaveBeenCalledTimes(1);
    expect(router).not.toHaveBeenCalled();
    window.removeEventListener("popstate", router);
  });

  it("closing it another way takes its entry back off, quietly", async () => {
    const close = vi.fn();
    const router = vi.fn();
    window.addEventListener("popstate", router);
    const entry = openSheet(close);
    const p = popped();
    closeSheet(entry);
    await p;
    expect(sheetIds()).toEqual([]);
    expect(close).not.toHaveBeenCalled();
    expect(router).not.toHaveBeenCalled();
    window.removeEventListener("popstate", router);
  });

  it("stacked sheets close one per Back, the top one first", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    openSheet(outer);
    openSheet(inner);
    let p = popped();
    window.history.back();
    await p;
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    p = popped();
    window.history.back();
    await p;
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("a sheet that reopens at once (StrictMode) reuses its entry instead of adding one", async () => {
    const first = openSheet(() => {});
    const after = window.history.length;
    closeSheet(first);
    openSheet(() => {});
    await tick();
    expect(window.history.length).toBe(after);
    expect(sheetIds()).toHaveLength(1);
  });

  it("Back from the next page steps over the entry a sheet left behind", async () => {
    window.history.pushState({ __TSR_index: 3, key: "k" }, "", "/start");
    const entry = openSheet(() => {});
    window.history.pushState({ __TSR_index: 4 }, "", "/next");
    closeSheet(entry); // the sheet unmounted with its page
    window.history.back(); // lands on the left-behind entry, which is skipped
    await tick();
    await tick();
    expect(window.location.pathname).toBe("/start");
    expect(sheetIds()).toEqual([]);
  });

  it("when the page moved on while it was open, the entry is left alone", async () => {
    const entry = openSheet(() => {});
    window.history.pushState({ __TSR_index: 4 }, "", "/elsewhere");
    const len = window.history.length;
    closeSheet(entry);
    await tick();
    expect(window.history.length).toBe(len);
    expect(window.location.pathname).toBe("/elsewhere");
  });
});
