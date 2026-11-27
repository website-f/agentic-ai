import { describe, expect, it } from "vitest";

import { archiveUrl } from "./intake";
import { unitArchiveUrl, unitTreeQuery } from "./library-units";

describe("P143b library units", () => {
  it("narrows a company's ZIP to the unit's department", () => {
    const base = archiveUrl({ branch_id: "br_pw", folder: "Polisi" });
    expect(unitArchiveUrl(base, "dp_hr")).toBe("/api/files/archive?branch_id=br_pw&folder=Polisi&department_id=dp_hr");
    expect(unitArchiveUrl(base, null)).toBe(base);
  });

  it("keeps a unit's folder tree under the files key, apart from its company's", () => {
    const q = unitTreeQuery({ branch_id: "br_pw", department_id: "dp_hr" });
    expect(q.queryKey).toEqual(["files", "tree", "br_pw", "unit", "dp_hr"]);
    expect(q.enabled).toBe(true);
    expect(unitTreeQuery(null).enabled).toBe(false);
  });
});
