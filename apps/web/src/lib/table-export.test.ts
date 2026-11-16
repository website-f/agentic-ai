/** P107: Export on a server-mode table fetches every matching row, page by page, with the
 * table's own search, sort and filters. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { TABLE_DEFAULTS } from "@/components/ui/data-table";

import { everyRow } from "./table-export";

afterEach(() => vi.unstubAllGlobals());

describe("everyRow", () => {
  it("walks the pages until the total, with the table's search, sort, filters and extras", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://office.test");
      urls.push(`${url.pathname}${url.search}`);
      const page = Number(url.searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) : [{ id: "b0" }, { id: "b1" }];
      return new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json", "X-Total-Count": "102" } });
    }));
    const state = { ...TABLE_DEFAULTS, q: "tender", page: 3, sort: "when", dir: "desc" as const, f: { state: "failed" } };
    const rows = await everyRow<{ id: string }, { items: { id: string }[] }>("/api/deliveries", state, { channel: "email" }, (b) => b.items);
    expect(rows).toHaveLength(102);
    expect(urls).toHaveLength(2);
    const first = new URLSearchParams(urls[0]!.split("?")[1]);
    expect(Object.fromEntries(first)).toEqual({ channel: "email", page: "1", size: "100", q: "tender", sort: "-when", state: "failed" });
    expect(new URLSearchParams(urls[1]!.split("?")[1]).get("page")).toBe("2");
  });

  it("stops on an empty page even when the total says more", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "X-Total-Count": "50" } })));
    expect(await everyRow("/api/reports", TABLE_DEFAULTS)).toEqual([]);
  });
});
