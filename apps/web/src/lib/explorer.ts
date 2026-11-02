/** The Library's file explorer (P61): folders you create, rename, move and delete; files you
 * copy, cut, paste and label; previews of every kind of file; and the pure logic behind the
 * explorer (selection, the clipboard, sorting, label colours, the safe-HTML pass).
 *
 * Contract (apps/api):
 *   GET  /api/files/tree?branch_id=           -> {folders, total_files, total_size, root_files}
 *   GET  /api/files?folder=&q=&label=&...       -> files, each with `labels` and `origin`
 *   POST /api/files/move   {ids, folder}        -> {moved, folder}
 *   POST /api/files/copy   {ids, folder}        -> {copied, ids, skipped}
 *   POST /api/files/folders          {path, branch_id?}
 *   POST /api/files/folders/rename   {path, to, branch_id?} -> {moved}
 *   POST /api/files/folders/delete   {path, branch_id?}     (409 while it holds anything)
 *   PATCH /api/files/{id}  {name?, folder?, kind?, labels?}
 *   POST /api/files/labels {ids, add, remove};  GET /api/files/labels -> [{label, count}]
 *   GET  /api/files/{id}/view -> table | html | text | pdf | image | media | none
 *
 * Reads treat 404 as "not on this server yet" (see intake.notThere) so the explorer keeps
 * working against an older API. */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";
import { docKeys } from "./documents";
import { cleanFolder, notThere, type CompanyFile, type FileTree } from "./intake";
import type { FileProvenance } from "./provenance";

// ---------------------------------------------------------------- types

/** A file as the explorer shows it. */
export type ExplorerFile = CompanyFile & FileProvenance & {
  /** The person's own labels ("urgent", "Q3"), at most 12 of 1..30 characters. */
  labels?: string[];
  updated_at?: string | null;
};

export interface ExplorerTree extends FileTree {
  /** Files at the top level, in no folder. */
  root_files?: number;
}

export interface LabelCount {
  label: string;
  count: number;
}

export interface SheetData {
  name: string;
  rows: unknown[][];
  /** The number of columns, or their names. */
  columns: number | string[];
  /** Only the first rows were sent (the grid says so). */
  truncated: boolean;
}

export type FileViewData =
  | { type: "table"; sheets: SheetData[] }
  | { type: "html"; html: string }
  | { type: "text"; text: string }
  | { type: "pdf" }
  | { type: "image" }
  | { type: "media"; mime: string }
  | { type: "none" };

export const MAX_LABELS = 12;
export const MAX_LABEL_LENGTH = 30;

// ---------------------------------------------------------------- reads

export const explorerKeys = {
  labels: (branchId: string | null) => [...docKeys.files, "labels", branchId ?? ""] as const,
  view: (id: string) => [...docKeys.file(id), "view"] as const,
};

/** Every label in use, with how many files carry it (for autocomplete and the filter). */
export const labelsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: explorerKeys.labels(branchId),
    queryFn: async () => {
      try {
        const q = branchId ? `?${new URLSearchParams({ branch_id: branchId })}` : "";
        return await api<LabelCount[]>(`/api/files/labels${q}`);
      } catch (e) {
        if (notThere(e)) return [];
        throw e;
      }
    },
    retry: (n, e) => !notThere(e) && n < 2,
    staleTime: 30_000,
  });

/** What the preview shows. null: this server has no /view yet (the panel falls back). */
export const fileViewQuery = (id: string) =>
  queryOptions({
    queryKey: explorerKeys.view(id),
    queryFn: async (): Promise<FileViewData | null> => {
      try {
        return await api<FileViewData>(`/api/files/${id}/view`);
      } catch (e) {
        if (notThere(e)) return null;
        throw e;
      }
    },
    retry: (n, e) => !notThere(e) && n < 1,
    staleTime: 60_000,
  });

// ---------------------------------------------------------------- changes

export const copyFiles = (ids: string[], folder: string) =>
  api<{ copied: number; ids: string[]; skipped: number | string[] }>("/api/files/copy", "POST", { ids, folder: cleanFolder(folder) });

export const createFolder = (path: string, branchId: string | null) =>
  api<unknown>("/api/files/folders", "POST", { path: cleanFolder(path), ...(branchId ? { branch_id: branchId } : {}) });

export const renameFolder = (path: string, to: string, branchId: string | null) =>
  api<{ moved: number }>("/api/files/folders/rename", "POST", { path: cleanFolder(path), to: cleanFolder(to), ...(branchId ? { branch_id: branchId } : {}) });

export const deleteFolder = (path: string, branchId: string | null) =>
  api<unknown>("/api/files/folders/delete", "POST", { path: cleanFolder(path), ...(branchId ? { branch_id: branchId } : {}) });

export const renameFile = (id: string, name: string) => api<ExplorerFile>(`/api/files/${id}`, "PATCH", { name });

/** Add and take off labels on several files: one call, or one PATCH each on an older server. */
export async function changeLabels(files: Pick<ExplorerFile, "id" | "labels">[], add: string[], remove: string[]): Promise<void> {
  try {
    await api<unknown>("/api/files/labels", "POST", { ids: files.map((f) => f.id), add, remove });
  } catch (e) {
    if (!notThere(e)) throw e;
    for (const f of files) await api<unknown>(`/api/files/${f.id}`, "PATCH", { labels: applyLabels(f.labels ?? [], add, remove) });
  }
}

// ---------------------------------------------------------------- paths

export const joinPath = (parent: string, name: string) => cleanFolder(parent ? `${parent}/${name}` : name);

export function parentOf(path: string): string {
  const p = cleanFolder(path);
  const cut = p.lastIndexOf("/");
  return cut < 0 ? "" : p.slice(0, cut);
}

export function baseName(path: string): string {
  const p = cleanFolder(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

/** `path` is `folder` itself or somewhere under it. */
export function isWithin(path: string, folder: string): boolean {
  const p = cleanFolder(path);
  const f = cleanFolder(folder);
  if (!f) return true;
  return p === f || p.startsWith(`${f}/`);
}

/** Why a folder name will not do, or null. */
export function folderNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return msg("Give the folder a name.");
  if (/[/\\]/.test(n)) return msg("A folder name cannot hold / or \\.");
  if (n === "." || n === "..") return msg("Pick another name.");
  if (n.length > 100) return msg("Keep the name under 100 characters.");
  return null;
}

/** "Report.final.pdf" -> ["Report.final", ".pdf"]; no extension -> [name, ""]. */
export function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 8) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

// ---------------------------------------------------------------- labels

export function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

/** Labels after adding and taking some off (case-insensitive, first spelling kept, capped). */
export function applyLabels(current: string[], add: string[], remove: string[]): string[] {
  const off = new Set(remove.map((l) => cleanLabel(l).toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...current, ...add]) {
    const l = cleanLabel(raw);
    const k = l.toLowerCase();
    if (!l || off.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, MAX_LABELS);
}

/** Label chip colours: the chart series, so they read well in light and dark. Literal class
 * strings so Tailwind keeps them. */
export const LABEL_TONES = [
  "bg-[color-mix(in_oklab,var(--series-1)_13%,transparent)] text-[var(--series-1)] ring-[color-mix(in_oklab,var(--series-1)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-2)_13%,transparent)] text-[var(--series-2)] ring-[color-mix(in_oklab,var(--series-2)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-3)_13%,transparent)] text-[var(--series-3)] ring-[color-mix(in_oklab,var(--series-3)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-4)_15%,transparent)] text-[var(--series-4)] ring-[color-mix(in_oklab,var(--series-4)_26%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-5)_14%,transparent)] text-[var(--series-5)] ring-[color-mix(in_oklab,var(--series-5)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-6)_13%,transparent)] text-[var(--series-6)] ring-[color-mix(in_oklab,var(--series-6)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-7)_13%,transparent)] text-[var(--series-7)] ring-[color-mix(in_oklab,var(--series-7)_24%,transparent)]",
  "bg-[color-mix(in_oklab,var(--series-8)_13%,transparent)] text-[var(--series-8)] ring-[color-mix(in_oklab,var(--series-8)_24%,transparent)]",
] as const;

/** The same label always gets the same colour, whatever its case. */
export function labelTone(label: string): number {
  let h = 2166136261;
  for (const ch of cleanLabel(label).toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % LABEL_TONES.length;
}

// ---------------------------------------------------------------- file types

export type FileType = "pdf" | "word" | "sheet" | "slides" | "image" | "text" | "media" | "archive" | "other";

export const FILE_TYPES: { key: FileType; label: string }[] = [
  { key: "pdf", label: msg("PDF") },
  { key: "word", label: msg("Word") },
  { key: "sheet", label: msg("Spreadsheet") },
  { key: "slides", label: msg("Slides") },
  { key: "image", label: msg("Image") },
  { key: "text", label: msg("Text") },
  { key: "media", label: msg("Audio or video") },
  { key: "archive", label: msg("Zip") },
  { key: "other", label: msg("Other") },
];

export function fileType(f: { mime?: string | null; name?: string | null }): FileType {
  const m = (f.mime ?? "").toLowerCase();
  const n = (f.name ?? "").toLowerCase();
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || m.includes("msword") || m.includes("opendocument.text") || /\.(docx?|odt|rtf)$/.test(n)) return "word";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || m.includes("opendocument.spreadsheet") || m === "text/csv" || /\.(xlsx?|ods|csv|tsv)$/.test(n)) return "sheet";
  if (m.includes("presentationml") || m.includes("ms-powerpoint") || m.includes("opendocument.presentation") || /\.(pptx?|odp)$/.test(n)) return "slides";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/") || m.startsWith("video/")) return "media";
  if (m.includes("zip") || /\.(zip|rar|7z)$/.test(n)) return "archive";
  if (m.startsWith("text/") || m.includes("json") || /\.(txt|md|json|log|xml)$/.test(n)) return "text";
  return "other";
}

/** "A", "B", ... "Z", "AA": spreadsheet column letters. */
export function columnName(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------------------------------------------------------------- items and sorting

export type SortField = "name" | "date" | "size" | "type";
export type SortDir = "asc" | "desc";

/** One entry in the folder view: a folder or a file. Keys: "d:<path>" and "f:<id>". */
export type Item =
  | { key: string; kind: "folder"; path: string; name: string; files: number; size: number; flagged: number }
  | { key: string; kind: "file"; file: ExplorerFile; name: string };

export const folderItemKey = (path: string) => `d:${path}`;
export const fileItemKey = (id: string) => `f:${id}`;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Folders first (as every file manager does), each group in the chosen order. */
export function sortItems(items: Item[], field: SortField, dir: SortDir): Item[] {
  const sign = dir === "asc" ? 1 : -1;
  const time = (i: Item) => (i.kind === "file" ? Date.parse(i.file.updated_at ?? i.file.created_at) || 0 : 0);
  const size = (i: Item) => (i.kind === "file" ? i.file.size : i.size);
  const type = (i: Item) => (i.kind === "file" ? fileType(i.file) : "");
  const cmp = (a: Item, b: Item) => {
    let d = 0;
    if (field === "date") d = time(a) - time(b);
    else if (field === "size") d = size(a) - size(b);
    else if (field === "type") d = byName(type(a), type(b));
    return (d || byName(a.name, b.name)) * sign;
  };
  const folders = items.filter((i) => i.kind === "folder").sort((a, b) => (field === "date" || field === "type" ? byName(a.name, b.name) : cmp(a, b)));
  const files = items.filter((i) => i.kind === "file").sort(cmp);
  return [...folders, ...files];
}

// ---------------------------------------------------------------- selection

export interface Selection {
  keys: string[];
  /** Where a Shift+click range starts. */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { keys: [], anchor: null };

export type SelectionAction =
  /** A click: alone it picks one; Ctrl/Cmd adds or takes off; Shift picks the range. */
  | { type: "click"; key: string; order: string[]; ctrl?: boolean; shift?: boolean }
  /** A checkbox or a long-press: add or take off one. */
  | { type: "toggle"; key: string }
  /** Right-click on something not picked yet: that one only (a picked one keeps the rest). */
  | { type: "context"; key: string }
  | { type: "all"; order: string[] }
  | { type: "set"; keys: string[] }
  | { type: "clear" }
  /** Drop what is no longer shown (moved, deleted, another folder). */
  | { type: "prune"; order: string[] };

export function selectionReducer(s: Selection, a: SelectionAction): Selection {
  switch (a.type) {
    case "click": {
      const anchor = s.anchor && a.order.includes(s.anchor) ? s.anchor : null;
      if (a.shift && anchor) {
        const i = a.order.indexOf(anchor);
        const j = a.order.indexOf(a.key);
        if (j < 0) return s;
        const range = a.order.slice(Math.min(i, j), Math.max(i, j) + 1);
        return { keys: a.ctrl ? [...new Set([...s.keys, ...range])] : range, anchor };
      }
      if (a.ctrl) {
        const on = s.keys.includes(a.key);
        return { keys: on ? s.keys.filter((k) => k !== a.key) : [...s.keys, a.key], anchor: a.key };
      }
      return { keys: [a.key], anchor: a.key };
    }
    case "toggle": {
      const on = s.keys.includes(a.key);
      return { keys: on ? s.keys.filter((k) => k !== a.key) : [...s.keys, a.key], anchor: a.key };
    }
    case "context":
      return s.keys.includes(a.key) ? s : { keys: [a.key], anchor: a.key };
    case "all":
      return { keys: [...a.order], anchor: s.anchor ?? a.order[0] ?? null };
    case "set":
      return { keys: [...new Set(a.keys)], anchor: a.keys[a.keys.length - 1] ?? null };
    case "clear":
      return s.keys.length || s.anchor ? EMPTY_SELECTION : s;
    case "prune": {
      const shown = new Set(a.order);
      const keys = s.keys.filter((k) => shown.has(k));
      const anchor = s.anchor && shown.has(s.anchor) ? s.anchor : null;
      return keys.length === s.keys.length && anchor === s.anchor ? s : { keys, anchor };
    }
  }
}

// ---------------------------------------------------------------- the clipboard

export type ClipItem =
  | { kind: "file"; id: string; name: string; folder: string }
  | { kind: "folder"; path: string };

export interface Clipboard {
  mode: "copy" | "cut";
  branchId: string;
  items: ClipItem[];
}

export interface PastePlan {
  /** Files to copy or move into the folder. */
  files: string[];
  /** Folders, each with where it lands. */
  folders: { from: string; to: string }[];
  /** What cannot go there, and why. */
  skipped: { name: string; reason: "into_itself" | "same_place" }[];
}

/** What pasting the clipboard into `dest` does. Moving into the folder it is already in does
 * nothing; a folder never goes inside itself. */
export function planPaste(clip: Clipboard, dest: string): PastePlan {
  const to = cleanFolder(dest);
  const plan: PastePlan = { files: [], folders: [], skipped: [] };
  for (const it of clip.items) {
    if (it.kind === "file") {
      if (clip.mode === "cut" && cleanFolder(it.folder) === to) plan.skipped.push({ name: it.name, reason: "same_place" });
      else plan.files.push(it.id);
      continue;
    }
    const from = cleanFolder(it.path);
    const name = baseName(from);
    if (isWithin(to, from) && from) plan.skipped.push({ name, reason: "into_itself" });
    else if (clip.mode === "cut" && parentOf(from) === to) plan.skipped.push({ name, reason: "same_place" });
    else plan.folders.push({ from, to: joinPath(to, name) });
  }
  return plan;
}

// ---------------------------------------------------------------- safe HTML

/** The only tags a server-built preview may use; everything else goes, and no attribute stays. */
export const SAFE_TAGS = new Set(["h1", "h2", "h3", "h4", "p", "strong", "em", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "section", "hr"]);
/** Dropped with everything inside them (other unknown tags keep their text). */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "template", "noscript", "svg", "math", "link", "meta",
  "title", "head", "textarea", "select", "option", "button", "form", "input", "audio", "video", "canvas", "base", "applet",
]);

/** An allow-list pass over HTML: keeps SAFE_TAGS (without attributes) and text, unwraps other
 * tags, drops scripts and the like with their content, and drops comments. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const root = out.createElement("div");
  const copy = (from: Node, into: Node) => {
    for (const node of Array.from(from.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        into.appendChild(out.createTextNode(node.textContent ?? ""));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName.toLowerCase();
        if (DROP_WITH_CONTENT.has(tag)) continue;
        if (SAFE_TAGS.has(tag)) {
          const el = out.createElement(tag);
          into.appendChild(el);
          copy(node, el);
        } else {
          copy(node, into);
        }
      }
      // comments, processing instructions and the rest: dropped
    }
  };
  copy(doc.body, root);
  return root.innerHTML;
}
