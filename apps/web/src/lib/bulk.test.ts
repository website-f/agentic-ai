import { describe, expect, it } from "vitest";

import { bulkBatches, bulkDelete, type BulkCall } from "./bulk";

describe("P81 bulk delete", () => {
  it("splits a long selection into calls the server takes, files before SOPs", () => {
    const files = Array.from({ length: 7 }, (_, i) => `fl_${i}`);
    const out = bulkBatches([...files, "fl_0"], ["sp_1", "sp_2"], 4);
    expect(out).toEqual([
      { files: ["fl_0", "fl_1", "fl_2", "fl_3"], sops: [] },
      { files: ["fl_4", "fl_5", "fl_6"], sops: ["sp_1"] },
      { files: [], sops: ["sp_2"] },
    ]);
    expect(bulkBatches([], [])).toEqual([]);
  });

  it("adds up what each call deleted and skipped", async () => {
    const seen: number[] = [];
    const send: BulkCall = async (b) => {
      seen.push(b.files.length + b.sops.length);
      return {
        files: b.files.filter((id) => id !== "fl_theirs").length,
        sops: b.sops.length,
        skipped: b.files.includes("fl_theirs") ? [{ kind: "file", id: "fl_theirs", reason: "not_allowed" }] : [],
      };
    };
    const files = Array.from({ length: 600 }, (_, i) => `fl_${i}`);
    const r = await bulkDelete({ files: [...files, "fl_theirs"], sops: ["sp_1"] }, send);
    expect(seen).toEqual([500, 102]);
    expect(r.files).toBe(600);
    expect(r.sops).toBe(1);
    expect(r.skipped).toEqual([{ kind: "file", id: "fl_theirs", reason: "not_allowed" }]);
  });
});
