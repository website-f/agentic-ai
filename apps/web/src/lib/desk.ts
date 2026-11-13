/** P26: My workspace — each person's desk (GET /api/desk), their pins, asking their AI
 * worker from the desk, and uploading into their workspace. */
import { queryOptions } from "@tanstack/react-query";

import { t } from "@/i18n";

import { ApiError, api, langHeader, readCookie } from "./api";
import { MAX_UPLOAD_MB, type DocFile } from "./documents";
import type { ReviewStatus } from "./provenance";
import type { WorkHours } from "./staff";

/** P97: also any screen of the app or Prima (`route`, its address in this site), a web link
 * and a report. */
export type PinKind =
  | "sop" | "workflow" | "file" | "document" | "template" | "page" | "task" | "agent" | "search"
  | "route" | "link" | "report";

export interface Pin {
  id: string;
  kind: PinKind;
  ref: string;
  /** What the desk shows: the person's own name for it, else its name. */
  title: string;
  /** Its own name (or, when unavailable, the name it had when it was pinned). */
  name?: string;
  label?: string | null;
  folder?: string | null;
  sub: string;
  status: string | null;
  mime: string | null;
  url: string;
  /** Deleted, or no longer this person's to open: shown as unavailable, never what it is now. */
  missing: boolean;
}

/** P97: the blocks of the desk's overview, in the person's order, and their folders. */
export type DeskSectionId = "today" | "pinned" | "recent" | "ai" | "howto" | "goto";
export const DESK_SECTIONS: DeskSectionId[] = ["today", "pinned", "recent", "ai", "howto", "goto"];
export interface DeskLayout {
  sections: { id: DeskSectionId; hidden: boolean }[];
  folders: string[];
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
  work_hours?: WorkHours | null;
  department_id?: string | null;
}

/** An agent this person may hand workflows to, or one that follows a workflow. */
export interface DeskPerson {
  id: string;
  name: string;
  color: string;
  role: string;
  work_hours: WorkHours | null;
  mine: boolean;
  can_change?: boolean;
}

export interface DeskWorkflow {
  id: string;
  name: string;
  description: string;
  followed: boolean;
  steps: number;
  step_list: { title: string; type: string }[];
  followers: DeskPerson[];
  url: string;
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
  assignable: DeskPerson[];
  pins: Pin[];
  procedures: {
    sops: { id: string; title: string; scope: string; url: string }[];
    sop_total: number;
    workflows: DeskWorkflow[];
    workflow_total: number;
  };
  work: DeskWork[];
  waiting: {
    approvals: { id: string; kind: string; tool_name: string; tool_label?: string; reason: string; task_id: string; task_title: string; created_at: string }[];
    reviews: { id: string; title: string; url: string }[];
    documents: { id: string; title: string; url: string }[];
  };
  recent_searches: string[];
  /** P97 (older servers leave it out: the defaults apply). */
  layout?: DeskLayout;
  may_assist?: boolean;
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
  find: (q: string) => ["desk", "find", q] as const,
  meetings: ["desk", "meetings"] as const,
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

export const pinItem = (kind: PinKind, ref: string, title = "", folder?: string | null) =>
  api<Pin>("/api/desk/items", "POST", { kind, ref, title, ...(folder ? { folder } : {}) });
export const unpinItem = (id: string) => api<void>(`/api/desk/items/${id}`, "DELETE");
export const reorderPins = (ids: string[], folders?: Record<string, string | null>) =>
  api<void>("/api/desk/items/order", "PUT", folders ? { ids, folders } : { ids });
/** P97: the person's own name for a pin ("" clears it), or the folder it sits in (null: none). */
export const changePin = (id: string, body: { label?: string | null; folder?: string | null }) =>
  api<Pin>(`/api/desk/items/${id}`, "PATCH", body);
export const saveLayout = (body: { sections?: DeskLayout["sections"]; folders?: string[] }) =>
  api<DeskLayout>("/api/desk/layout", "PUT", body);
/** Rename a folder, or remove it with `to: null` (its pins stay, outside any folder). */
export const renameFolder = (name: string, to: string | null) =>
  api<DeskLayout>("/api/desk/folders/rename", "POST", { name, to });

/** The layout to show: the saved one, or every section in the first order. */
export function layoutOf(desk: Pick<Desk, "layout"> | undefined): DeskLayout {
  const saved = desk?.layout?.sections ?? [];
  const sections = saved.filter((s) => DESK_SECTIONS.includes(s.id));
  for (const id of DESK_SECTIONS) if (!sections.some((s) => s.id === id)) sections.push({ id, hidden: false });
  return { sections, folders: desk?.layout?.folders ?? [] };
}

export interface FoundItem {
  kind: "task" | "agent" | "person" | "report";
  id: string;
  title: string;
  sub: string;
  url: string;
}
export type Found = Record<"tasks" | "agents" | "people" | "reports", FoundItem[]>;

/** P97: tasks, agents, people and reports by name, only what the person may open. */
export const findQuery = (q: string, enabled = true) =>
  queryOptions({
    queryKey: deskKeys.find(q),
    queryFn: () => api<Found>(`/api/desk/find?${new URLSearchParams({ q })}`),
    enabled: enabled && q.length >= 2,
    staleTime: 15_000,
  });

export interface Meeting {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
  meet: string;
  link: string;
}

/** Today's meetings from the person's own Google Calendar (people with assistants). */
export const meetingsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: deskKeys.meetings,
    queryFn: () => api<{ connected: boolean; events: Meeting[]; problem?: boolean }>("/api/desk/meetings"),
    enabled,
    staleTime: 120_000,
  });

/** Where a pin opens, and how: Prima is its own app (a full page load), a web link opens in a
 * new tab, the rest are pages of this app. */
export function pinTarget(p: Pick<Pin, "kind" | "url">): { href: string; how: "app" | "page" | "tab" } {
  if (p.kind === "link") return { href: p.url, how: "tab" };
  if (p.url.startsWith("/prima/")) return { href: p.url, how: "page" };
  return { href: p.url, how: "app" };
}
export const followWorkflow = (workflowId: string, agentId: string, follow: boolean) =>
  api<{ workflow_id: string; agent_ids: string[] }>(`/api/desk/workflows/${workflowId}/follow`, "POST", { agent_id: agentId, follow });
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
