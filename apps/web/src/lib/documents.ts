/** Document Studio (P10): files, company kits, templates, documents and submission packs. */
import { queryOptions } from "@tanstack/react-query";

import { msg, t } from "@/i18n";

import { api, ApiError, langHeader, readCookie } from "./api";

export const docKeys = {
  files: ["files"] as const,
  file: (id: string) => ["files", id] as const,
  kits: ["company-kits"] as const,
  kit: (id: string) => ["company-kits", id] as const,
  templates: ["doc-templates"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
  versions: (id: string) => ["documents", id, "versions"] as const,
  packs: ["packs"] as const,
  pack: (id: string) => ["packs", id] as const,
};

// ---------------------------------------------------------------- files

export interface DocFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: "reading" | "ready" | "failed";
  pages: number;
  ocr: boolean;
  kind: string;
  title: string;
  summary: string;
  fields: Record<string, string>;
  expires_on: string | null;
  expired: boolean;
  error: string | null;
  source: "upload" | "generated";
  branch_id: string | null;
  branch_name: string | null;
  task_id: string | null;
  agent_id: string | null;
  created_by: string;
  created_at: string;
  text?: string | null;
  text_length?: number | null;
  // P24 company documents (optional until every server has them).
  /** The folder it sits in, e.g. "TENDER HQ/CARTA ALIR"; "" at the top. */
  folder?: string;
  /** Its path inside the zip or folder it was uploaded in. */
  source_path?: string;
  batch_id?: string | null;
  /** What the scan found (kinds of secret only, never the values). */
  sensitive?: FileSensitive | null;
  /** Held back: kept, but agents never read it until a manager releases it. */
  quarantined?: boolean;
}

export interface FileSensitive {
  credentials?: string[];
  personal_ids?: number;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reason?: string | null;
}

export const MAX_UPLOAD_MB = 20;

export const filesQuery = (params: Record<string, string> = {}) =>
  queryOptions({
    queryKey: [...docKeys.files, params],
    queryFn: () => api<DocFile[]>(`/api/files?${new URLSearchParams(params)}`),
    // Uploads are read in the background; keep polling while any is still being read.
    refetchInterval: (q) => (q.state.data?.some((f) => f.status === "reading") ? 2500 : false),
  });

export interface FileStats { total: number; upload: number; generated: number; expiring: number; reading: number }

/** Counts behind the Files tiles and tabs, for the same company and search as the list. */
export const fileStatsQuery = (params: Record<string, string> = {}) =>
  queryOptions({
    queryKey: [...docKeys.files, "stats", params],
    queryFn: () => api<FileStats>(`/api/files/stats?${new URLSearchParams(params)}`),
    refetchInterval: (q) => (q.state.data?.reading ? 2500 : false),
  });

export const fileQuery = (id: string) =>
  queryOptions({
    queryKey: docKeys.file(id),
    queryFn: () => api<DocFile>(`/api/files/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "reading" ? 2500 : false),
  });

/** Upload one file as raw bytes (the API takes application/octet-stream on this path). */
export async function uploadFile(file: File, params: { branch_id?: string | null; task_id?: string | null } = {}): Promise<DocFile> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new ApiError(413, "file_too_large", t("{name} is over {mb} MB.", { name: file.name, mb: MAX_UPLOAD_MB }));
  }
  const q = new URLSearchParams({ name: file.name });
  if (params.branch_id) q.set("branch_id", params.branch_id);
  if (params.task_id) q.set("task_id", params.task_id);
  let res: Response;
  try {
    res = await fetch(`/api/files?${q}`, {
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

export const fileUrl = (id: string, inline = false) => `/api/files/${id}/download${inline ? "?inline=1" : ""}`;

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- company kits

export interface KitField {
  key: string;
  label: string;
  group: string;
  type?: "longtext" | "number";
}

export interface CustomKitField {
  key: string;
  label: string;
  value: string;
}

export interface CompanyKit {
  branch_id: string;
  branch_name: string;
  data: Record<string, string | number> & { custom?: CustomKitField[] };
  logo_file_id: string | null;
  fields: KitField[];
  filled: number;
  total: number;
  can_edit: boolean;
  updated_at: string | null;
}

export const kitsQuery = queryOptions({ queryKey: docKeys.kits, queryFn: () => api<CompanyKit[]>("/api/company-kits") });
export const kitQuery = (branchId: string) =>
  queryOptions({ queryKey: docKeys.kit(branchId), queryFn: () => api<CompanyKit>(`/api/company-kits/${branchId}`) });

// ---------------------------------------------------------------- templates

export type FieldType = "text" | "longtext" | "date" | "number" | "money" | "items" | "choice";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  hint?: string;
  options?: string[];
}

export interface DocTemplate {
  id: string;
  name: string;
  kind: string;
  description: string;
  body: string;
  fields: TemplateField[];
  prefix: string;
  builtin: boolean;
  branch_id: string | null;
  docx_file_id: string | null;
  docx_name: string | null;
  used: number;
}

export const templatesQuery = queryOptions({ queryKey: docKeys.templates, queryFn: () => api<DocTemplate[]>("/api/doc-templates") });

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: msg("Short text") },
  { value: "longtext", label: msg("Long text") },
  { value: "date", label: msg("Date") },
  { value: "number", label: msg("Number") },
  { value: "money", label: msg("Amount") },
  { value: "items", label: msg("Line items") },
  { value: "choice", label: msg("Choice") },
];

/** Placeholders anyone can drop into a template; company ones come from the kit. */
export const BUILTIN_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{company.legal_name}}", label: msg("Company name") },
  { token: "{{company.reg_no}}", label: msg("Registration no.") },
  { token: "{{company.address}}", label: msg("Address") },
  { token: "{{company.phone}}", label: msg("Phone") },
  { token: "{{company.email}}", label: msg("Email") },
  { token: "{{doc.number}}", label: msg("Document no.") },
  { token: "{{doc.date}}", label: msg("Date") },
  { token: "{{items}}", label: msg("Line items table") },
  { token: "{{total}}", label: msg("Total") },
  { token: "{{total_words}}", label: msg("Total in words") },
  { token: "{{signature}}", label: msg("Signature block") },
];

// ---------------------------------------------------------------- documents

export type DocStatus = "draft" | "review" | "approved";

export interface Check {
  level: "error" | "warn";
  text: string;
}

export interface DocSummary {
  id: string;
  title: string;
  kind: string;
  number: string;
  status: DocStatus;
  version: number;
  branch_id: string | null;
  branch_name: string | null;
  template_id: string | null;
  template_name: string | null;
  task_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  errors: number;
  warnings: number;
}

export interface LineItem {
  description: string;
  qty: number | string;
  unit?: string;
  unit_price: number | string;
}

export type FieldValue = string | number | LineItem[];

export interface DocDetail extends DocSummary {
  body: string;
  values: Record<string, FieldValue>;
  fields: TemplateField[];
  word_template: boolean;
  preview: string;
  checks: Check[];
  missing: string[];
  totals: { subtotal: number; tax: number; total: number } | null;
}

export interface DocVersion {
  version: number;
  title: string;
  note: string;
  author: string;
  created_at: string;
}

export const documentsQuery = (params: Record<string, string> = {}) =>
  queryOptions({
    queryKey: [...docKeys.documents, params],
    queryFn: () => api<DocSummary[]>(`/api/documents?${new URLSearchParams(params)}`),
  });
export interface DocStats { total: number; draft: number; review: number; approved: number; fix: number; fix_complete: boolean }

/** Counts behind the Documents tiles and tabs, for the same company and search as the list. */
export const docStatsQuery = (params: Record<string, string> = {}) =>
  queryOptions({
    queryKey: [...docKeys.documents, "stats", params],
    queryFn: () => api<DocStats>(`/api/documents/stats?${new URLSearchParams(params)}`),
  });
export const documentQuery = (id: string) =>
  queryOptions({ queryKey: docKeys.document(id), queryFn: () => api<DocDetail>(`/api/documents/${id}`) });
export const versionsQuery = (id: string) =>
  queryOptions({ queryKey: docKeys.versions(id), queryFn: () => api<DocVersion[]>(`/api/documents/${id}/versions`) });

export const exportUrl = (id: string, format: "pdf" | "docx" | "xlsx", inline = false) =>
  `/api/documents/${id}/export?format=${format}${inline ? "&inline=1" : ""}`;

export const STATUS_LABEL: Record<DocStatus, { label: string; tone: "neutral" | "info" | "ok" }> = {
  draft: { label: msg("Draft"), tone: "neutral" },
  review: { label: msg("In review"), tone: "info" },
  approved: { label: msg("Approved"), tone: "ok" },
};

// ---------------------------------------------------------------- packs

export interface PackItem {
  id: string;
  label: string;
  hint: string;
  required: boolean;
  status: "missing" | "ready" | "waived";
  note: string;
  auto: boolean;
  file_id: string | null;
  file_name: string | null;
  document_id: string | null;
  document_title: string | null;
  expired: boolean;
}

export interface Pack {
  id: string;
  title: string;
  description: string;
  status: "collecting" | "compiled";
  branch_id: string | null;
  branch_name: string | null;
  task_id: string | null;
  items: PackItem[];
  progress: { total: number; required: number; ready: number; missing: number };
  compiled_file_id: string | null;
  compiled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DraftItem {
  id?: string;
  label: string;
  hint?: string;
  required?: boolean;
  file_id?: string | null;
  document_id?: string | null;
  status?: string;
  note?: string;
  auto?: boolean;
}

export const packsQuery = queryOptions({ queryKey: docKeys.packs, queryFn: () => api<Pack[]>("/api/packs") });
export const packQuery = (id: string) => queryOptions({ queryKey: docKeys.pack(id), queryFn: () => api<Pack>(`/api/packs/${id}`) });

/** The pack's items in the shape the API takes back (keeps ids and attachments). */
export const itemsIn = (items: PackItem[]): DraftItem[] =>
  items.map((i) => ({
    id: i.id, label: i.label, hint: i.hint, required: i.required, file_id: i.file_id,
    document_id: i.document_id, status: i.status, note: i.note, auto: i.auto,
  }));
