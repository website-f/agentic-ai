/** P25 provenance: who made a document or file (an agent, a person, an upload), the task and
 * workflow run it came from, and the review of what agents make (approve / send back / edit). */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";
import type { DocDetail, DocSummary } from "./documents";

export type DocOrigin = "person" | "agent";
export type FileOrigin = "uploaded" | "person" | "agent";
export type ReviewStatus = "draft" | "waiting" | "sent_back" | "approved";

/** Fields the API adds to documents (optional: older servers do not send them). */
export interface DocProvenance {
  origin?: DocOrigin;
  created_by_name?: string | null;
  agent_color?: string | null;
  task_title?: string | null;
  workflow_run_id?: string | null;
  workflow_run_title?: string | null;
  review_status?: ReviewStatus;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  revision_task_id?: string | null;
  /** Its saved copies in the company's files (the AI folder), one per format. */
  files?: { id: string; name: string; format: string; folder: string }[];
}

/** Fields the API adds to files. */
export interface FileProvenance {
  origin?: FileOrigin;
  agent_id?: string | null;
  agent_name?: string | null;
  agent_color?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  workflow_run_id?: string | null;
  workflow_run_title?: string | null;
  document_id?: string | null;
  report_id?: string | null;
  review_status?: ReviewStatus | null;
  source?: "upload" | "generated";
}

export type ReviewedDoc = DocSummary & DocProvenance;

/** Older servers have no `origin`: work with an agent on it was made by that agent. */
export function docOrigin(d: DocSummary & DocProvenance): DocOrigin {
  return d.origin ?? (d.agent_id ? "agent" : "person");
}

export function fileOrigin(f: FileProvenance): FileOrigin {
  if (f.origin) return f.origin;
  if (f.source === "upload") return "uploaded";
  return f.agent_id ? "agent" : "person";
}

export const REVIEW_LABEL: Record<ReviewStatus, { label: string; tone: "neutral" | "info" | "ok" | "warn" }> = {
  draft: { label: msg("Draft"), tone: "neutral" },
  waiting: { label: msg("Waiting for review"), tone: "info" },
  sent_back: { label: msg("Sent back"), tone: "warn" },
  approved: { label: msg("Approved"), tone: "ok" },
};

export const provKeys = {
  queue: ["documents", "review-queue"] as const,
  count: ["documents", "review-queue", "count"] as const,
};

export interface ReviewCount {
  waiting: number;
  made_week: number;
  files_week: number;
  sent_back: number;
}

export const reviewCountQuery = queryOptions({
  queryKey: provKeys.count,
  queryFn: () => api<ReviewCount>("/api/documents/review-queue/count"),
  staleTime: 30_000,
});

export const approveDocument = (id: string, note = "") => api<DocDetail & DocProvenance>(`/api/documents/${id}/approve`, "POST", { note });
export const sendBackDocument = (id: string, note: string) => api<DocDetail & DocProvenance>(`/api/documents/${id}/send-back`, "POST", { note });

/** Every saved copy of a document a person can open in Company files. */
export const filesLink = (fileId: string, folder?: string) => ({ to: "/files" as const, search: { f: fileId, ...(folder ? { folder } : {}) } });
