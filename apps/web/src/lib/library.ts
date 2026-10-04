/** Knowledge library (P18): guidelines, manuals, policies and SOPs agents search and cite. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { DocFile } from "./documents";

export const libraryKeys = {
  all: ["library"] as const,
  search: (q: string) => ["library", "search", q] as const,
};

export type LibraryStatus = "reading" | "failed" | "indexed" | "empty" | "not_indexed";
export type LibraryScope = "workspace" | "branch" | "department";

export interface LibrarySource {
  kind: "file" | "sop";
  id: string;
  title: string;
  name: string;
  mime: string;
  pages: number;
  status: LibraryStatus;
  scope: LibraryScope;
  scope_label: string;
  sop_scope: string | null;
  branch_id: string | null;
  department_id: string | null;
  passages: number;
  indexed_at: string | null;
  updated_at: string;
}

export interface Library {
  sources: LibrarySource[];
  passages: number;
  can_reindex: boolean;
  can_edit: boolean;
}

export interface LibraryPassage {
  n: number;
  source_kind: "file" | "sop";
  source_id: string;
  title: string;
  heading: string;
  page: number | null;
  cite: string;
  text: string;
  score: number;
  similarity: number;
  strong: boolean;
  via: string[];
}

/** File payloads carry the library fields too (P18). */
export type LibraryFile = DocFile & {
  library?: boolean;
  department_id?: string | null;
  indexed_at?: string | null;
};

export const libraryQuery = queryOptions({
  queryKey: libraryKeys.all,
  queryFn: () => api<Library>("/api/library"),
  // Files are read and indexed in the background: poll while any is still on its way
  // (a file waiting to be indexed for over 10 minutes is left for "Index again").
  refetchInterval: (q) =>
    q.state.data?.sources.some(
      (s) =>
        s.status === "reading" ||
        (s.kind === "file" && s.status === "not_indexed" && Date.now() - new Date(s.updated_at).getTime() < 600_000),
    )
      ? 3000
      : false,
});

export const librarySearchQuery = (q: string) =>
  queryOptions({
    queryKey: libraryKeys.search(q),
    queryFn: () => api<LibraryPassage[]>(`/api/library/search?${new URLSearchParams({ q })}`),
    enabled: q.trim().length > 1,
    staleTime: 30_000,
  });

export interface LibraryScopeIn {
  branch_id: string | null;
  department_id: string | null;
}

export const setLibrary = (fileId: string, library: boolean, scope?: LibraryScopeIn) =>
  api<LibraryFile>(`/api/files/${fileId}/library`, "PATCH", { library, ...(scope ?? {}) });

export const reindexLibrary = () => api<{ state: "queued" | "done" }>("/api/library/reindex", "POST");
