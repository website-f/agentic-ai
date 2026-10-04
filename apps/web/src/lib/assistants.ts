/** Personal assistants (P16): the page's data, email drafts awaiting approval. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { Agent } from "./work";

export interface Preset { key: "chief_of_staff" | "inbox" | "analyst" | "custom"; name: string; role: string; color: string; blurb: string }

export interface GoogleState {
  configured: boolean;
  redirect_uri: string;
  can_configure: boolean;
  account: null | {
    email: string; status: "connected" | "error"; last_error: string | null; connected_at: string; can_send: boolean;
    /** Granted calendar access. Connections made before it was asked for: "Reconnect Google to add Calendar". */
    calendar?: boolean;
  };
}

export interface AssistantsHome {
  assistants: Agent[];
  presets: Preset[];
  google: GoogleState;
  whatsapp: { channel_id: string | null; number: string | null; status: string | null; provider: string | null; linked: boolean };
  reach: ("app" | "telegram" | "whatsapp")[];
  drafts_pending: number;
  /** Calendar events assistants proposed, waiting for a yes. */
  calendar_pending?: number;
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

/** A calendar change an assistant proposed: nothing reaches Google until the person confirms. */
export interface CalendarDraft {
  id: string;
  status: "pending" | "done" | "discarded" | "failed" | "expired";
  action: "create" | "update" | "cancel";
  title: string;
  summary: string;
  before: string;
  event_id: string;
  attendees: string[];
  meet: boolean;
  /** Guests get an invitation/update when it is confirmed. */
  notify: boolean;
  agent_id: string | null;
  agent_name: string | null;
  link: string;
  error: string | null;
  created_at: string;
  decided_at: string | null;
}

export const assistantKeys = {
  home: ["assistants"] as const,
  drafts: (status: string) => ["email-drafts", status] as const,
  allDrafts: ["email-drafts"] as const,
  calendar: (status: string) => ["calendar-drafts", status] as const,
  allCalendar: ["calendar-drafts"] as const,
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

export const calendarDraftsQuery = (status: "pending" | "all") =>
  queryOptions({
    queryKey: assistantKeys.calendar(status),
    queryFn: () => api<CalendarDraft[]>(`/api/calendar-drafts?status=${status}`),
    refetchInterval: 20_000,
  });

/** One-tap questions for the chat, by what the assistant is for. */
export const QUICK_PROMPTS: { label: string; prompt: string; needs?: "gmail" | "calendar" }[] = [
  { label: "What's happening today?", prompt: "Give me today's company pulse: what got done, what's open, what needs me." },
  { label: "Where are we slacking?", prompt: "Where are we slacking? List what's stuck or waiting too long, and who should move it." },
  { label: "Who's not doing well?", prompt: "Which staff or agents aren't doing their work well this fortnight, and why? Be specific." },
  { label: "Check my inbox", prompt: "Check my inbox: what came in since yesterday that needs me? Group by priority.", needs: "gmail" },
  { label: "Draft my replies", prompt: "Draft replies to the urgent unread emails for me to approve.", needs: "gmail" },
  { label: "What's on my calendar today?", prompt: "What's on my calendar today? Flag clashes and anything I should prepare for.", needs: "calendar" },
  { label: "Find time to meet", prompt: "Find a free hour this week for <meeting> with <name>, and propose the event for me to confirm.", needs: "calendar" },
  { label: "Weekly report", prompt: "Every Monday at 9am, send me where we're slacking." },
  { label: "Chase a report", prompt: "Tell <name>'s agent to finish <report> by <time>, and make sure <name> knows." },
];
