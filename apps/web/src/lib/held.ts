/**
 * P125: changes by IT support that wait for an owner or a global admin (apps/api
 * agentic/org/held.py). The owner (23 Nov 2026): "whatever IT support does, an owner, the
 * developer or a global admin must approve it first; it shows on the Approvals page with what
 * they want approved, and only once approved does it take effect."
 *
 * The server holds them (lib/api.ts turns its 202 into a "Sent for approval" notice); here are
 * the lists, and approve (runs it with the approver's own sign-in), decline and cancel. Approve
 * and decline both need a reason; nobody decides their own.
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";

export type HeldStatus = "pending" | "applying" | "applied" | "declined" | "cancelled" | "expired";

export interface HeldChange {
  id: string;
  summary: string;
  method: string;
  path: string;
  details: { field: string; value: string }[];
  status: HeldStatus;
  requested_by: string;
  requested_by_name: string;
  requester_role_now: string | null;
  requester_role_label: string;
  requester_still_it_support: boolean;
  created_at: string;
  expires_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  attempts: number;
  apply_status: number | null;
  apply_message: string;
  can_decide: boolean;
  can_cancel: boolean;
}

export interface HeldList {
  to_decide: HeldChange[];
  decided: HeldChange[];
  mine: HeldChange[];
  is_approver: boolean;
}

export interface ApproveResult {
  change: HeldChange;
  applied: boolean;
  result: unknown;
}

export const heldKeys = { all: ["held-changes"] as const };

export const heldQuery = queryOptions({
  queryKey: heldKeys.all,
  queryFn: () => api<HeldList>("/api/held-changes"),
});

export const approveHeld = (id: string, reason: string) =>
  api<ApproveResult>(`/api/held-changes/${id}/approve`, "POST", { reason: reason.trim() });

export const declineHeld = (id: string, reason: string) =>
  api<HeldChange>(`/api/held-changes/${id}/decline`, "POST", { reason: reason.trim() });

export const cancelHeld = (id: string) => api<HeldChange>(`/api/held-changes/${id}/cancel`, "POST", {});

export const MIN_HELD_REASON = 3;
export const heldReasonOk = (s: string) => s.trim().length >= MIN_HELD_REASON;

/** A one-time password the run answered with (a new member, a reset): shown to the approver. */
export function oneTimePassword(result: unknown): string | null {
  if (result && typeof result === "object" && "temp_password" in result) {
    const v = (result as { temp_password?: unknown }).temp_password;
    return typeof v === "string" && v ? v : null;
  }
  return null;
}

export const HELD_STATUS: Record<HeldStatus, { label: string; tone: "warn" | "ok" | "danger" | "neutral" }> = {
  pending: { label: msg("Waiting"), tone: "warn" },
  applying: { label: msg("Applying"), tone: "warn" },
  applied: { label: msg("Approved"), tone: "ok" },
  declined: { label: msg("Declined"), tone: "danger" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
  expired: { label: msg("Expired"), tone: "neutral" },
};
