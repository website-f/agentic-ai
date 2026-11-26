import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { AuditPage, Branch, Me, Member, SystemStatus } from "./types";

export const keys = {
  me: ["me"] as const,
  setup: ["setup-status"] as const,
  status: ["system-status"] as const,
  branches: ["branches"] as const,
  members: ["members"] as const,
  audit: ["audit"] as const,
};

// P104: who am I, the companies and the saved preferences change rarely, and every change made
// here refreshes them at once; moving between pages no longer asks for them again each minute.
// A change made elsewhere (a role, a new company) shows within five minutes, or at once when the
// server answers that something is no longer allowed.
const STEADY = 5 * 60_000;

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => api<Me>("/api/auth/me"),
  staleTime: STEADY,
  retry: false,
});

export const setupStatusQuery = queryOptions({
  queryKey: keys.setup,
  queryFn: () => api<{ needs_setup: boolean }>("/api/auth/setup-status"),
  staleTime: 0,
  retry: false,
});

export const systemStatusQuery = queryOptions({
  queryKey: keys.status,
  queryFn: () => api<SystemStatus>("/api/system/status"),
  // P136: every open tab asked every 15 s (Prima-first: most tabs sit behind Prima); a minute is
  // enough for the approvals badge and the status card.
  refetchInterval: 60_000,
});

export const branchesQuery = queryOptions({
  queryKey: keys.branches,
  queryFn: () => api<Branch[]>("/api/branches"),
  staleTime: STEADY,
});

export const membersQuery = queryOptions({
  queryKey: keys.members,
  queryFn: () => api<Member[]>("/api/members"),
});

/** The activity log, newest first, 50 entries a page. `kind` filters on the server, so every
 * page holds only that kind; the first page also counts entries per kind. */
export const auditQuery = (kind?: string) =>
  infiniteQueryOptions({
    queryKey: [...keys.audit, kind ?? "all"],
    queryFn: ({ pageParam }) =>
      api<AuditPage>(`/api/audit?limit=50${kind ? `&kind=${kind}` : ""}${pageParam ? `&before_id=${pageParam}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_before_id ?? undefined,
    placeholderData: keepPreviousData,
  });
