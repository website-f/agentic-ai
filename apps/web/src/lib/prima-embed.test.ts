/** P117: what Prima tells the office about its menu is checked before the sidebar uses it, and kept
 * per person on this device. */
import { beforeEach, describe, expect, it } from "vitest";

import { allScreens, cleanMenu, MENU_FRESH_MS, menuIsFresh, primaGo, usePrima } from "./prima-embed";

describe("Prima's menu inside the office", () => {
  beforeEach(() => {
    localStorage.clear();
    usePrima.setState({ userId: null, menu: null, frame: null, hash: "", view: "", space: null });
  });

  it("keeps only well-formed apps and screens", () => {
    expect(cleanMenu(null)).toBeNull();
    expect(cleanMenu({ apps: "x", screens: 5 })).toBeNull();
    const menu = cleanMenu({
      apps: [{ id: "hr", title: "HR", screens: [{ view: "attendance", label: "Attendance" }, { view: 7 }] }, { title: "no id" }],
      screens: [{ view: "clock", label: "Clock" }, "junk"],
      extra: "<script>",
    });
    expect(menu).toEqual({
      apps: [{ id: "hr", title: "HR", screens: [{ view: "attendance", label: "Attendance" }] }],
      screens: [{ view: "clock", label: "Clock" }],
    });
    expect(allScreens(menu).map((s) => s.view)).toEqual(["clock", "attendance"]);
  });

  it("remembers each person's menu on this device, not anyone else's", () => {
    usePrima.getState().load("us_a");
    usePrima.getState().setMenu({ apps: [], screens: [{ view: "clock", label: "Clock" }] });
    usePrima.getState().load("us_b");
    expect(usePrima.getState().menu).toBeNull();
    usePrima.getState().load("us_a");
    expect(usePrima.getState().menu?.screens[0]?.view).toBe("clock");
  });

  it("opens a screen in the Prima already showing, only when one is", () => {
    expect(primaGo("#clock")).toBe(false);
    const sent: unknown[] = [];
    usePrima.getState().setFrame({ postMessage: (m: unknown) => sent.push(m) } as unknown as Window);
    expect(primaGo("#@hr")).toBe(true);
    expect(sent).toEqual([{ source: "office", type: "go", hash: "#@hr" }]);
  });

  it("is read again in the background only when it is old (P119)", () => {
    const now = 1_000_000_000_000;
    expect(menuIsFresh(0, now)).toBe(false); // never read, or kept before P119
    expect(menuIsFresh(now - 60_000, now)).toBe(true);
    expect(menuIsFresh(now - MENU_FRESH_MS - 1, now)).toBe(false);
    usePrima.getState().load("us_c");
    usePrima.getState().setMenu({ apps: [], screens: [{ view: "clock", label: "Clock" }] });
    expect(menuIsFresh(usePrima.getState().menuAt)).toBe(true);
  });
});
