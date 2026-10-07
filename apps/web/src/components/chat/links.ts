/** Where the full-screen chat goes back to, and links into it. Kept free of React so the router
 * and tests can import it cheaply. */

/**
 * A same-origin path to go back to, or undefined. Only "/something" counts: never "//host"
 * (another site), never a backslash (browsers read "/\host" as "//host"), never a scheme, and
 * no control characters or whitespace tricks.
 */
export function safeFrom(from: unknown): string | undefined {
  if (typeof from !== "string") return undefined;
  if (from.length < 1 || from.length > 2000) return undefined;
  if (!from.startsWith("/") || from.startsWith("//")) return undefined;
  if (from.includes("\\")) return undefined;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f\s]/.test(from)) return undefined;
  return from;
}

/** The path (with query) of the page the person is on now, to come back to from the chat. */
export function here(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/** Navigate options for opening an agent's chat full screen. */
export function chatRoute(agentId: string, opts: { from?: string; session?: string } = {}) {
  return {
    to: "/chat/$agentId" as const,
    params: { agentId },
    search: { from: safeFrom(opts.from), session: opts.session || undefined },
  };
}

/** A question to send as soon as the chat opens (a one-tap prompt on a launcher). Held in
 * memory, never in the URL, so a link cannot make anyone send a message. */
let pending: { agentId: string; text: string; at: number } | null = null;
export function askOnOpen(agentId: string, text: string) {
  pending = { agentId, text, at: Date.now() };
}
/** The waiting question for this agent, if it is fresh (clearAsk once it is used). */
export function peekAsk(agentId: string): string | undefined {
  const p = pending;
  return p && p.agentId === agentId && Date.now() - p.at < 30_000 ? p.text : undefined;
}
export function clearAsk(agentId: string) {
  if (pending?.agentId === agentId) pending = null;
}

/** The first task id (tk_…) a reply mentions, so "Created a task" can open that task. */
export function taskIdIn(text: string | null | undefined): string | undefined {
  return text?.match(/\btk_[0-9a-z]{10,40}\b/)?.[0];
}
