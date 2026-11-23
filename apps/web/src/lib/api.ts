/** Thin fetch wrapper: same-origin cookies, JSON in and out, CSRF echo, typed errors. */
import { toast } from "sonner";

import { t, useLang } from "@/i18n";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function readCookie(name: string): string {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** The UI language, sent on every request so the server answers (errors, notices) in it. */
export function langHeader(): Record<string, string> {
  return { "x-lang": useLang.getState().lang };
}

/** P118: the Microsoft account the Microsoft 365 page shows (one of the person's own; null: their
 * main one). Sent with every /api/m365 call as X-M365-Account. */
let m365Account: string | null = null;
export function setM365Account(id: string | null): void {
  m365Account = id;
}
export function m365AccountId(): string | null {
  return m365Account;
}

export async function api<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: langHeader() };
  if (method !== "GET") {
    // The API only accepts JSON for state-changing calls, and checks the CSRF echo.
    init.headers = writeHeaders();
    init.body = JSON.stringify(body ?? {});
  }
  if (m365Account && path.startsWith("/api/m365/")) {
    init.headers = { ...(init.headers as Record<string, string>), "x-m365-account": m365Account };
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | (T & { code?: string; message?: string; fields?: Record<string, string>; held?: boolean; summary?: string; request_id?: string })
    | null;
  if (res.status === 202 && data?.held === true) throw heldForApproval(data.summary ?? "", data.request_id ?? "");
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.code ?? "http_error",
      data?.message ?? t("Request failed ({status}).", { status: res.status }),
      data?.fields ?? {},
    );
  }
  return data as T;
}

/** GET that also hands back the response headers (list pages carry X-Next-Cursor and
 * X-Total-Count there, so the JSON body stays the plain list older callers expect). */
export async function apiWithHeaders<T>(path: string): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", headers: langHeader() });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { code?: string; message?: string; fields?: Record<string, string> })
    | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Request failed ({status}).", { status: res.status }), data?.fields ?? {});
  }
  return { data: data as T, headers: res.headers };
}

/** Headers every state-changing request needs (JSON + CSRF echo + UI language). */
export function writeHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-csrf-token": readCookie("agentic_csrf"), ...langHeader() };
}

/** POST that answers with one JSON object per line (NDJSON); calls onEvent as each arrives. */
export async function streamNdjson<E>(path: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "same-origin", headers: writeHeaders(), body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", t("Could not reach the server. Check that the stack is running."));
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? t("Request failed ({status}).", { status: res.status }));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}

/**
 * P125: an IT support person's change to members, the organization, access or settings is not
 * done: the server keeps it for an owner or a global admin to approve and answers 202
 * {"held": true, "summary", "request_id"}. The call ends as an ApiError with code
 * "held_for_approval" (so no screen treats it as done), the person sees ONE info toast saying
 * where it went, and the red error toast a screen would show for it is skipped
 * (installHeldGuard, from main.tsx).
 */
export const HELD_FOR_APPROVAL = "held_for_approval";
const HELD_EVENT = "agentic:held";
let lastHeld = { message: "", at: 0 };

export function isHeld(err: unknown): boolean {
  return err instanceof ApiError && err.code === HELD_FOR_APPROVAL;
}

function heldForApproval(summary: string, requestId: string): ApiError {
  const message = t("Sent to the admins for approval: {summary}", { summary });
  lastHeld = { message, at: Date.now() };
  toast.info(message, { id: `held-${requestId}`, duration: 7000 });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HELD_EVENT, { detail: { id: requestId } }));
  return new ApiError(202, HELD_FOR_APPROVAL, message);
}

/** Calls `fn` whenever one of this person's changes is sent for approval (to refresh lists). */
export function onHeld(fn: () => void): () => void {
  window.addEventListener(HELD_EVENT, fn);
  return () => window.removeEventListener(HELD_EVENT, fn);
}

let guarded = false;
/** Once, at start: a screen's `toast.error(errorMessage(e))` for a held change is not shown
 * (the info toast already said it went for approval). */
export function installHeldGuard(): void {
  if (guarded) return;
  guarded = true;
  const original = toast.error;
  toast.error = ((message: Parameters<typeof toast.error>[0], data?: Parameters<typeof toast.error>[1]) => {
    if (typeof message === "string" && message === lastHeld.message && Date.now() - lastHeld.at < 10_000) return "";
    return original(message, data);
  }) as typeof toast.error;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return t("Something went wrong.");
}
