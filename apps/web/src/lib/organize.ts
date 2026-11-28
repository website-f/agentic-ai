/** P149c: organizing the Library: keywords on files (asked for at upload, editable later,
 * filtered and searched) and uploads sorted into folders by what they are and their date.
 *
 *   GET  /api/files/keywords?branch_id&department_id&folder -> [{keyword, count}]
 *   POST /api/files/keywords {ids, add, remove} -> {updated}
 *   GET  /api/files?keyword=payroll&keyword=nov%202026 (every one of them)
 *   POST /api/library/organize/preview {branch_id, department_id, folder, keywords, names}
 *   GET|PUT /api/library/organize/rules?branch_id&department_id
 */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import { docKeys } from "./documents";
import { notThere } from "./intake";

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 40;

export interface KeywordCount {
  keyword: string;
  count: number;
}

export interface PreviewItem {
  name: string;
  /** Where it will go ("" = the top). */
  folder: string;
  /** Placed by the rules (false: it stays where it was uploaded). */
  sorted: boolean;
  category?: string | null;
  date?: string | null;
}

export interface OrganizePreview {
  /** The place's default for "Sort into folders automatically". */
  auto: boolean;
  keywords: string[];
  items: PreviewItem[];
}

/** "  Payroll ,  Nov 2026" -> ["payroll", "nov 2026"]: as the server keeps them. */
export function cleanKeywords(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((x) => x.split(/[,;\n]+/));
  const out: string[] = [];
  for (const p of parts) {
    const k = p.replace(/\s+/g, " ").trim().replace(/^#+/, "").trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH).trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out.slice(0, MAX_KEYWORDS);
}

export const organizeKeys = {
  keywords: (branchId: string | null, departmentId?: string | null) => [...docKeys.files, "keywords", branchId ?? "", departmentId ?? ""] as const,
};

/** The keywords in use in a company or unit, most used first (empty on an older server). */
export const keywordsQuery = (branchId: string | null, departmentId?: string | null) =>
  queryOptions({
    queryKey: organizeKeys.keywords(branchId, departmentId),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (branchId) q.set("branch_id", branchId);
      if (departmentId) q.set("department_id", departmentId);
      try {
        return await api<KeywordCount[]>(`/api/files/keywords?${q}`);
      } catch (e) {
        if (notThere(e)) return [];
        throw e;
      }
    },
    retry: (n, e) => !notThere(e) && n < 2,
    staleTime: 30_000,
  });

export const changeKeywords = (ids: string[], add: string[], remove: string[]) =>
  api<{ updated: number }>("/api/files/keywords", "POST", { ids, add, remove });

/** Where the files would be sorted (from their names and the keywords); null on an older server. */
export async function previewSort(p: { branchId: string; departmentId?: string | null; folder?: string; keywords: string[]; names: string[] }): Promise<OrganizePreview | null> {
  try {
    return await api<OrganizePreview>("/api/library/organize/preview", "POST", {
      branch_id: p.branchId,
      department_id: p.departmentId ?? null,
      folder: p.folder ?? "",
      keywords: p.keywords,
      names: p.names.slice(0, 1000),
    });
  } catch (e) {
    if (notThere(e)) return null;
    throw e;
  }
}

/** Proposed folders with how many files go to each, the most first ("" = stays at the top). */
export function folderGroups(items: PreviewItem[]): { folder: string; sorted: boolean; names: string[] }[] {
  const m = new Map<string, { folder: string; sorted: boolean; names: string[] }>();
  for (const i of items) {
    const key = `${i.sorted ? 1 : 0}:${i.folder}`;
    const g = m.get(key) ?? { folder: i.folder, sorted: i.sorted, names: [] };
    g.names.push(i.name);
    m.set(key, g);
  }
  return [...m.values()].sort((a, z) => Number(z.sorted) - Number(a.sorted) || z.names.length - a.names.length || a.folder.localeCompare(z.folder));
}
