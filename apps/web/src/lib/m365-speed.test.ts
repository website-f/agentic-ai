/** P148a: the Microsoft 365 page asks again soon only while the server says it is refreshing,
 * and opening the page asks for the other tabs' first answers at once. */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { m365Keys, prefetchM365, soonIfRefreshing, thisWeekQuery } from "./m365";

describe("soonIfRefreshing", () => {
  const every = soonIfRefreshing(60_000);
  it("asks again in a moment while a kept answer is being refreshed", () => {
    expect(every({ state: { data: { refreshing: true } } })).toBe(2_500);
  });
  it("otherwise keeps its own pace (also with no answer yet, or a list)", () => {
    expect(every({ state: { data: { refreshing: false } } })).toBe(60_000);
    expect(every({ state: { data: undefined } })).toBe(60_000);
    expect(every({ state: { data: [] } })).toBe(60_000);
  });
});

describe("prefetchM365", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the inbox, this week and (with Teams) the chats in parallel", () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      asked.push(url.split("?")[0] ?? url);
      return new Promise(() => {}); // still on its way: all were asked before any answered
    }));
    const qc = new QueryClient();
    prefetchM365(qc, { teams: true });
    expect(asked.sort()).toEqual(["/api/m365/calendar", "/api/m365/mail", "/api/m365/teams/chats"]);
    expect(qc.getQueryCache().find({ queryKey: m365Keys.chats })).toBeTruthy();
    expect(qc.getQueryCache().find({ queryKey: thisWeekQuery().queryKey })).toBeTruthy();
  });

  it("leaves Teams out for a personal Microsoft account", () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      asked.push(url.split("?")[0] ?? url);
      return new Promise(() => {});
    }));
    prefetchM365(new QueryClient(), { teams: false });
    expect(asked).not.toContain("/api/m365/teams/chats");
  });
});
