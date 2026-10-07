import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyUpdate, hasUnsaved, markUnsaved, resetUnsavedForTests, useUnsaved, whenSaved } from "./unsaved";

afterEach(() => resetUnsavedForTests());

describe("unsaved registry", () => {
  it("tracks each editor separately", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    expect(hasUnsaved()).toBe(false);
    markUnsaved(a, true);
    markUnsaved(b, true);
    markUnsaved(a, false);
    expect(hasUnsaved()).toBe(true);
    markUnsaved(b, false);
    expect(hasUnsaved()).toBe(false);
  });

  it("useUnsaved follows the flag and clears on unmount", () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsaved(dirty), { initialProps: { dirty: false } });
    expect(hasUnsaved()).toBe(false);
    rerender({ dirty: true });
    expect(hasUnsaved()).toBe(true);
    rerender({ dirty: false });
    expect(hasUnsaved()).toBe(false);
    rerender({ dirty: true });
    unmount();
    expect(hasUnsaved()).toBe(false);
  });

  it("asks before the tab closes only while something is unsaved", () => {
    const fire = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(fire()).toBe(false);
    const done = markUnsaved(Symbol("x"), true);
    expect(fire()).toBe(true);
    done();
    expect(fire()).toBe(false);
  });

  it("whenSaved runs now when clean, else once everything is saved", () => {
    const now = vi.fn();
    whenSaved(now);
    expect(now).toHaveBeenCalledTimes(1);

    const a = Symbol("a");
    const b = Symbol("b");
    markUnsaved(a, true);
    markUnsaved(b, true);
    const later = vi.fn();
    whenSaved(later);
    markUnsaved(a, false);
    expect(later).not.toHaveBeenCalled();
    markUnsaved(b, false);
    expect(later).toHaveBeenCalledTimes(1);
    markUnsaved(a, true);
    markUnsaved(a, false);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("an app update never reloads under unsaved work", () => {
    const reload = vi.fn();
    applyUpdate(reload);
    expect(reload).toHaveBeenCalledTimes(1);

    reload.mockClear();
    const done = markUnsaved(Symbol("doc"), true);
    act(() => applyUpdate(reload));
    applyUpdate(reload); // a second "new version" signal does not stack
    expect(reload).not.toHaveBeenCalled();
    done();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
