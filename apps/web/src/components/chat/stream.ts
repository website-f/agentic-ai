/** P148c: a chat answer shown word by word as the model writes it.
 *
 * POST /api/agents/{id}/chat/stream answers one JSON object per line (engine/stream.py):
 * "start" (the conversation), "delta" (more words), "reset" (forget the words so far: another
 * model takes over, or they led to a tool call), "tool" (a tool is being used), then "done"
 * (the saved answer, as POST .../chat answers) or "error". */
import { ApiError, streamNdjson } from "@/lib/api";

export interface StreamDone {
  t: "done";
  session_id: string;
  reply: string;
  provider?: string;
  model?: string;
  tools_used: string[];
  message_id?: number | null;
}

export type ChatEvent =
  | { t: "start"; session_id: string }
  | { t: "delta"; text: string }
  | { t: "reset" }
  | { t: "tool"; name: string }
  | StreamDone
  | { t: "error"; code: string; message: string };

/** What the page shows while the answer is being written. */
export interface Live {
  text: string;
  tools: string[];
}

export const EMPTY_LIVE: Live = { text: "", tools: [] };

export function applyEvent(live: Live, e: ChatEvent): Live {
  switch (e.t) {
    case "delta":
      return { ...live, text: live.text + e.text };
    case "reset":
      return { ...live, text: "" };
    case "tool":
      return { ...live, tools: [...live.tools, e.name] };
    default:
      return live;
  }
}

/** Send one message and follow the answer. Resolves with the saved answer; an "error" line is
 * thrown as an ApiError (no_model_available as 502, like POST .../chat), and a stream that ends
 * without its last line as a lost connection (status 0), so the page watches the conversation
 * for the answer (P64: the turn carries on on the server). */
export async function streamChat(
  agentId: string,
  body: { message: string; session_id: string | null; reply_in?: string },
  on: { start?: (sessionId: string) => void; live?: (live: Live) => void },
): Promise<StreamDone> {
  let live = EMPTY_LIVE;
  const got: { done: StreamDone | null } = { done: null };
  await streamNdjson<ChatEvent>(`/api/agents/${agentId}/chat/stream`, body, (e) => {
    if (e.t === "start") on.start?.(e.session_id);
    else if (e.t === "done") got.done = e;
    else if (e.t === "error") throw new ApiError(e.code === "no_model_available" ? 502 : 500, e.code, e.message);
    else {
      live = applyEvent(live, e);
      on.live?.(live);
    }
  });
  if (!got.done) throw new ApiError(0, "network", "The connection closed before the answer was complete.");
  return got.done;
}
