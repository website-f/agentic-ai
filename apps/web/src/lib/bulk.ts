/** P81: delete many files and SOPs at once (Library, Browse, SOPs). The server checks each
 * item against the person (as deleting one does) and skips, with a reason, what they may not
 * delete or what is already gone. At most BULK_MAX items per call: longer lists go in turns. */
import { api } from "@/lib/api";

export const BULK_MAX = 500;

export interface BulkSkipped {
  kind: "file" | "sop";
  id: string;
  reason: "not_allowed" | "not_found";
}

export interface BulkResult {
  files: number;
  sops: number;
  skipped: BulkSkipped[];
}

export type BulkCall = (body: { files: string[]; sops: string[] }) => Promise<BulkResult>;

const call: BulkCall = (body) => api<BulkResult>("/api/library/delete", "POST", body);

/** The calls a selection needs: files first, then SOPs, at most `max` items in each. */
export function bulkBatches(files: string[], sops: string[], max = BULK_MAX): { files: string[]; sops: string[] }[] {
  const items = [
    ...[...new Set(files)].map((id) => ["file", id] as const),
    ...[...new Set(sops)].map((id) => ["sop", id] as const),
  ];
  const out: { files: string[]; sops: string[] }[] = [];
  for (let i = 0; i < items.length; i += max) {
    const part = items.slice(i, i + max);
    out.push({
      files: part.filter(([k]) => k === "file").map(([, id]) => id),
      sops: part.filter(([k]) => k === "sop").map(([, id]) => id),
    });
  }
  return out;
}

/** Delete them all; one total. A failed call stops there (what went before stays deleted). */
export async function bulkDelete(sel: { files?: string[]; sops?: string[] }, send: BulkCall = call): Promise<BulkResult> {
  const total: BulkResult = { files: 0, sops: 0, skipped: [] };
  for (const batch of bulkBatches(sel.files ?? [], sel.sops ?? [])) {
    const r = await send(batch);
    total.files += r.files;
    total.sops += r.sops;
    total.skipped.push(...r.skipped);
  }
  return total;
}
