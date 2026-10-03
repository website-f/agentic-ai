/** Personal assistants (P16): the page's data, email drafts awaiting approval. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { Agent } from "./work";

export interface Preset { key: "chief_of_staff" | "inbox" | "analyst" | "custom"; name: string; role: string; color: string; blurb: string }

export interface GoogleState {
  configured: boolean;
  redirect_uri: string;
  can_configure: boolean;
  account: null | { email: string; status: "connected" | "error"; last_error: string | null; connected_at: string; can_send: boolean };
}

export interface AssistantsHome {
  assistants: Agent[];
  presets: Preset[];
  google: GoogleState;
  whatsapp: { channel_id: string | null; number: string | null; linked: boolean };
  reach: ("app" | "telegram" | "whatsapp")[];
  drafts_pending: number;
}

export interface EmailDraft {
  id: string;
  status: "pending" | "sent" | "discarded" | "failed";
  to: string;
  cc: string;
  subject: string;
  body: string;
  original_from: string;
  original_snippet: string;
  is_reply: boolean;
  agent_id: string | null;
  agent_name: string | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
}

export const assistantKeys = {
  home: ["assistants"] as const,
  drafts: (status: string) => ["email-drafts", status] as const,
  allDrafts: ["email-drafts"] as const,
};

export const assistantsQuery = queryOptions({
  queryKey: assistantKeys.home,
  queryFn: () => api<AssistantsHome>("/api/assistants"),
});

export const draftsQuery = (status: "pending" | "all") =>
  queryOptions({
    queryKey: assistantKeys.drafts(status),
    queryFn: () => api<EmailDraft[]>(`/api/email-drafts?status=${status}`),
    refetchInterval: 20_000, // assistants add drafts from chat, tasks and WhatsApp
  });

/** One-tap questions for the chat, by what the assistant is for. */
export const QUICK_PROMPTS: { label: string; prompt: string; needs?: "gmail" }[] = [
  { label: "What's happening today?", prompt: "Give me today's company pulse: what got done, what's open, what needs me." },
  { label: "Where are we slacking?", prompt: "Where are we slacking? List what's stuck or waiting too long, and who should move it." },
  { label: "Who's not doing well?", prompt: "Which staff or agents aren't doing their work well this fortnight, and why? Be specific." },
  { label: "Check my inbox", prompt: "Check my inbox: what came in since yesterday that needs me? Group by priority.", needs: "gmail" },
  { label: "Draft my replies", prompt: "Draft replies to the urgent unread emails for me to approve.", needs: "gmail" },
  { label: "Chase a report", prompt: "Tell <name>'s agent to finish <report> by <time>, and make sure <name> knows." },
];
