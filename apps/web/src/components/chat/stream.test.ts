import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import { applyEvent, EMPTY_LIVE, type Live, streamChat } from "./stream";

/** A fetch answer that sends `lines` one chunk at a time (split mid-line on purpose). */
function ndjson(lines: object[]): Response {
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const enc = new TextEncoder();
  const cut = Math.floor(text.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text.slice(0, cut)));
      c.enqueue(enc.encode(text.slice(cut)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("applyEvent", () => {
  it("adds words, forgets them on a reset, and lists the tools", () => {
    let live: Live = EMPTY_LIVE;
    live = applyEvent(live, { t: "delta", text: "Let me" });
    live = applyEvent(live, { t: "delta", text: " check" });
    expect(live.text).toBe("Let me check");
    live = applyEvent(live, { t: "reset" });
    live = applyEvent(live, { t: "tool", name: "calc" });
    live = applyEvent(live, { t: "delta", text: "It is 96." });
    expect(live).toEqual({ text: "It is 96.", tools: ["calc"] });
  });
});

describe("streamChat", () => {
  it("shows the answer as it comes, then gives the saved one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([
      { t: "start", session_id: "cs_1" },
      { t: "delta", text: "Three" },
      { t: "delta", text: " invoices." },
      { t: "done", session_id: "cs_1", reply: "Three invoices.", tools_used: [], message_id: 7 },
    ])));
    const seen: string[] = [];
    let started = "";
    const done = await streamChat("ag_1", { message: "hi", session_id: null }, {
      start: (id) => (started = id),
      live: (l) => seen.push(l.text),
    });
    expect(started).toBe("cs_1");
    expect(seen).toEqual(["Three", "Three invoices."]);
    expect(done.reply).toBe("Three invoices.");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/agents/ag_1/chat/stream");
  });

  it("turns an error line into the same error the plain chat gives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([
      { t: "start", session_id: "cs_1" },
      { t: "error", code: "no_model_available", message: "No model in the Smart group could answer." },
    ])));
    const err = await streamChat("ag_1", { message: "hi", session_id: "cs_1" }, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("no_model_available");
  });

  it("a stream cut short is a lost connection: the page watches for the answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson([{ t: "start", session_id: "cs_9" }, { t: "delta", text: "Thr" }])));
    const err = await streamChat("ag_1", { message: "hi", session_id: null }, {}).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(0);
  });
});
