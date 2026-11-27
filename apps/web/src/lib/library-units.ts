/** P143b: the Library's units (the owner, 27 Nov 2026: "In the Library, instead of company, add
 * HR unit, Audit unit and Kewangan unit"). Each is a central department of the group employer
 * (PWVSB): Unit HR, Unit Audit, Unit Kewangan. Its folder space is that department's files,
 * with the same folders, uploads and actions as a company folder.
 *
 * Contract (apps/api library router): GET /api/library/units -> the units this person may open
 * (missing ones and ones they may not open are left out); GET /api/files/tree?branch_id=
 * &department_id= -> the unit's folders; the file list, archive and folder calls take the same
 * department_id. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import { notThere, type FileTree } from "./intake";

export type UnitKey = "hr" | "audit" | "finance";

export interface LibraryUnit {
  key: UnitKey;
  /** "Unit HR", "Unit Audit", "Unit Kewangan" (an English key; render with t()). */
  label: string;
  department_id: string;
  department_name: string;
  branch_id: string;
  branch_name: string;
  /** The unit's files this person sees. */
  files: number;
  /** May add files and folders into it. */
  can_upload: boolean;
}

export const unitKeys = {
  all: ["library", "units"] as const,
};

/** Under ["library"], so a Library change refreshes it; an older server: no units. */
export const libraryUnitsQuery = queryOptions({
  queryKey: unitKeys.all,
  queryFn: async () => {
    try {
      return (await api<{ units: LibraryUnit[] }>("/api/library/units")).units;
    } catch (e) {
      if (notThere(e)) return [];
      throw e;
    }
  },
  staleTime: 60_000,
});

/** Under ["files"], so every file change (and file.ready) refreshes it, like the company tree. */
export const unitTreeQuery = (unit: Pick<LibraryUnit, "branch_id" | "department_id"> | null) =>
  queryOptions({
    queryKey: ["files", "tree", unit?.branch_id ?? "", "unit", unit?.department_id ?? ""] as const,
    queryFn: () => api<FileTree>(`/api/files/tree?${new URLSearchParams({ branch_id: unit!.branch_id, department_id: unit!.department_id })}`),
    enabled: !!unit,
  });

/** A unit's ZIP: the archive link of its company, narrowed to its department. */
export function unitArchiveUrl(base: string, departmentId: string | null | undefined): string {
  if (!departmentId) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${new URLSearchParams({ department_id: departmentId })}`;
}
