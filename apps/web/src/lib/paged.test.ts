import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { editPaged, flatten, pagedQuery, type Page } from "./paged";

type Row = { id: string; status: string };
const page = (items: Row[], next: string | null = null): Page<Row> => ({ items, next, total: 3 });

describe("paged lists", () => {
  it("flattens pages in order and drops a row a later page repeats", () => {
    const data: InfiniteData<Page<Row>, string | null> = {
      pages: [page([{ id: "a", status: "x" }, { id: "b", status: "x" }], "c1"), page([{ id: "b", status: "x" }, { id: "c", status: "x" }])],
      pageParams: [null, "c1"],
    };
    expect(flatten(data).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(flatten(undefined)).toEqual([]);
  });

  it("keys start with the list's own key, so existing invalidations reach them", () => {
    const opts = pagedQuery<Row>(["tasks", "board"], "/api/tasks", { status: "done" });
    expect(opts.queryKey.slice(0, 2)).toEqual(["tasks", "board"]);
  });

  it("edits the loaded rows of every paged query under a key, with that query's params", () => {
    const qc = new QueryClient();
    const done = pagedQuery<Row>(["tasks", "board"], "/api/tasks", { status: "done" });
    const triage = pagedQuery<Row>(["tasks", "board"], "/api/tasks", { status: "triage" });
    qc.setQueryData(done.queryKey, { pages: [page([{ id: "a", status: "done" }])], pageParams: [null] });
    qc.setQueryData(triage.queryKey, { pages: [page([])], pageParams: [null] });
    qc.setQueryData(["tasks"], [{ id: "a", status: "done" }]); // a plain list is left alone

    editPaged<Row>(qc, ["tasks", "board"], (items, i, params) => {
      const rest = items.filter((r) => r.id !== "a");
      return params.status === "triage" && i === 0 ? [{ id: "a", status: "triage" }, ...rest] : rest;
    });

    expect(flatten(qc.getQueryData(done.queryKey))).toEqual([]);
    expect(flatten(qc.getQueryData(triage.queryKey))).toEqual([{ id: "a", status: "triage" }]);
    expect(qc.getQueryData(["tasks"])).toEqual([{ id: "a", status: "done" }]);
  });
});
