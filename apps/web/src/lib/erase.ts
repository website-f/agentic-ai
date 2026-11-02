/** P57: Settings > Data and privacy: export all data, erase this workspace (owner only). */
import { locale, msg } from "@/i18n";

export interface ExportOut {
  id: string;
  status: "queued" | "running" | "ready" | "downloaded" | "failed" | "expired";
  progress: number;
  step: string;
  size: number;
  sha256: string | null;
  counts: Record<string, number>;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  downloaded_at: string | null;
  download_url: string | null;
}

export interface ErasureOut {
  id: string;
  status: "requested" | "erasing" | "done" | "cancelled" | "failed";
  step: string;
  progress: number;
  workspace_name: string;
  requested_at: string;
  due_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  certificate_sha256: string | null;
  error: string | null;
  access_token?: string;
}

export interface DataOverview {
  workspace: { id: string; name: string };
  export: ExportOut | null;
  erasure: ErasureOut | null;
  summary: Record<string, number>;
  members: { total: number; only_here: number };
  providers: { kind: string; name: string; where: string }[];
  due_days: number;
  backup_days: number;
  needs_code: boolean;
}

export const dataKey = ["workspace-data"] as const;

/** Export steps, as the server names them. */
export const EXPORT_STEPS: Record<string, string> = {
  tables: msg("Records"),
  files: msg("Files"),
  vault: msg("Memory (brain)"),
  documents: msg("Documents"),
  crm: msg("CRM records"),
  index: msg("Index"),
  done: msg("Done"),
};

/** Erase steps, in order. */
export const ERASE_STEPS: { key: string; label: string }[] = [
  { key: "prepare", label: msg("Counting what there is") },
  { key: "revoke", label: msg("Signing everyone out and cutting every connection") },
  { key: "storage", label: msg("Deleting stored files") },
  { key: "vault", label: msg("Deleting the memory vault and its history") },
  { key: "cache", label: msg("Clearing caches") },
  { key: "database", label: msg("Deleting every record and checking none is left") },
  { key: "certificate", label: msg("Writing the certificate of deletion") },
];

/** The server's categories and service kinds, so they show in Malay too. */
export const CATEGORY_LABELS = [
  msg("Agents, tasks and conversations"),
  msg("Prompts, AI calls and logs"),
  msg("Files and documents"),
  msg("Memory (brain), embeddings and search indexes"),
  msg("CRM, contacts and money"),
  msg("Mail and calendar"),
  msg("Meeting recordings"),
  msg("People and access"),
  msg("Settings, integrations and everything else"),
  msg("AI provider"),
  msg("Messaging channel"),
  msg("Tool server (MCP)"),
  msg("CRM connector"),
  msg("Integration"),
];

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Where the erase's progress page lives: it needs no session (the erase ends it). */
export function erasedUrl(id: string, token: string): string {
  return `/erased?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
}
