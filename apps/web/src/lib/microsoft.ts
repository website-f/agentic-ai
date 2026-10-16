/**
 * Microsoft 365 / Outlook (P34): the company's Entra app (set up once on Channels), each
 * person's own Outlook (mail + calendar, connected from My AI or My assistants), shared
 * mailboxes that a company's agent works through, and the Mail page's activity feed.
 *
 * Typed calls and small pure helpers only (no React), so screens and tests share them. Until
 * the server ships P34 these endpoints answer 404: `isMissingApi` lets each screen show an
 * "update the server" notice instead of an error.
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api, ApiError } from "./api";

// ------------------------------------------------------------------------------------- types

export interface MicrosoftConfig {
  configured: boolean;
  /** The saved Application (client) ID, shortened, e.g. "1a2b…9f0e" (null when not set up). */
  client_id_hint: string | null;
  /** "organizations" (any work account, the default) or the company's tenant ID or domain. */
  tenant: string;
  /** Paste into the Entra app's Web redirect URIs. */
  redirect_uri: string;
  /** Where Microsoft Graph posts change notifications (must be public https). */
  notify_url: string;
  /** Tenant-wide admin consent link, once there is a client ID (null before). */
  adminconsent_url: string | null;
  /** The server has a public https address, so Graph can push new mail (else it polls). */
  webhooks_available: boolean;
  can_configure: boolean;
  /** Shared mailboxes (application permissions) are turned on for this server. */
  shared_enabled: boolean;
}

export interface MicrosoftConfigIn {
  client_id: string;
  /** Write-only: left out keeps the saved secret. */
  client_secret?: string;
  tenant: string;
}

export type WebhookMode = "live" | "polling" | "off";

export interface MicrosoftAccount {
  connected: boolean;
  email: string | null;
  display_name: string | null;
  /** "disconnected" comes with connected: false; "error" with last_error. */
  status: "connected" | "reconnect_needed" | "disconnected" | "error";
  mail_ok: boolean;
  calendar_ok: boolean;
  last_sync_at: string | null;
  webhooks: WebhookMode;
  /** What Microsoft last said, when something went wrong (already in the UI language). */
  last_error?: string | null;
}

export const TASK_CATEGORIES = ["invoice", "customer_request", "tender", "complaint", "internal"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export type MailCategory = TaskCategory | "newsletter" | "other";

export interface MailboxRules {
  create_tasks_for: TaskCategory[];
  save_attachments: boolean;
  digest: { enabled: boolean; time: string };
  /** Remind when a thread waits this long for a reply (0 = off). */
  follow_up_hours: number;
}

/** active = being read; paused = stopped by an admin; error = Microsoft refused (see last_error). */
export type MailboxStatus = "active" | "paused" | "error" | (string & {});

export interface SharedMailbox {
  id: string;
  address: string;
  display_name: string | null;
  branch_id: string;
  branch_name: string;
  agent_id: string | null;
  agent_name: string | null;
  rules: MailboxRules;
  status: MailboxStatus;
  last_sync_at: string | null;
  webhooks: WebhookMode;
  last_error?: string | null;
}

export interface MailboxIn {
  address: string;
  branch_id: string;
  agent_id?: string | null;
  rules?: MailboxRules;
  /** PATCH only: stop or resume reading the mailbox. */
  paused?: boolean;
}

export type MailActionKind = "task" | "attachment_saved" | "draft" | "follow_up" | "digest";

export interface MailAction {
  kind: MailActionKind;
  label: string;
  task_id?: string | null;
  file_id?: string | null;
  draft_id?: string | null;
}

/** "pending": waiting to be sorted (the hourly limit was reached, or no AI model answered). */
export type MailStatus = "new" | "pending" | "processed" | "ignored" | "failed";

export interface MailActivity {
  id: string;
  mailbox_label: string;
  received_at: string;
  from_name: string | null;
  from_address: string;
  subject: string;
  category: MailCategory | null;
  status: MailStatus;
  actions: MailAction[];
  task_id: string | null;
  has_attachments: boolean;
  /** The AI's one-line summary, when it sorted the mail. */
  summary?: string | null;
  needs_person?: boolean;
  due_at?: string | null;
  answered_at?: string | null;
  followed_up_at?: string | null;
}

/** "personal" is the person's own Outlook; anything else is a shared mailbox id. */
export type MailboxKey = "personal" | (string & {});

// ------------------------------------------------------------------------------------- API

export const MS_PATH = "/api/integrations/microsoft";

export const microsoftKeys = {
  all: ["microsoft"] as const,
  config: ["microsoft", "config"] as const,
  account: ["microsoft", "account"] as const,
  mailboxes: ["microsoft", "mailboxes"] as const,
};

export const mailKeys = {
  all: ["mail"] as const,
  activity: (mailbox: MailboxKey) => ["mail", "activity", mailbox] as const,
};

export const getMicrosoftConfig = () => api<MicrosoftConfig>(MS_PATH);

export const saveMicrosoftConfig = (body: MicrosoftConfigIn) => {
  const secret = body.client_secret?.trim();
  return api<MicrosoftConfig>(MS_PATH, "PUT", {
    client_id: body.client_id.trim(),
    tenant: body.tenant.trim() || "organizations",
    ...(secret ? { client_secret: secret } : {}),
  });
};

/** Starts Microsoft sign-in for the person's own Outlook; the page then goes to `url`. */
export const startMicrosoftConnect = () => api<{ url: string }>(`${MS_PATH}/connect`, "POST");

export const getMicrosoftAccount = () => api<MicrosoftAccount>(`${MS_PATH}/account`);

export const disconnectMicrosoft = () => api<void>(`${MS_PATH}/account`, "DELETE");

/** Tenant-wide admin consent (for shared mailboxes); comes back to /channels?ms_admin=ok|error. */
export const startAdminConsent = () => api<{ url: string }>(`${MS_PATH}/adminconsent/start`);

export async function listMailboxes(): Promise<SharedMailbox[]> {
  const r = await api<SharedMailbox[] | { items: SharedMailbox[] }>(`${MS_PATH}/mailboxes`);
  const list = Array.isArray(r) ? r : (r?.items ?? []);
  return list.map((m) => ({ ...m, rules: normalizeRules(m.rules) }));
}

export const addMailbox = (body: MailboxIn) => api<SharedMailbox>(`${MS_PATH}/mailboxes`, "POST", cleanMailbox(body));

export const updateMailbox = (id: string, body: Partial<MailboxIn>) =>
  api<SharedMailbox>(`${MS_PATH}/mailboxes/${encodeURIComponent(id)}`, "PATCH", cleanMailbox(body));

export const removeMailbox = (id: string) => api<void>(`${MS_PATH}/mailboxes/${encodeURIComponent(id)}`, "DELETE");

export const testMailbox = (id: string) => api<{ ok: boolean; message: string }>(`${MS_PATH}/mailboxes/${encodeURIComponent(id)}/test`, "POST");

export async function listMailActivity(mailbox: MailboxKey, limit = 50): Promise<MailActivity[]> {
  const q = new URLSearchParams({ mailbox, limit: String(limit) });
  const r = await api<MailActivity[] | { items: MailActivity[] }>(`/api/mail/activity?${q.toString()}`);
  const list = Array.isArray(r) ? r : (r?.items ?? []);
  return list.map((m) => ({ ...m, actions: m.actions ?? [] }));
}

/** Not on this server yet (P34 not deployed): show "update the server", not an error. */
export function isMissingApi(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** One quick retry for real failures; none for a 404 (the notice shows at once). */
const retryUnlessMissing = (count: number, err: unknown) => !isMissingApi(err) && !(err instanceof ApiError && err.status === 403) && count < 1;

export const microsoftConfigQuery = queryOptions({
  queryKey: microsoftKeys.config,
  queryFn: getMicrosoftConfig,
  retry: retryUnlessMissing,
  staleTime: 30_000,
});

export const microsoftAccountQuery = queryOptions({
  queryKey: microsoftKeys.account,
  queryFn: getMicrosoftAccount,
  retry: retryUnlessMissing,
  staleTime: 30_000,
});

/** P34: what a person's own AI does with their Outlook (same shape as a shared mailbox's rules;
 * by default it makes no tasks by itself, only flags and the daily report). */
export const microsoftPrefsQuery = queryOptions({
  queryKey: [...microsoftKeys.account, "prefs"] as const,
  queryFn: () => api<MailboxRules>("/api/integrations/microsoft/account/prefs"),
  retry: retryUnlessMissing,
});

export const saveMicrosoftPrefs = (prefs: MailboxRules) =>
  api<MailboxRules>("/api/integrations/microsoft/account/prefs", "PUT", prefs);

export const mailboxesQuery = queryOptions({
  queryKey: microsoftKeys.mailboxes,
  queryFn: listMailboxes,
  retry: retryUnlessMissing,
});

export const mailActivityQuery = (mailbox: MailboxKey) =>
  queryOptions({
    queryKey: mailKeys.activity(mailbox),
    queryFn: () => listMailActivity(mailbox),
    retry: retryUnlessMissing,
    // Live: `mail.new` refreshes it at once; this catches anything the stream missed.
    refetchInterval: 60_000,
  });

// ------------------------------------------------------------------------------------- rules

export const DEFAULT_RULES: MailboxRules = {
  create_tasks_for: ["invoice", "customer_request", "tender", "complaint"],
  save_attachments: true,
  digest: { enabled: true, time: "08:00" },
  follow_up_hours: 48,
};

/** Fills what an older or partial answer left out, and drops unknown categories. */
export function normalizeRules(r: Partial<MailboxRules> | null | undefined): MailboxRules {
  const given: unknown = r?.create_tasks_for;
  const cats = Array.isArray(given)
    ? given.filter((c): c is TaskCategory => (TASK_CATEGORIES as readonly unknown[]).includes(c))
    : DEFAULT_RULES.create_tasks_for;
  const time = r?.digest?.time && isClock(r.digest.time) ? r.digest.time : DEFAULT_RULES.digest.time;
  const hours = Number(r?.follow_up_hours);
  return {
    create_tasks_for: [...new Set(cats)],
    save_attachments: typeof r?.save_attachments === "boolean" ? r.save_attachments : DEFAULT_RULES.save_attachments,
    digest: { enabled: typeof r?.digest?.enabled === "boolean" ? r.digest.enabled : DEFAULT_RULES.digest.enabled, time },
    follow_up_hours: Number.isFinite(hours) && hours >= 0 ? Math.round(hours) : DEFAULT_RULES.follow_up_hours,
  };
}

function cleanMailbox<T extends Partial<MailboxIn>>(body: T): T {
  const out: Partial<MailboxIn> = { ...body };
  if (typeof out.address === "string") out.address = out.address.trim().toLowerCase();
  if (out.agent_id === "") out.agent_id = null;
  if (out.rules) out.rules = normalizeRules(out.rules);
  return out as T;
}

/** "08:30" style, 24-hour. */
export function isClock(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export const CATEGORY_LABEL: Record<MailCategory, string> = {
  invoice: msg("Invoices"),
  customer_request: msg("Customer requests"),
  tender: msg("Tenders"),
  complaint: msg("Complaints"),
  internal: msg("Internal"),
  newsletter: msg("Newsletters"),
  other: msg("Other"),
};

/** One mail's category, singular, for its chip. */
export const CATEGORY_CHIP: Record<MailCategory, string> = {
  invoice: msg("Invoice"),
  customer_request: msg("Customer request"),
  tender: msg("Tender"),
  complaint: msg("Complaint"),
  internal: msg("Internal|mail"),
  newsletter: msg("Newsletter"),
  other: msg("Other|mail"),
};

export const CATEGORY_TONE: Record<MailCategory, "accent" | "info" | "warn" | "danger" | "neutral" | "ok"> = {
  invoice: "accent",
  customer_request: "info",
  tender: "ok",
  complaint: "danger",
  internal: "neutral",
  newsletter: "neutral",
  other: "neutral",
};

export const STATUS_LABEL: Record<MailStatus, string> = {
  new: msg("New|mail"),
  pending: msg("Waiting to be sorted"),
  processed: msg("Handled"),
  ignored: msg("Ignored"),
  failed: msg("Failed"),
};

export const STATUS_TONE: Record<MailStatus, "info" | "ok" | "neutral" | "danger"> = {
  new: "info",
  pending: "info",
  processed: "ok",
  ignored: "neutral",
  failed: "danger",
};

type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** A mailbox's rules in a few words: "Tasks: invoices, tenders · Saves attachments · Digest 08:30 · Follow up after 24h". */
export function rulesSummary(rules: MailboxRules, t: Translate): string[] {
  const r = normalizeRules(rules);
  const parts: string[] = [];
  parts.push(r.create_tasks_for.length
    ? t("Tasks: {list}", { list: r.create_tasks_for.map((c) => t(CATEGORY_LABEL[c]).toLowerCase()).join(", ") })
    : t("No tasks"));
  if (r.save_attachments) parts.push(t("Saves attachments"));
  if (r.digest.enabled) parts.push(t("Digest {time}", { time: r.digest.time }));
  if (r.follow_up_hours > 0) parts.push(t("Follow up after {n}h", { n: r.follow_up_hours }));
  return parts;
}

// ------------------------------------------------------------------------------------- setup checks

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** The Application (client) ID is a GUID; the secret value or the secret ID are common mistakes. */
export function clientIdProblem(id: string): "empty" | "not_guid" | null {
  const v = id.trim();
  if (!v) return "empty";
  return GUID.test(v) ? null : "not_guid";
}

/** "organizations", "common", a tenant ID (GUID) or a verified domain (contoso.com, contoso.onmicrosoft.com). */
export function tenantProblem(tenant: string): "empty" | "bad" | "personal" | null {
  const v = tenant.trim().toLowerCase();
  if (!v) return "empty";
  if (v === "organizations" || v === "common") return null;
  if (v === "consumers") return "personal"; // personal Microsoft accounts have no shared mailboxes
  return GUID.test(v) || DOMAIN.test(v) ? null : "bad";
}

/** True for the multi-tenant default (any work or school account). */
export const isAnyTenant = (tenant: string) => ["organizations", "common", ""].includes(tenant.trim().toLowerCase());

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => EMAIL.test(v.trim());

// ------------------------------------------------------------------------------------- status

/** What the status line says about how fast new mail arrives. */
export const WEBHOOK_LABEL: Record<WebhookMode, string> = {
  live: msg("Live"),
  polling: msg("Checks every 3 minutes"),
  off: msg("Paused"),
};

export const WEBHOOK_TONE: Record<WebhookMode, "ok" | "info" | "neutral"> = { live: "ok", polling: "info", off: "neutral" };

/** The connected account needs the person to sign in again (expired or revoked consent). */
export const needsReconnect = (a: MicrosoftAccount | null | undefined) => !!a?.connected && a.status === "reconnect_needed";

/** Back from Microsoft sign-in: ?ms=connected|error&msg=… (or ?ms_admin=ok|error on Channels). */
export function readMsReturn(search: Record<string, unknown>, param: "ms" | "ms_admin" = "ms"): { ok: boolean; message: string | null } | null {
  const v = search[param];
  if (typeof v !== "string" || !v) return null;
  const m = search.msg;
  return { ok: v === "connected" || v === "ok", message: typeof m === "string" && m ? m.slice(0, 300) : null };
}

/** Where an action chip on the Mail page leads. Drafts open where the person approves them. */
export function actionLink(a: MailAction, canAssist: boolean):
  | { to: "/tasks"; search: { task: string } }
  | { to: "/files"; search: { f: string } }
  | { to: "/assistants"; search: { tab: "drafts" } }
  | { hash: "mail-drafts" }
  | null {
  if (a.task_id && (a.kind === "task" || a.kind === "follow_up")) return { to: "/tasks", search: { task: a.task_id } };
  if (a.file_id) return { to: "/files", search: { f: a.file_id } };
  if (a.kind === "draft") return canAssist ? { to: "/assistants", search: { tab: "drafts" } } : { hash: "mail-drafts" };
  if (a.task_id) return { to: "/tasks", search: { task: a.task_id } };
  return null;
}

/** Drafts and proposed events from before P34 have no provider: they are Google's. */
export const providerOf = (d: { provider?: "google" | "microsoft" | null }) => (d.provider === "microsoft" ? "microsoft" : "google");
