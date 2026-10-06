/** Adding members from an Excel or CSV sheet (api/routers/member_import.py). */
import { msg, t } from "@/i18n";
import { ApiError, langHeader, readCookie } from "@/lib/api";
import type { Role } from "@/lib/types";

export const SHEET_ACCEPT = ".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
export const MAX_SHEET_MB = 5;

/** A note on a row: "match" from reading the sheet, "check" from the rules for adding. */
export interface ImportNote {
  field: string;
  level: "warn" | "error";
  source: "match" | "check";
  text: string;
}

/** What the import step takes back (the preview row, maybe fixed by hand). */
export interface ImportRow {
  row: number;
  name: string;
  email: string;
  role: Role;
  branch_id: string | null;
  department_id: string | null;
  phone: string;
  notes: string;
}

export interface PreviewRow extends ImportRow {
  branch_name: string | null;
  department_name: string | null;
  role_text: string;
  company_text: string;
  department_text: string;
  existing_account: boolean;
  status: "ok" | "warn" | "error";
  notes_found: ImportNote[];
}

export interface ImportPreview {
  file_name: string;
  sheet: string;
  header_row: number;
  mapped_by: "headers" | "ai";
  columns: { field: string; header: string; column: number; letter: string }[];
  rows: PreviewRow[];
  counts: { ok: number; warn: number; error: number };
  capped: boolean;
}

export interface ImportResult {
  row: number;
  name: string;
  email: string;
  status: "added" | "skipped";
  message: string | null;
  temp_password: string | null;
  user_id: string | null;
  role: Role;
  branch_name: string | null;
  department_name: string | null;
}

/** The sheet's columns as the preview names them (translate with t()). */
export const FIELD_LABEL: Record<string, string> = {
  name: msg("Name"),
  email: msg("Email"),
  role: msg("Role"),
  company: msg("Company"),
  department: msg("Department"),
  phone: msg("Phone"),
  notes: msg("Notes"),
};

async function failed(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Upload failed ({status}).", { status: res.status }));
}

/** Read a sheet on the server; nothing is saved. */
export async function previewSheet(file: File): Promise<ImportPreview> {
  if (file.size > MAX_SHEET_MB * 1024 * 1024) {
    throw new ApiError(413, "file_too_large", t("{name} is over {mb} MB.", { name: file.name, mb: MAX_SHEET_MB }));
  }
  let res: Response;
  try {
    res = await fetch(`/api/members/import/preview?${new URLSearchParams({ name: file.name })}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-csrf-token": readCookie("agentic_csrf"), "x-file-type": file.type || "", ...langHeader() },
      body: file,
    });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  if (!res.ok) throw await failed(res);
  return (await res.json()) as ImportPreview;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The template in the app's language (a plain link would not send it). */
export async function downloadTemplate(): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/members/import/template", { credentials: "same-origin", headers: langHeader() });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  if (!res.ok) throw await failed(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  save(await res.blob(), m ? decodeURIComponent(m[1]!) : "members-template.xlsx");
}

function csvCell(v: string): string {
  // Quote everything; a leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The new accounts' sign-in details, made here in the browser (never sent anywhere). */
export function downloadSignIns(results: ImportResult[], roleLabel: (r: Role) => string) {
  const head = [t("Name"), t("Email"), t("Temporary password"), t("Role"), t("Company"), t("Department"), t("Sign in at")];
  const lines = results
    .filter((r) => r.status === "added")
    .map((r) => [r.name, r.email, r.temp_password ?? t("Their own password"), roleLabel(r.role), r.branch_name ?? "", r.department_name ?? "", `${location.origin}/`]);
  const csv = [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
  save(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${t("sign-in-details")}.csv`);
}

/** After a hand fix: keep the sheet's notes on fields not touched, take the server's checks.
 * A company or department that could not be read is said once (not again as "needs a branch"). */
export function mergeChecks(row: PreviewRow, checked: PreviewRow, keep: ImportNote[]): PreviewRow {
  const unread = keep.some((n) => n.level === "error" && (n.field === "company" || n.field === "department"));
  const notes = [...keep, ...checked.notes_found.filter((n) => n.source === "check" && !(unread && n.field === "place"))];
  const status = notes.some((n) => n.level === "error") ? "error" : notes.length ? "warn" : "ok";
  return {
    ...row,
    branch_id: checked.branch_id,
    department_id: checked.department_id,
    branch_name: checked.branch_name,
    department_name: checked.department_name,
    existing_account: checked.existing_account,
    notes_found: notes,
    status,
  };
}

export function toImportRow(r: PreviewRow): ImportRow {
  return { row: r.row, name: r.name, email: r.email, role: r.role, branch_id: r.branch_id, department_id: r.department_id, phone: r.phone, notes: r.notes };
}
