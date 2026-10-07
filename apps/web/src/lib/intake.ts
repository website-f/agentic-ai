/** Company documents hub (P24): bulk intake (zips, folders, many files), the folder tree,
 * previews, archives and the moves, holds and releases on files.
 *
 * Contract (apps/api): POST /api/intake raw body -> IntakeBatch; GET /api/intake/{id} -> batch
 * + files; GET /api/files/tree; GET /api/files?folder=&recursive=&batch_id=&kind=&department_id=;
 * GET /api/files/{id}/preview; GET /api/files/archive; PATCH /api/files/{id}; POST
 * /api/files/move; POST /api/files/{id}/release | /quarantine.
 *
 * While the server does not have these yet, every read treats 404 as "nothing yet" and the
 * upload falls back to the plain POST /api/files (see uploadOne), so the page keeps working. */
import { queryOptions } from "@tanstack/react-query";

import { msg, t } from "@/i18n";

import { api, ApiError, langHeader, readCookie } from "./api";
import type { DocFile, FileSensitive } from "./documents";

// ---------------------------------------------------------------- types

export type IntakeStatus = "unpacking" | "reading" | "sorting" | "ready" | "failed";
export const INTAKE_ACTIVE: IntakeStatus[] = ["unpacking", "reading", "sorting"];

export type FlagReason = "credentials" | "personal_ids";

export interface FlaggedFile {
  file_id: string;
  name: string;
  reasons: FlagReason[];
  /** Plain words about what was found ("2 IC numbers"); never the secret itself. */
  detail: string;
}

export interface SkippedEntry {
  path: string;
  reason: string;
}

/** An AI suggestion from an upload. The builders engineer's IntakeSuggestions renders these. */
export interface Suggestion {
  id: string;
  what: "sop" | "workflow";
  title: string;
  file_ids: string[];
  department_id: string | null;
  reason: string;
  status: "new" | "built" | "dismissed";
  built_id: string | null;
}

export interface IntakeReport {
  by_kind?: Record<string, number>;
  /** Department id, or "" for files no department claimed. */
  by_department?: Record<string, number>;
  library?: number;
  flagged?: FlaggedFile[];
  skipped?: SkippedEntry[];
  suggestions?: Suggestion[];
}

export interface IntakeBatch {
  id: string;
  branch_id: string | null;
  name: string;
  status: IntakeStatus;
  total: number;
  done: number;
  report: IntakeReport | null;
  error: string | null;
  created_at: string;
  created_by: string;
}

export interface IntakeBatchDetail extends IntakeBatch {
  files: CompanyFile[];
}

export type Sensitive = FileSensitive;

/** A file as the documents hub sees it: DocFile plus the P18 library fields. */
export type CompanyFile = DocFile & {
  library?: boolean;
  department_id?: string | null;
};

export interface FolderInfo {
  /** "TENDER HQ/CARTA ALIR"; "" holds the files at the top level. */
  path: string;
  /** Files in this folder. Servers that send `direct` count everything under it here (and
   * list every parent); older ones count only the folder's own files. */
  files: number;
  /** Files sitting in this folder itself (servers that list parents and cumulative counts). */
  direct?: number;
  size: number;
  /** Files per kind directly in this folder. */
  kinds: Record<string, number>;
  /** Held-back files directly in this folder. */
  flagged: number;
}

export interface FileTree {
  folders: FolderInfo[];
  total_files: number;
  total_size: number;
}

// ---------------------------------------------------------------- kinds

/** The sorting kinds the intake uses, in chip order. The API stores the lowercase key. */
export const KINDS = [
  { key: "sop", label: "SOP" },
  { key: "guide", label: msg("Guide") },
  { key: "checklist", label: msg("Checklist") },
  { key: "flowchart", label: msg("Flowchart") },
  { key: "form", label: msg("Form") },
  { key: "template", label: msg("Template") },
  { key: "policy", label: msg("Policy") },
  { key: "contract", label: msg("Contract") },
  { key: "certificate", label: msg("Certificate") },
  { key: "letter", label: msg("Letter") },
  { key: "report", label: msg("Report") },
  { key: "financial", label: msg("Financial") },
  { key: "other", label: msg("Other") },
] as const;

export type KindKey = (typeof KINDS)[number]["key"];

const KIND_WORDS: [KindKey, RegExp][] = [
  ["sop", /\bsop\b|standard operating|operating procedure|prosedur operasi/],
  ["checklist", /check ?list|senarai semak/],
  ["flowchart", /flow ?chart|carta alir|process map|aliran proses/],
  ["guide", /\bguide|manual|handbook|panduan|instruction/],
  ["policy", /polic|polisi|\bdasar\b/],
  ["contract", /contract|agreement|perjanjian|kontrak|\bmou\b/],
  ["certificate", /certificat|\bsijil|licen[cs]e|lesen|permit|registration|pendaftaran|\bssm\b/],
  ["template", /templa/],
  ["form", /\bforms?\b|borang/],
  ["letter", /letter|\bsurat/],
  ["financial", /financ|statement|invoice|receipt|account|penyata|\bbank|quotation|sebut harga|budget|bajet|resit/],
  ["report", /report|laporan|minutes|\bminit/],
];

/** One of KINDS for any kind text: the intake's keys as they are, older free-text kinds
 * ("SSM certificate", "Bank statement") by their words. */
export function kindKey(kind: string | null | undefined): KindKey {
  const k = (kind ?? "").trim().toLowerCase();
  if (!k) return "other";
  const exact = KINDS.find((x) => x.key === k);
  if (exact) return exact.key;
  for (const [key, re] of KIND_WORDS) if (re.test(k)) return key;
  return "other";
}

/** The label to show for a file's kind: the sorting kind, or the older free text as read. */
export function kindLabel(kind: string | null | undefined): string {
  const k = (kind ?? "").trim();
  const exact = KINDS.find((x) => x.key === k.toLowerCase());
  if (exact) return exact.key === "sop" ? "SOP" : t(exact.label);
  return k || t("Other");
}

export const FLAG_REASON: Record<FlagReason, string> = {
  credentials: msg("Has passwords or login details"),
  personal_ids: msg("Has personal ID numbers, such as IC numbers"),
};

/** Plain words for why a file is held back (never the secret). */
export function flagWords(reasons: readonly string[] | undefined, sensitive?: Sensitive | null): string[] {
  const out = new Set<string>();
  for (const r of reasons ?? []) out.add(r in FLAG_REASON ? t(FLAG_REASON[r as FlagReason]) : r);
  if (sensitive?.credentials?.length) out.add(t(FLAG_REASON.credentials));
  if (sensitive?.personal_ids) out.add(t(FLAG_REASON.personal_ids));
  return [...out];
}

// ---------------------------------------------------------------- queries

export const intakeKeys = {
  all: ["intake"] as const,
  list: (branchId: string) => ["intake", "list", branchId] as const,
  batch: (id: string) => ["intake", "batch", id] as const,
};

/** Under ["files"], so every file change (and the live file.ready event) refreshes it. */
export const treeKey = (branchId: string) => ["files", "tree", branchId] as const;

/** Not built on this server yet: show nothing rather than an error, and do not retry. */
export const notThere = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);
const retry = (n: number, e: unknown) => !notThere(e) && n < 2;

const EMPTY_TREE: FileTree = { folders: [], total_files: 0, total_size: 0 };

export const fileTreeQuery = (branchId: string) =>
  queryOptions({
    queryKey: treeKey(branchId),
    queryFn: async () => {
      try {
        return await api<FileTree>(`/api/files/tree?${new URLSearchParams({ branch_id: branchId })}`);
      } catch (e) {
        if (notThere(e)) return EMPTY_TREE;
        throw e;
      }
    },
    retry,
  });

export const intakeBatchQuery = (id: string) =>
  queryOptions({
    queryKey: intakeKeys.batch(id),
    queryFn: () => api<IntakeBatchDetail>(`/api/intake/${id}`),
    retry,
    // Poll every 2 s while the server works through the upload (the live event
    // intake.updated refreshes it sooner).
    refetchInterval: (q) => (q.state.data && !INTAKE_ACTIVE.includes(q.state.data.status) ? false : q.state.error ? false : 2000),
  });

// ---------------------------------------------------------------- links

export const previewUrl = (id: string) => `/api/files/${id}/preview`;

export function archiveUrl(p: { branch_id?: string | null; folder?: string | null; batch_id?: string | null; ids?: string[] }): string {
  const q = new URLSearchParams();
  if (p.branch_id) q.set("branch_id", p.branch_id);
  if (p.folder) q.set("folder", p.folder);
  if (p.batch_id) q.set("batch_id", p.batch_id);
  if (p.ids?.length) q.set("ids", p.ids.join(","));
  return `/api/files/archive?${q}`;
}

// ---------------------------------------------------------------- what a file can show

const OFFICE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;
const TEXT = /\.(txt|md|csv|tsv|json|log)$/i;

export type PreviewKind = "pdf" | "office" | "image" | "text" | "none";

export function previewKind(f: Pick<DocFile, "mime" | "name">): PreviewKind {
  const m = f.mime.toLowerCase();
  if (m === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.includes("officedocument") || m.includes("msword") || m.includes("ms-excel") || m.includes("ms-powerpoint") || m.includes("opendocument") || OFFICE.test(f.name)) return "office";
  if (m.startsWith("text/") || TEXT.test(f.name)) return "text";
  return "none";
}

// ---------------------------------------------------------------- folders

export interface FolderNode {
  path: string;
  name: string;
  /** Files in this folder and every folder under it. */
  files: number;
  flagged: number;
  size: number;
  children: FolderNode[];
}

/** The flat folder list as a tree. Parents the server did not list (no files of their own)
 * are made up from the paths; counts include everything below. */
export function buildTree(folders: FolderInfo[]): FolderNode {
  const root: FolderNode = { path: "", name: "", files: 0, flagged: 0, size: 0, children: [] };
  const byPath = new Map<string, FolderNode>([["", root]]);
  const node = (path: string): FolderNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf("/");
    const parent = node(cut < 0 ? "" : path.slice(0, cut));
    const n: FolderNode = { path, name: cut < 0 ? path : path.slice(cut + 1), files: 0, flagged: 0, size: 0, children: [] };
    parent.children.push(n);
    byPath.set(path, n);
    return n;
  };
  // Newer servers send each folder's counts with everything under it already included, and
  // list every parent: take them as they are (adding them up again would double them).
  if (folders.some((f) => f.direct !== undefined)) {
    for (const f of folders) {
      const n = node(cleanFolder(f.path));
      n.files = f.files;
      n.flagged = f.flagged;
      n.size = f.size;
    }
    for (const c of root.children) {
      root.files += c.files;
      root.flagged += c.flagged;
      root.size += c.size;
    }
    sortTree(root);
    return root;
  }
  for (const f of folders) {
    const path = cleanFolder(f.path);
    node(path);
    // Count the folder's own files in it and in every parent up to the root.
    let p: string | null = path;
    while (p !== null) {
      const n = byPath.get(p)!;
      n.files += f.files;
      n.flagged += f.flagged;
      n.size += f.size;
      p = p === "" ? null : p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    }
  }
  sortTree(root);
  return root;
}

function sortTree(n: FolderNode) {
  n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  n.children.forEach(sortTree);
}

export function cleanFolder(path: string): string {
  return path.replace(/\\/g, "/").split("/").map((s) => s.trim()).filter(Boolean).join("/");
}

/** "A/B/C" -> ["A", "A/B", "A/B/C"], for breadcrumbs and opening the tree to a folder. */
export function folderChain(path: string): string[] {
  const parts = cleanFolder(path).split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function folderName(path: string): string {
  const p = cleanFolder(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------- picking files

export interface PickedFile {
  file: File;
  /** Path inside the dropped folder ("TENDER/CARTA ALIR/3.png"), else the file name. */
  path: string;
}

/** Files from a drop, walking into dropped folders (keeps each file's folder path). */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  if (!entries.length || entries.some((e) => !e)) {
    return Array.from(dt.files).map((file) => ({ file, path: file.name }));
  }
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries hands back a batch at a time (about 100 in Chrome); read until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e!, "");
  return out;
}

/** Files from the file input; a folder pick carries webkitRelativePath. */
export function filesFromInput(list: FileList): PickedFile[] {
  return Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Files nobody means to upload: OS clutter inside folders. */
export const isJunk = (p: PickedFile) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX\/.*|~\$[^/]*)$/i.test(p.path);

export const ACCEPT = ".zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.rtf,.odt,.ods,.odp,image/*,application/pdf";

// ---------------------------------------------------------------- upload

export interface IntakeParams {
  branch_id: string;
  name: string;
  department_id?: string | null;
  batch?: string | null;
  /** The folder the upload goes into ("" or absent: the top); a dropped folder keeps its own
   * folders under it. */
  folder?: string | null;
}

/** POST a raw body with upload progress (fetch cannot report it). */
function postRaw<T>(url: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-csrf-token", readCookie("agentic_csrf"));
    xhr.setRequestHeader("x-file-type", file.type || "");
    for (const [k, v] of Object.entries(langHeader())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: (T & { code?: string; message?: string }) | null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else if (xhr.status === 413 && !data?.message) reject(new ApiError(413, "file_too_large", t("{name} is larger than the server accepts.", { name: file.name })));
      else reject(new ApiError(xhr.status, data?.code ?? "http_error", data?.message ?? t("Upload failed ({status}).", { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, "network", t("The upload was cut off. Check the connection and try again.")));
    xhr.onabort = () => reject(new ApiError(0, "aborted", t("Upload cancelled.")));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/** One file of an intake upload. The first call (no `batch`) creates the batch. */
export function uploadIntake(file: File, p: IntakeParams, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<IntakeBatch> {
  const q = new URLSearchParams({ branch_id: p.branch_id, name: p.name });
  if (p.department_id) q.set("department_id", p.department_id);
  if (p.batch) q.set("batch", p.batch);
  if (p.folder) q.set("folder", cleanFolder(p.folder));
  return postRaw<IntakeBatch>(`/api/intake?${q}`, file, onProgress, signal);
}

/** The older single-file upload, used while the server has no /api/intake yet. */
export function uploadPlain(file: File, p: IntakeParams, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<DocFile> {
  const q = new URLSearchParams({ name: (p.name.split("/").pop() || file.name).slice(0, 200), branch_id: p.branch_id });
  return postRaw<DocFile>(`/api/files?${q}`, file, onProgress, signal);
}

// ---------------------------------------------------------------- changes

export interface FilePatch {
  folder?: string;
  kind?: string;
  department_id?: string | null;
  title?: string;
}

export const patchFile = (id: string, body: FilePatch) => api<CompanyFile>(`/api/files/${id}`, "PATCH", body);
export const moveFiles = (ids: string[], folder: string) => api<{ moved: number }>("/api/files/move", "POST", { ids, folder: cleanFolder(folder) });
export const releaseFile = (id: string, reason: string) => api<CompanyFile>(`/api/files/${id}/release`, "POST", { reason });
export const holdFile = (id: string, reason: string) => api<CompanyFile>(`/api/files/${id}/quarantine`, "POST", { reason });
export const deleteFile = (id: string) => api<void>(`/api/files/${id}`, "DELETE");
