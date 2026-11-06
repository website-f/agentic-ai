/**
 * P80: SharePoint and OneDrive folders in the Library. A manager pastes a folder's link; its
 * files stay in SharePoint and only their searchable text is kept, so agents search and cite
 * them with the rest of the Library. Typed calls and small pure helpers (no React).
 */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type LinkedStatus = "syncing" | "ready" | "needs_reconnect" | "error";
export type LinkedFileStatus = "indexed" | "empty" | "held" | "too_large" | "failed";

export interface LinkedSource {
  id: string;
  name: string;
  provider: "sharepoint" | "onedrive" | (string & {});
  is_folder: boolean;
  web_url: string;
  branch_id: string | null;
  scope_label: string;
  status: LinkedStatus;
  last_error: string | null;
  last_sync_at: string | null;
  files_indexed: number;
  files_held: number;
  files_failed: number;
  files_seen: number;
  passages: number;
  capped: boolean;
  connected_by_name: string;
  connected_by_me: boolean;
  can_manage: boolean;
}

export interface LinkedList {
  sources: LinkedSource[];
  can_connect: boolean;
  can_draft_sops: boolean;
  max_files: number;
}

export interface LinkPreview {
  name: string;
  is_folder: boolean;
  web_url: string;
  provider: string;
  files: number;
  skipped: number;
  capped: boolean;
  /** P80: counted for a few seconds only (a big folder); connecting reads all of it. */
  partial?: boolean;
  already: boolean;
}

export interface LinkedFile {
  id: string;
  name: string;
  path: string;
  web_url: string;
  status: LinkedFileStatus;
  passages: number;
  error: string | null;
  indexed_at: string | null;
}

export const linkedKeys = {
  all: ["library", "linked"] as const,
  files: (id: string) => ["library", "linked", id, "files"] as const,
};

const BASE = "/api/library/linked";

export const linkedQuery = queryOptions({
  queryKey: linkedKeys.all,
  queryFn: () => api<LinkedList>(BASE),
  // A folder is read on the worker: poll while one is still syncing.
  refetchInterval: (q) => (q.state.data?.sources.some((s) => s.status === "syncing") ? 4000 : false),
});

export const linkedFilesQuery = (id: string) =>
  queryOptions({ queryKey: linkedKeys.files(id), queryFn: () => api<LinkedFile[]>(`${BASE}/${id}/files`) });

export const previewLink = (url: string) => api<LinkPreview>(`${BASE}/resolve`, "POST", { url: url.trim() });
export const connectLink = (url: string, branchId: string | null) =>
  api<LinkedSource>(BASE, "POST", { url: url.trim(), branch_id: branchId });
export const syncLinked = (id: string) => api<LinkedSource>(`${BASE}/${id}/sync`, "POST");
export const disconnectLinked = (id: string) => api<void>(`${BASE}/${id}`, "DELETE");
export const draftSops = (id: string, fileIds?: string[]) =>
  api<{ jobs: string[]; count: number }>(`${BASE}/${id}/sops`, "POST", fileIds ? { file_ids: fileIds } : {});

const HOSTS = /^(?:[a-z0-9-]+\.)*sharepoint\.com$|^onedrive\.live\.com$|^1drv\.ms$/i;

/** The same first check as the server (which decides): an https SharePoint / OneDrive link. */
export function looksLikeLink(raw: string): boolean {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}
