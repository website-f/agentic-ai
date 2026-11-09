import { describe, expect, it, vi } from "vitest";

import { invalidationBatcher, isNewEvent, resetLive, streamUrl, useLive } from "./live";

describe("live event dedupe", () => {
  it("drops events at or below the last seq seen", () => {
    expect(isNewEvent({ seq: 5 }, 4)).toBe(true);
    expect(isNewEvent({ seq: 5 }, 5)).toBe(false);
    expect(isNewEvent({ seq: 3 }, 5)).toBe(false);
    expect(isNewEvent({ seq: 1 }, 0)).toBe(true);
  });

  it("lets un-numbered events through", () => {
    expect(isNewEvent({ seq: 0 }, 9)).toBe(true);
    expect(isNewEvent({ seq: undefined as unknown as number }, 9)).toBe(true);
  });

  it("a replay after reconnect only handles each event once", () => {
    let last = 0;
    const handled: number[] = [];
    for (const seq of [1, 2, 3, /* reconnect replays from since=1 */ 2, 3, 4]) {
      if (!isNewEvent({ seq }, last)) continue;
      last = seq;
      handled.push(seq);
    }
    expect(handled).toEqual([1, 2, 3, 4]);
  });

  it("resumes the stream from the last seq", () => {
    expect(streamUrl(0)).toBe("/api/events");
    expect(streamUrl(42)).toBe("/api/events?since=42");
  });

  it("sign-out forgets live agent status", () => {
    useLive.setState({ connected: true, agentStatus: { a1: { status: "working", task: null } } });
    resetLive();
    expect(useLive.getState().agentStatus).toEqual({});
    expect(useLive.getState().connected).toBe(false);
  });
});

describe("live invalidation batching (P96)", () => {
  it("refreshes each key once after a quiet moment", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const b = invalidationBatcher((k) => ran.push(JSON.stringify(k)));
    b.add(["tasks"]);
    b.add(["tasks"]);
    b.add(["status"]);
    vi.advanceTimersByTime(249);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['["tasks"]', '["status"]']);
    vi.useRealTimers();
  });

  it("still refreshes within a second while events never stop (50 busy agents)", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const b = invalidationBatcher((k) => ran.push(JSON.stringify(k)));
    for (let ms = 0; ms < 3000; ms += 100) {
      b.add(["tasks"]);
      vi.advanceTimersByTime(100);
    }
    expect(ran.length).toBeGreaterThanOrEqual(2); // a plain debounce: 0 until the events stop
    b.cancel();
    vi.useRealTimers();
  });

  it("cancel drops what was waiting", () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const b = invalidationBatcher((k) => ran.push(JSON.stringify(k)));
    b.add(["tasks"]);
    b.cancel();
    vi.advanceTimersByTime(2000);
    expect(ran).toEqual([]);
    vi.useRealTimers();
  });
});
