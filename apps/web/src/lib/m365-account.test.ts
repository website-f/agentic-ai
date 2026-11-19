/** P118: the Microsoft account picked on the Microsoft 365 page goes with that page's calls only. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, setM365Account } from "./api";
import { attachmentUrl } from "./m365";

describe("the account picked on the Microsoft 365 page", () => {
  afterEach(() => {
    setM365Account(null);
    vi.unstubAllGlobals();
  });

  it("is sent with Microsoft 365 calls only, and in plain links", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await api("/api/m365/mail");
    setM365Account("ma_personal");
    await api("/api/m365/mail");
    await api("/api/tasks");
    expect(seen.map((s) => s.headers["x-m365-account"])).toEqual([undefined, "ma_personal", undefined]);
    expect(attachmentUrl("m1", "a1")).toBe("/api/m365/mail/m1/attachments/a1?account=ma_personal");
    setM365Account(null);
    expect(attachmentUrl("m1", "a1")).toBe("/api/m365/mail/m1/attachments/a1");
  });
});
