/** Thin fetch wrapper: same-origin cookies, JSON in and out, CSRF echo, typed errors. */

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

export async function api<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    // The API only accepts JSON for state-changing calls, and checks the CSRF echo.
    init.headers = { "content-type": "application/json", "x-csrf-token": readCookie("agentic_csrf") };
    init.body = JSON.stringify(body ?? {});
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check that the stack is running.");
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as
    | (T & { code?: string; message?: string; fields?: Record<string, string> })
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.code ?? "http_error",
      data?.message ?? `Request failed (${res.status}).`,
      data?.fields ?? {},
    );
  }
  return data as T;
}

/** Headers every state-changing request needs (JSON + CSRF echo). */
export function writeHeaders(): Record<string, string> {
  return { "content-type": "application/json", "x-csrf-token": readCookie("agentic_csrf") };
}

/** POST that answers with one JSON object per line (NDJSON); calls onEvent as each arrives. */
export async function streamNdjson<E>(path: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "same-origin", headers: writeHeaders(), body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check that the stack is running.");
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? `Request failed (${res.status}).`);
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

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
