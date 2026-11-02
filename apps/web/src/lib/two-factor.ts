/** P57: two-step sign-in (an authenticator app's 6-digit codes, plus one-time recovery codes). */
import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

export type TwoFactorPolicy = "off" | "admins" | "everyone";

export interface TwoFactorStatus {
  enabled: boolean;
  enabled_at: string | null;
  pending: boolean;
  recovery_codes_left: number;
  required: boolean;
  policy: TwoFactorPolicy;
}

export interface MemberTwoFactor {
  user_id: string;
  enabled: boolean;
  enabled_at: string | null;
  required: boolean;
}

/** What /api/auth/login answers when the password was right and a code comes next. */
export interface TwoFactorChallenge {
  needs_2fa: true;
  challenge: string;
}

export const isChallenge = (r: Me | TwoFactorChallenge): r is TwoFactorChallenge =>
  (r as TwoFactorChallenge).needs_2fa === true;

export const twoFactorKeys = {
  status: ["two-factor", "status"] as const,
  policy: ["two-factor", "policy"] as const,
  members: ["two-factor", "members"] as const,
};

export const twoFactorQuery = queryOptions({
  queryKey: twoFactorKeys.status,
  queryFn: () => api<TwoFactorStatus>("/api/auth/2fa"),
});

export const twoFactorMembersQuery = queryOptions({
  queryKey: twoFactorKeys.members,
  queryFn: () => api<MemberTwoFactor[]>("/api/auth/2fa/members"),
});

export const startSetup = () => api<{ secret: string; uri: string }>("/api/auth/2fa/setup", "POST");
export const confirmSetup = (code: string) => api<{ recovery_codes: string[] }>("/api/auth/2fa/confirm", "POST", { code });
export const regenerateCodes = (code: string) => api<{ recovery_codes: string[] }>("/api/auth/2fa/recovery-codes", "POST", { code });
export const disableTwoFactor = (body: { password: string; code?: string; recovery_code?: string }) =>
  api<void>("/api/auth/2fa/disable", "POST", body);
export const setPolicy = (require_2fa: TwoFactorPolicy) => api<{ require_2fa: TwoFactorPolicy }>("/api/auth/2fa/policy", "PUT", { require_2fa });
export const resetMemberTwoFactor = (userId: string) => api<void>(`/api/auth/2fa/members/${encodeURIComponent(userId)}/reset`, "POST");

/** "JBSWY3DPEHPK3PXP..." -> "JBSW Y3DP EHPK ..." so it can be typed from the screen. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** Recovery codes as a text file, for "Download". */
export function codesFile(codes: string[], account: string, heading: string): Blob {
  return new Blob([`${heading}\n${account}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
}
