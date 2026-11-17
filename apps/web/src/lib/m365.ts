/**
 * P109 the Microsoft 365 page: the person's own Outlook mail, Teams chats and channels,
 * calendar and Teams Approvals (GET/POST /api/m365/...), "Ask AI" (POST /api/m365/ai: answers
 * and drafts only, never sent), and their other email accounts with attachment backups
 * (/api/mail-accounts). Typed calls, query options and small pure helpers (no React).
 *
 * Every query key starts with "mail", so the live `mail.new` event refreshes them all.
 */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

// ------------------------------------------------------------------------------------- mail

export interface Address { name: string; address: string }

export interface MailRow {
  id: string;
  conversation_id: string | null;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  received_at: string | null;
  is_read: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  importance: "low" | "normal" | "high" | string;
  flagged: boolean;
  preview: string;
  web_link: string | null;
}

export interface MailAttachment { id: string; name: string; size: number; content_type: string; inline: boolean }

export interface MailFull extends MailRow {
  body_html: string;
  body_text: string;
  reply_to: Address[];
  attachments: MailAttachment[];
}

export type MailFolder = "inbox" | "sentitems" | "drafts" | "archive";
export const MAIL_FOLDERS: MailFolder[] = ["inbox", "sentitems", "drafts", "archive"];

export const m365Keys = {
  all: ["mail", "m365"] as const,
  mail: (folder: string, q: string, unread: boolean) => ["mail", "m365", "list", folder, q, unread] as const,
  message: (id: string) => ["mail", "m365", "message", id] as const,
  chats: ["mail", "m365", "chats"] as const,
  chat: (id: string) => ["mail", "m365", "chat", id] as const,
  posts: (team: string, channel: string) => ["mail", "m365", "posts", team, channel] as const,
  calendar: (start: string, end: string) => ["mail", "m365", "calendar", start, end] as const,
  event: (id: string) => ["mail", "m365", "event", id] as const,
  approvals: ["mail", "m365", "approvals"] as const,
  accounts: ["mail-accounts"] as const,
};

const enc = encodeURIComponent;

export interface MailPage { items: MailRow[]; next_skip: number | null }

export const mailListQuery = (folder: MailFolder, q: string, unread: boolean) =>
  queryOptions({
    queryKey: m365Keys.mail(folder, q, unread),
    queryFn: () => api<MailPage>(`/api/m365/mail?folder=${folder}&top=30${q ? `&q=${enc(q)}` : ""}${unread ? "&unread=true" : ""}`),
    retry: false,
    refetchInterval: 60_000,
  });

export const moreMail = (folder: MailFolder, skip: number, unread: boolean) =>
  api<MailPage>(`/api/m365/mail?folder=${folder}&top=30&skip=${skip}${unread ? "&unread=true" : ""}`);

export const mailQuery = (id: string) =>
  queryOptions({ queryKey: m365Keys.message(id), queryFn: () => api<MailFull>(`/api/m365/mail/${enc(id)}`), retry: false, staleTime: 5 * 60_000 });

export const markRead = (id: string, read = true) => api<{ read: boolean }>(`/api/m365/mail/${enc(id)}/read`, "POST", { read });

export const attachmentUrl = (messageId: string, attachmentId: string) => `/api/m365/mail/${enc(messageId)}/attachments/${enc(attachmentId)}`;

export const saveAttachment = (messageId: string, attachmentId: string) =>
  api<{ file_id: string; name: string; folder: string }>(`${attachmentUrl(messageId, attachmentId)}/save`, "POST");

export interface SendResult { sent: boolean; draft_id: string | null; web_link: string | null }

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export interface ComposeIn {
  mode: ComposeMode;
  messageId?: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  send: boolean;
}

export function sendMail(c: ComposeIn): Promise<SendResult> {
  if (c.mode === "reply" || c.mode === "reply_all") {
    return api<SendResult>(`/api/m365/mail/${enc(c.messageId ?? "")}/reply`, "POST", { body: c.body, reply_all: c.mode === "reply_all", send: c.send });
  }
  if (c.mode === "forward") {
    return api<SendResult>(`/api/m365/mail/${enc(c.messageId ?? "")}/forward`, "POST", { to: c.to, body: c.body, send: c.send });
  }
  return api<SendResult>("/api/m365/mail/send", "POST", { to: c.to, cc: c.cc, subject: c.subject, body: c.body, send: c.send });
}

/** "a@x.com, b@y.com; c@z.com" -> the addresses (trimmed, without empties). */
export function splitAddresses(v: string): string[] {
  return v.split(/[,;\s]+/).map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean);
}

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
export const allEmails = (list: string[]) => list.length > 0 && list.every((a) => EMAIL.test(a));

export function prefixed(prefix: "RE:" | "FW:", subject: string): string {
  const s = subject.trim();
  return /^(re|fw|fwd|balas|kmb)\s*:/i.test(s) && prefix === "RE:" ? s : `${prefix} ${s}`.trim();
}

/** The email body for the reading pane: the sender's HTML in a sandboxed frame, without scripts,
 * forms or (until asked) outside pictures, links opening in a new tab. */
export function mailDocument(html: string, text: string, { images, dark }: { images: boolean; dark: boolean }): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${images ? "https: http:" : ""}; font-src data:`;
  const body = html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${escapeHtml(text)}</pre>`;
  const colors = dark ? "color:#e6ece9;background:#141b18" : "color:#1a1f1d;background:#ffffff";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;padding:0;${colors};font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}body{padding:2px 2px 12px}img{max-width:100%;height:auto}table{max-width:100%}a{color:${dark ? "#35c48c" : "#0f7a52"}}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #8884}</style></head><body>${body}</body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------------------------------- Teams

export interface ChatMember { id: string; name: string }

export interface ChatRow {
  id: string;
  title: string;
  kind: "oneOnOne" | "group" | "meeting" | string;
  people: number;
  members: ChatMember[];
  last_at: string | null;
  last_from: string | null;
  last_mine: boolean;
  last_text: string;
  url: string | null;
}

export interface Reaction { emoji: string; count: number; mine: boolean }
export interface TeamsFile { id: string; name: string; kind: "file" | "card" | "other"; url: string | null }
export interface TeamsQuote { id: string; from: string; text: string }

export interface TeamsMsg {
  id: string;
  at: string | null;
  kind: "message" | "system";
  from: string;
  from_id: string;
  mine: boolean;
  /** Safe HTML from the server (an allow-list of tags; mentions as <span data-mention>). */
  html: string;
  text: string;
  subject: string | null;
  deleted: boolean;
  edited: boolean;
  importance: "high" | "urgent" | null;
  reactions: Reaction[];
  files: TeamsFile[];
  quotes: TeamsQuote[];
  mentions: { name: string; me: boolean }[];
  mentions_me: boolean;
  url: string | null;
}

export interface TeamsPostThread extends TeamsMsg { replies: TeamsMsg[] }

export interface ChatPage { messages: TeamsMsg[]; more: string | null; chat?: ChatRow }

export const chatsQuery = queryOptions({
  queryKey: m365Keys.chats,
  queryFn: () => api<ChatRow[]>("/api/m365/teams/chats"),
  retry: false,
  refetchInterval: 30_000,
});

export const chatQuery = (id: string) =>
  queryOptions({
    queryKey: m365Keys.chat(id),
    queryFn: () => api<ChatPage>(`/api/m365/teams/chats/${enc(id)}/messages`),
    retry: false,
    refetchInterval: 10_000,
  });

export const olderChat = (id: string, before: string) =>
  api<ChatPage>(`/api/m365/teams/chats/${enc(id)}/messages?before=${enc(before)}`);

export const sendChat = (id: string, text: string) => api<TeamsMsg>(`/api/m365/teams/chats/${enc(id)}/messages`, "POST", { text });

export const postsQuery = (team: string, channel: string) =>
  queryOptions({
    queryKey: m365Keys.posts(team, channel),
    queryFn: () => api<TeamsPostThread[]>(`/api/m365/teams/teams/${enc(team)}/channels/${enc(channel)}/posts`),
    retry: false,
    refetchInterval: 30_000,
  });

export const sendPost = (team: string, channel: string, body: { text: string; reply_to?: string; subject?: string }) =>
  api<TeamsMsg>(`/api/m365/teams/teams/${enc(team)}/channels/${enc(channel)}/posts`, "POST", body);

/** Messages grouped by day (oldest first), and runs of one sender kept together like Teams. */
export interface DayGroup<T> { day: string; items: { msg: T; first: boolean }[] }

export function byDay<T extends { at: string | null; from_id: string; kind: string }>(msgs: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  let prev: T | null = null;
  for (const m of msgs) {
    const local = m.at ? new Date(m.at).toDateString() : "";
    let g = out[out.length - 1];
    if (!g || g.day !== local) {
      g = { day: local, items: [] };
      out.push(g);
      prev = null;
    }
    const gap = prev?.at && m.at ? new Date(m.at).getTime() - new Date(prev.at).getTime() : Infinity;
    const first = !prev || prev.from_id !== m.from_id || prev.kind !== m.kind || m.kind === "system" || gap > 5 * 60_000;
    g.items.push({ msg: m, first });
    prev = m;
  }
  return out;
}

// ------------------------------------------------------------------------------------- calendar

export interface Attendee extends Address { type: string; response: string }

export interface CalEvent {
  id: string;
  subject: string;
  start: string | null;
  end: string | null;
  all_day: boolean;
  cancelled: boolean;
  location: string;
  organizer: Address;
  attendees: Attendee[];
  show_as: string;
  join_url: string | null;
  web_link: string | null;
  preview: string;
}

export interface CalEventFull extends CalEvent { is_organizer: boolean; my_response: string; body_html: string }

export const calendarQuery = (start: string, end: string) =>
  queryOptions({
    queryKey: m365Keys.calendar(start, end),
    queryFn: () => api<CalEvent[]>(`/api/m365/calendar?start=${enc(start)}&end=${enc(end)}`),
    retry: false,
    refetchInterval: 5 * 60_000,
  });

export const eventQuery = (id: string) =>
  queryOptions({ queryKey: m365Keys.event(id), queryFn: () => api<CalEventFull>(`/api/m365/calendar/${enc(id)}`), retry: false });

export interface EventIn { subject: string; start: string; end: string; attendees: string[]; location: string; body: string; online: boolean }

export const createEvent = (e: EventIn) => api<{ id: string; web_link: string | null }>("/api/m365/calendar", "POST", e);

export const respondEvent = (id: string, answer: "accept" | "tentative" | "decline", comment = "") =>
  api<{ answer: string }>(`/api/m365/calendar/${enc(id)}/respond`, "POST", { answer, comment });

/** Monday 00:00 (local) of the week holding `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDaysTo(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** A datetime-local input's value (local time) for an ISO time, and back. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): string => (v ? new Date(v).toISOString() : "");

// ------------------------------------------------------------------------------------- approvals

export interface TeamsApproval {
  id: string;
  title: string;
  description: string;
  state: "pending" | "completed" | "canceled" | "created" | string;
  result: string | null;
  owner: string;
  created_at: string | null;
  completed_at: string | null;
  kind: string;
  options: string[];
  i_approve: boolean;
  i_own: boolean;
}

export const approvalsQuery = queryOptions({
  queryKey: m365Keys.approvals,
  queryFn: () => api<TeamsApproval[]>("/api/m365/approvals"),
  retry: false,
  refetchInterval: 60_000,
});

export const respondApproval = (id: string, response: string, comment: string) =>
  api<{ response: string }>(`/api/m365/approvals/${enc(id)}/respond`, "POST", { response, comment });

// ------------------------------------------------------------------------------------- Ask AI

export type AiAction =
  | "mail_summary" | "mail_reply" | "mail_tasks" | "mail_new"
  | "chat_about" | "chat_reply" | "channel_about" | "channel_reply"
  | "meeting_prep" | "event_draft";

export interface AiIn {
  action: AiAction;
  message_id?: string;
  chat_id?: string;
  team_id?: string;
  channel_id?: string;
  post_id?: string;
  event_id?: string;
  tone?: Tone | "";
  instructions?: string;
  to?: string;
  lang?: "en" | "ms" | "";
}

export interface AiOut {
  action: AiAction;
  text?: string;
  body?: string;
  subject?: string;
  tasks?: { title: string; due: string | null }[];
  event?: { subject: string; start: string | null; end: string | null; attendees: string[]; location: string; online: boolean; body: string };
}

export const askAi = (body: AiIn) => api<AiOut>("/api/m365/ai", "POST", body);

export type Tone = "friendly" | "formal" | "short" | "firm" | "apologetic";
export const TONES: Tone[] = ["friendly", "formal", "short", "firm", "apologetic"];

// ------------------------------------------------------------------------------------- other email accounts

export type Provider = "gmail" | "yahoo" | "outlook" | "cpanel" | "other";
export const PROVIDERS: Provider[] = ["gmail", "yahoo", "outlook", "cpanel", "other"];

export interface BackupJob {
  id: string;
  account_id: string | null;
  source: "imap" | "gmail";
  label: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  messages_seen: number;
  messages_total: number;
  saved: number;
  duplicates: number;
  too_large: number;
  inline_skipped: number;
  bytes_saved: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
  stale: boolean;
}

export interface MailAccount {
  id: string;
  email: string;
  provider: Provider;
  host: string;
  port: number;
  security: "ssl" | "starttls";
  username: string;
  password_set: boolean;
  status: "untested" | "ok" | "error";
  last_error: string | null;
  last_checked_at: string | null;
  backup_done_at: string | null;
  created_at: string;
  backup: BackupJob | null;
}

export interface MailAccounts {
  accounts: MailAccount[];
  google: { configured: boolean; can_connect: boolean; account: { email: string; status: string } | null; backup: BackupJob | null };
  presets: Record<Provider, { host: string; port: number; security: "ssl" | "starttls" }>;
}

export const mailAccountsQuery = queryOptions({
  queryKey: m365Keys.accounts,
  queryFn: () => api<MailAccounts>("/api/mail-accounts"),
  retry: false,
});

export interface MailAccountIn {
  email: string;
  provider: Provider;
  host: string;
  port: number;
  security: "ssl" | "starttls";
  username: string;
  password: string;
}

export const addMailAccount = (a: MailAccountIn) => api<MailAccount>("/api/mail-accounts", "POST", a);
export const changeMailAccount = (id: string, a: Partial<MailAccountIn>) => api<MailAccount>(`/api/mail-accounts/${enc(id)}`, "PATCH", a);
export const testMailAccount = (id: string) => api<MailAccount>(`/api/mail-accounts/${enc(id)}/test`, "POST");
export const removeMailAccount = (id: string) => api<void>(`/api/mail-accounts/${enc(id)}`, "DELETE");
export const startBackup = (id: string) => api<BackupJob>(`/api/mail-accounts/${enc(id)}/backup`, "POST");
export const startGmailBackup = () => api<BackupJob>("/api/mail-accounts/gmail/backup", "POST");
export const resumeBackup = (id: string) => api<BackupJob>(`/api/mail-accounts/backups/${enc(id)}/resume`, "POST");
export const cancelBackup = (id: string) => api<BackupJob>(`/api/mail-accounts/backups/${enc(id)}/cancel`, "POST");
export const askAccounts = (text: string) => api<{ answer: string; job: BackupJob | null }>("/api/mail-accounts/ask", "POST", { text });

export const backupActive = (j: BackupJob | null | undefined) => !!j && (j.status === "queued" || j.status === "running") && !j.stale;

/** 0-100 for the progress bar (unknown total: null). */
export function backupPercent(j: BackupJob): number | null {
  if (j.status === "done") return 100;
  if (!j.messages_total) return null;
  return Math.min(99, Math.round((j.messages_seen / j.messages_total) * 100));
}
