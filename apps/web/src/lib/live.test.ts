import { describe, expect, it } from "vitest";

import { isNewEvent, resetLive, streamUrl, useLive } from "./live";

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
