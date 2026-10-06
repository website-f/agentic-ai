/** P27: company forms — claims, monthly records, requests — each with its blank to download,
 * a window to hand it in, the person's own round, and the manager's view of who handed in. */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";

export type FormKind = "claim" | "advance" | "payroll" | "request" | "report" | "record" | "checklist" | "other";

export const KINDS: { value: FormKind; label: string }[] = [
  { value: "claim", label: msg("Claim") },
  { value: "advance", label: msg("Advance") },
  { value: "payroll", label: msg("Salary record") },
  { value: "request", label: msg("Request") },
  { value: "report", label: msg("Report") },
  { value: "record", label: msg("Record") },
  { value: "checklist", label: msg("Checklist") },
  { value: "other", label: msg("Other") },
];

export interface Schedule {
  every?: "none" | "once" | "month" | "year";
  from_day?: number;
  to_day?: number;
  month?: number;
  due_on?: string;
}

/** Where a person stands on a form's current round. */
export type FormState =
  | "accepted"
  | "submitted"
  | "returned"
  | "draft"
  | "upcoming"
  | "open"
  | "due_soon"
  | "late"
  | "anytime";

export interface FormFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface Submission {
  id: string;
  period: string;
  status: "draft" | "submitted" | "returned" | "accepted";
  made_by: "person" | "agent";
  note: string;
  review_note: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  task_id: string | null;
  files: FormFile[];
}

export interface CompanyForm {
  id: string;
  name: string;
  description: string;
  kind: FormKind;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  schedule: Schedule;
  guide: string;
  status: "active" | "archived";
  template: FormFile | null;
  period: string;
  opens: string | null;
  due: string | null;
  state: FormState;
  mine: Submission | null;
  can_manage: boolean;
  /** This person is one of those who hand it in (owners and admins are not). */
  expected: boolean;
  /** For managers; "waiting" = handed in, not yet accepted or returned. */
  progress: { expected: number; submitted: number; accepted: number; waiting: number } | null;
}

export interface Starter {
  key: string;
  kind: FormKind;
  name: string;
  description: string;
  schedule: Schedule;
}

export interface Round {
  period: string | null;
  periods: string[];
  people: {
    user_id: string;
    name: string;
    state: "missing" | "late" | Submission["status"];
    submission: Submission | null;
  }[];
}

export const formKeys = {
  all: ["forms"] as const,
  list: (archived: boolean) => ["forms", "list", archived] as const,
  starters: ["forms", "starters"] as const,
  round: (id: string, period?: string) => ["forms", "round", id, period ?? ""] as const,
};

export const formsQuery = (archived = false) =>
  queryOptions({
    queryKey: formKeys.list(archived),
    queryFn: () => api<CompanyForm[]>(`/api/forms${archived ? "?archived=true" : ""}`),
    refetchInterval: 30_000,
  });

export const startersQuery = queryOptions({
  queryKey: formKeys.starters,
  queryFn: () => api<Starter[]>("/api/forms/starters"),
  staleTime: 5 * 60_000,
});

export const roundQuery = (id: string, period?: string) =>
  queryOptions({
    queryKey: formKeys.round(id, period),
    queryFn: () => api<Round>(`/api/forms/${id}/submissions${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  });

export interface FormBody {
  name: string;
  description?: string;
  kind: FormKind;
  branch_id?: string | null;
  department_id?: string | null;
  file_id?: string | null;
  schedule: Schedule;
  guide?: string;
}

export const addStarter = (key: string, branchId?: string | null, departmentId?: string | null) =>
  api<CompanyForm>("/api/forms/starters", "POST", { key, branch_id: branchId || null, department_id: departmentId || null });
export const addForm = (body: FormBody) => api<CompanyForm>("/api/forms", "POST", body);
export const changeForm = (id: string, body: Partial<FormBody> & { status?: "active" | "archived" }) => api<CompanyForm>(`/api/forms/${id}`, "PATCH", body);
export const archiveForm = (id: string) => api<void>(`/api/forms/${id}`, "DELETE");
export const submitForm = (id: string, body: { file_ids: string[]; note?: string; period?: string }) =>
  api<CompanyForm>(`/api/forms/${id}/submit`, "POST", body);
export const askForm = (id: string, body: { text: string; file_ids?: string[]; agent_id?: string | null }) =>
  api<{ task_id: string; agent: { id: string; name: string }; note: string | null }>(`/api/forms/${id}/ask`, "POST", body);
export const reviewSubmission = (id: string, decision: "accept" | "return", note = "") =>
  api<Submission>(`/api/form-submissions/${id}/review`, "POST", { decision, note });

export const blankUrl = (id: string) => `/api/forms/${id}/download`;

/** Still to do for this person, most urgent first (late, due soon, returned, AI draft, open). */
export const TODO: FormState[] = ["late", "due_soon", "returned", "draft", "open"];

export function needsMe(f: CompanyForm): boolean {
  return TODO.includes(f.state) && (f.expected || !!f.mine);
}

export function urgency(f: CompanyForm): number {
  const i = TODO.indexOf(f.state);
  return i < 0 ? TODO.length + (f.state === "upcoming" ? 0 : f.state === "anytime" ? 1 : 2) : i;
}
