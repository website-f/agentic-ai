/**
 * P120: people's requests that someone above them approves, on the Approvals page (Fitri, 20 Nov
 * 2026: "all approval processes in the Approvals page, not just approvals for AI"). The first kind
 * is a SharePoint or OneDrive folder for the Library. The server decides who sees and decides
 * each one (apps/api agentic/org/requests.py): the person's managers up the line, the company's
 * managers for a folder, and owners, admins, management and HR. Never their own; always a reason.
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";

export type RequestStatus = "pending" | "approved" | "declined" | "cancelled";

export interface PersonRequest {
  id: string;
  kind: "library_link" | (string & {});
  title: string;
  note: string;
  status: RequestStatus;
  branch_id: string | null;
  branch_name: string | null;
  requested_by: string;
  requested_by_name: string;
  approver_name: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string;
  detail: { url?: string; web_url?: string; name?: string; is_folder?: boolean; provider?: string };
  result_id: string | null;
  can_decide: boolean;
  can_cancel: boolean;
}

export interface Requests {
  to_decide: PersonRequest[];
  decided: PersonRequest[];
  mine: PersonRequest[];
}

export const requestKeys = { all: ["requests"] as const };

export const requestsQuery = queryOptions({
  queryKey: requestKeys.all,
  queryFn: () => api<Requests>("/api/requests"),
});

export const decideRequest = (id: string, decision: "approve" | "decline", reason: string) =>
  api<PersonRequest>(`/api/requests/${id}/decide`, "POST", { decision, reason: reason.trim() });

export const cancelRequest = (id: string) => api<PersonRequest>(`/api/requests/${id}/cancel`, "POST", {});

export const askForFolder = (url: string, branchId: string | null, note: string) =>
  api<PersonRequest>("/api/library/linked/requests", "POST", { url: url.trim(), branch_id: branchId, note: note.trim() });

/** What a kind of request is, for its card (English keys: render with t()). */
export const KIND_LABEL: Record<string, string> = {
  library_link: msg("SharePoint or OneDrive folder for the Library"),
};

export const STATUS_LABEL: Record<RequestStatus, { label: string; tone: "warn" | "ok" | "danger" | "neutral" }> = {
  pending: { label: msg("Waiting"), tone: "warn" },
  approved: { label: msg("Approved"), tone: "ok" },
  declined: { label: msg("Declined"), tone: "danger" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
};

/** A decision needs a short reason (the server says the same). */
export const MIN_REASON = 3;
export const reasonOk = (text: string) => text.trim().length >= MIN_REASON;
