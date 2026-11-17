/** P109: files uploaded for other companies (api/routers/handoffs.py). */
import { t } from "@/i18n";

import { api, ApiError, langHeader, readCookie } from "./api";
import { MAX_UPLOAD_MB } from "./documents";

export interface Handoff {
  id: string;
  status: "pending" | "approved";
  file_id: string | null;
  file_name: string;
  title: string;
  typed_title: boolean;
  summary: string;
  reading: boolean;
  mime: string;
  size: number;
  company_id: string | null;
  company_name: string | null;
  task_id: string | null;
  task_title: string | null;
  uploader_id: string | null;
  uploader_name: string | null;
  created_at: string;
  approved_at: string | null;
  new: boolean;
}

export interface HandoffTargets { allowed: boolean; companies: { id: string; name: string }[] }

export const handoffKeys = {
  all: ["handoffs"] as const,
  targets: ["handoffs", "targets"] as const,
  mine: ["handoffs", "mine"] as const,
  incoming: ["handoffs", "incoming"] as const,
};

export const targetsQuery = { queryKey: handoffKeys.targets, queryFn: () => api<HandoffTargets>("/api/handoffs/targets") };
export const mineQuery = { queryKey: handoffKeys.mine, queryFn: () => api<{ pending: Handoff[]; approved: Handoff[] }>("/api/handoffs/mine") };
export const incomingQuery = { queryKey: handoffKeys.incoming, queryFn: () => api<Handoff[]>("/api/handoffs/incoming") };

export const handoffFileUrl = (id: string) => `/api/handoffs/${id}/file`;

/** One file for these companies (raw bytes). An empty title lets the AI describe it. */
export async function uploadFor(file: File, companies: string[], title: string, taskId: string | null): Promise<Handoff[]> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ApiError(413, "file_too_large", t("{name} is over {mb} MB.", { name: file.name, mb: MAX_UPLOAD_MB }));
  }
  const q = new URLSearchParams({ name: file.name, companies: companies.join(",") });
  if (title.trim()) q.set("title", title.trim());
  if (taskId) q.set("task_id", taskId);
  let res: Response;
  try {
    res = await fetch(`/api/handoffs?${q}`, {
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
  const data = (await res.json().catch(() => null)) as (Handoff[] & { code?: string; message?: string }) | null;
  if (!res.ok) {
    const err = data as { code?: string; message?: string } | null;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? t("Upload failed ({status}).", { status: res.status }));
  }
  return data as Handoff[];
}

export const editHandoff = (id: string, body: { title?: string; company_id?: string }) => api<Handoff>(`/api/handoffs/${id}`, "PATCH", body);
export const approveHandoff = (id: string) => api<Handoff>(`/api/handoffs/${id}/approve`, "POST", {});
export const takeBackHandoff = (id: string) => api<void>(`/api/handoffs/${id}`, "DELETE");
