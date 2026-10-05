/**
 * P24: the AI drafts SOPs and runnable workflows from a company's own documents.
 *
 * A build answers with the draft at once (201) when the documents fit one model call, or with
 * a running job (202) for long ones; `waitForJob` polls it until the draft is written.
 */
import { api } from "./api";
import type { SOP } from "./work";
import type { Workflow } from "./workflows";

export type BuildWhat = "sop" | "workflow";

export interface BuildJob {
  id: string;
  what: BuildWhat;
  status: "running" | "done" | "failed";
  /** Progress, in the reader's language ("Reading part 2 of 5"). */
  detail: string | null;
  built_id: string | null;
  error: string | null;
  batch_id: string | null;
  suggestion_id: string | null;
}

/** One SOP or workflow the AI suggests from an upload (batch.report.suggestions). */
export interface Suggestion {
  id: string;
  what: BuildWhat;
  title: string;
  file_ids: string[];
  department_id: string | null;
  reason: string;
  status: "new" | "built" | "dismissed";
  built_id: string | null;
  /** The document's own heading when the suggestion is one procedure of a longer document. */
  section?: string | null;
  /** Set while a long build of it is running. */
  job_id?: string | null;
}

export interface SuggestionResult {
  suggestion: Suggestion;
  job: BuildJob | null;
  sop: SOP | null;
  workflow: Workflow | null;
}

/** What a build gave back: the draft itself, or the job still writing it. */
export type BuildResult = { what: BuildWhat; id: string; job: null } | { what: BuildWhat; id: null; job: BuildJob };

function isJob(x: unknown): x is BuildJob {
  return !!x && typeof x === "object" && "what" in x && "built_id" in x && "detail" in x;
}

/** `focus`: write only this procedure of the documents (a handbook holds many). */
export async function buildSop(fileIds: string[], opts: { branchId?: string | null; departmentId?: string | null; focus?: string | null } = {}): Promise<BuildResult> {
  const r = await api<SOP | BuildJob>("/api/builders/sop", "POST", {
    file_ids: fileIds,
    branch_id: opts.branchId || null,
    department_id: opts.departmentId || null,
    focus: opts.focus?.trim() || null,
  });
  return isJob(r) ? { what: "sop", id: null, job: r } : { what: "sop", id: r.id, job: null };
}

export async function buildWorkflow(fileIds: string[], opts: { branchId?: string | null; focus?: string | null } = {}): Promise<BuildResult> {
  const r = await api<Workflow | BuildJob>("/api/builders/workflow", "POST", { file_ids: fileIds, branch_id: opts.branchId || null, focus: opts.focus?.trim() || null });
  return isJob(r) ? { what: "workflow", id: null, job: r } : { what: "workflow", id: r.id, job: null };
}

export const readJob = (id: string) => api<BuildJob>(`/api/builders/jobs/${id}`);

/** Poll a running build until it is done or failed. `onProgress` gets each reading. */
export async function waitForJob(id: string, onProgress?: (job: BuildJob) => void, every = 2500): Promise<BuildJob> {
  for (;;) {
    const job = await readJob(id);
    onProgress?.(job);
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, every));
  }
}

export const buildSuggestion = (batchId: string, sid: string) =>
  api<SuggestionResult>(`/api/intake/${batchId}/suggestions/${sid}/build`, "POST", {});

export const dismissSuggestion = (batchId: string, sid: string) =>
  api<{ suggestion: Suggestion }>(`/api/intake/${batchId}/suggestions/${sid}/dismiss`, "POST", {});

/** Where a built draft opens: the SOP page or the workflow editor. */
export function draftLink(what: BuildWhat, id: string): { to: "/sops"; search: { sop: string } } | { to: "/workflows"; search: { w: string } } {
  return what === "sop" ? { to: "/sops", search: { sop: id } } : { to: "/workflows", search: { w: id } };
}

/** Who may build what: SOPs need org.manage; workflows what workflows need. */
export function canBuild(permissions: string[], what: BuildWhat): boolean {
  return what === "sop" ? permissions.includes("org.manage") : permissions.includes("agents.manage") || permissions.includes("agents.own");
}
