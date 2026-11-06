import { describe, expect, it } from "vitest";

import { FIRST_PAGE, memberStatus, membersPageUrl, nextSort, pageRange, toggleAll, withFilter } from "./members";

describe("P82 members table", () => {
  it("asks the server for one page with only the filters set", () => {
    expect(membersPageUrl(FIRST_PAGE)).toBe("/api/members?page=1&page_size=25");
    const f = withFilter(FIRST_PAGE, { q: "  siti ", company: "none", role: "staff", status: "pending", sort: "last_seen", dir: "desc", pageSize: 100 });
    expect(membersPageUrl({ ...f, page: 3 })).toBe(
      "/api/members?page=3&page_size=100&q=siti&company=none&role=staff&status=pending&sort=last_seen&dir=desc",
    );
  });

  it("goes back to page 1 when a filter changes, not when the page does", () => {
    const on3 = { ...FIRST_PAGE, page: 3 };
    expect(withFilter(on3, { role: "hod" }).page).toBe(1);
    expect(withFilter(on3, { pageSize: 50 }).page).toBe(1);
    expect(withFilter(on3, { page: 4 }).page).toBe(4);
  });

  it("says which rows a page shows", () => {
    expect(pageRange(1, 25, 239)).toEqual({ pages: 10, from: 1, to: 25 });
    expect(pageRange(10, 25, 239)).toEqual({ pages: 10, from: 226, to: 239 });
    expect(pageRange(1, 25, 0)).toEqual({ pages: 1, from: 0, to: 0 });
    expect(pageRange(12, 100, 239)).toEqual({ pages: 3, from: 201, to: 239 }); // past the end
  });

  it("reads each member's status as the server filters it", () => {
    expect(memberStatus({ is_active: true, must_change_password: false })).toBe("active");
    expect(memberStatus({ is_active: true, must_change_password: true })).toBe("pending");
    expect(memberStatus({ is_active: false, must_change_password: true })).toBe("disabled");
  });

  it("turns a column round, or starts a new one the natural way", () => {
    expect(nextSort({ sort: "name", dir: "asc" }, "name")).toEqual({ sort: "name", dir: "desc" });
    expect(nextSort({ sort: "name", dir: "asc" }, "last_seen")).toEqual({ sort: "last_seen", dir: "desc" });
    expect(nextSort({ sort: "last_seen", dir: "desc" }, "company")).toEqual({ sort: "company", dir: "asc" });
  });

  it("ticks the whole page, keeping other pages' ticks", () => {
    const other = new Set(["a"]);
    const on = toggleAll(other, ["b", "c"]);
    expect([...on].sort()).toEqual(["a", "b", "c"]);
    expect([...toggleAll(on, ["b", "c"])]).toEqual(["a"]);
    expect([...toggleAll(new Set(["b"]), ["b", "c"])].sort()).toEqual(["b", "c"]);
  });
});
