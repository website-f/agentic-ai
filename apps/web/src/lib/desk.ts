/** P26: My workspace — each person's desk (GET /api/desk), their pins, asking their AI
 * worker from the desk, and uploading into their workspace. */
import { queryOptions } from "@tanstack/react-query";

import { t } from "@/i18n";

import { ApiError, api, langHeader, readCookie } from "./api";
import { MAX_UPLOAD_MB, type DocFile } from "./documents";
import type { ReviewStatus } from "./provenance";

export type PinKind = "sop" | "workflow" | "file" | "document" | "template" | "page" | "task" | "agent" | "search";

export interface Pin {
  id: string;
  kind: PinKind;
  ref: string;
  title: string;
  sub: string;
  status: string | null;
  mime: string | null;
  url: string;
  missing: boolean;
}

export interface DeskAgent {
  id: string;
  name: string;
  role: string;
  color: string;
  status: string;
  is_twin: boolean;
  private: boolean;
  current_task: { id: string; title: string } | null;
  open_tasks: number;
}

export interface DeskWork {
  id: string;
  title: string;
  status: string;
  source: string;
  agent_id: string | null;
  agent_name: string | null;
  from_me: boolean;
  result: string;
  note: string | null;
  updated_at: string;
  made: { kind: "document" | "file"; id: string; title: string; url: string }[];
  url: string;
}

export interface DeskFile {
  id: string;
  name: string;
  title: string;
  kind: string;
  mime: string;
  size: number;
  folder: string;
  origin: "uploaded" | "person" | "agent";
  status: string;
  quarantined: boolean;
  agent_name: string | null;
  document_id: string | null;
  task_id: string | null;
  created_at: string;
  url: string;
}

export interface DeskDocument {
  id: string;
  title: string;
  number: string;
  kind: string;
  origin: "person" | "agent";
  review_status: ReviewStatus;
  agent_name: string | null;
  updated_at: string;
  url: string;
}

export interface Desk {
  person: { name: string; role: string; company: string | null; department: string | null };
  can_ask: boolean;
  agents: DeskAgent[];
  pins: Pin[];
  procedures: {
    sops: { id: string; title: string; scope: string; url: string }[];
    sop_total: number;
    workflows: { id: string; name: string; description: string; followed: boolean; steps: number; url: string }[];
    workflow_total: number;
  };
  work: DeskWork[];
  waiting: {
    approvals: { id: string; kind: string; tool_name: string; reason: string; task_id: string; task_title: string; created_at: string }[];
    reviews: { id: string; title: string; url: string }[];
    documents: { id: string; title: string; url: string }[];
  };
  recent_searches: string[];
  files: DeskFile[];
  file_counts: { total: number; agent: number; uploaded: number };
  documents: DeskDocument[];
  document_total: number;
}

export interface AskOut {
  task_id: string;
  title: string;
  status: string;
  agent: { id: string; name: string };
  starts_at: string | null;
  note: string | null;
  url: string;
}

export const deskKeys = {
  all: ["desk"] as const,
  desk: ["desk", "home"] as const,
  pins: ["desk", "pins"] as const,
  targets: ["desk", "targets"] as const,
};

export const deskQuery = queryOptions({
  queryKey: deskKeys.desk,
  queryFn: () => api<Desk>("/api/desk"),
  refetchInterval: 20_000,
});

export const pinsQuery = queryOptions({
  queryKey: deskKeys.pins,
  queryFn: () => api<{ id: string; kind: PinKind; ref: string }[]>("/api/desk/items"),
  staleTime: 30_000,
});

export const askTargetsQuery = queryOptions({
  queryKey: deskKeys.targets,
  queryFn: () => api<DeskAgent[]>("/api/desk/ask-targets"),
  staleTime: 60_000,
});

export const pinItem = (kind: PinKind, ref: string, title = "") => api<Pin>("/api/desk/items", "POST", { kind, ref, title });
export const unpinItem = (id: string) => api<void>(`/api/desk/items/${id}`, "DELETE");
export const reorderPins = (ids: string[]) => api<void>("/api/desk/items/order", "PUT", { ids });
export const askDesk = (body: { text: string; agent_id?: string | null; make: "answer" | "document"; file_ids?: string[] }) =>
  api<AskOut>("/api/desk/ask", "POST", body);

/** Upload a file into the person's own workspace. */
export async function uploadToDesk(file: File, branchId?: string | null): Promise<DocFile> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ApiError(413, "file_too_large", t("{name} is over {mb} MB.", { name: file.name, mb: MAX_UPLOAD_MB }));
  }
  const q = new URLSearchParams({ name: file.name });
  if (branchId) q.set("branch_id", branchId);
  let res: Response;
  try {
    res = await fetch(`/api/desk/files?${q}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/octet-stream",
        "x-csrf-token": readCookie("agentic_csrf"),
        "x-file-type": file.type || "",
        ...langHeader(),
      },
      body: file,
    });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  const data = (await res.json().catch(() => null)) as (DocFile & { code?: string; message?: string }) | null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Upload failed ({status}).", { status: res.status }));
  return data as DocFile;
}

/** The task statuses grouped the way the desk shows them. */
export function workGroup(status: string): "open" | "waiting" | "done" {
  if (status === "review" || status === "blocked") return "waiting";
  if (status === "done" || status === "failed" || status === "cancelled") return "done";
  return "open";
}
