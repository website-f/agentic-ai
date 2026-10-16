/** What a personal assistant adds to the shared full-screen chat: one-tap questions that fit
 * what is connected, the "to approve" badge, what it is probably doing, and a refresh of the
 * Drafts tab when a reply proposed an email or an event. */
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { ChatViewProps, QuickPrompt } from "@/components/chat/chat-view";
import { Button } from "@/components/ui/button";
import { t as tr, useT } from "@/i18n";
import { assistantKeys, assistantsQuery, QUICK_PROMPTS, type AssistantsHome } from "@/lib/assistants";
import { microsoftAccountQuery, type MicrosoftAccount } from "@/lib/microsoft";
import type { Agent } from "@/lib/work";

/** Tools whose result waits on the Drafts tab. */
export const PROPOSES = [
  "email_draft", "email_draft_reply", "calendar_create_event", "calendar_update_event", "calendar_cancel_event",
  "outlook_draft", "outlook_draft_reply", "outlook_propose_event", "outlook_propose_update", "outlook_propose_cancel",
];

/** While the assistant works: what it is probably doing, from what was asked. */
export function thinkingLine(q: string): string {
  const s = q.toLowerCase();
  if (/\bevery\b|remind me|\bdaily\b|\bweekly\b|\bmonthly\b/.test(s)) return tr("Setting up the schedule…");
  if (/calendar|meeting|free time|free slot|\bbook\b|agenda/.test(s)) return tr("Checking your calendar…");
  if (/inbox|email|mail|reply|draft/.test(s)) return tr("Going through your email…");
  if (/slack|stuck|late|behind|slip/.test(s)) return tr("Looking for what's stuck…");
  if (/who|staff|team|perform|doing well/.test(s)) return tr("Checking how everyone is doing…");
  if (/tell|remind|chase|notify|whatsapp/.test(s)) return tr("Reaching out…");
  return tr("Looking at the company…");
}

/** What the person has connected for mail and calendar: Gmail or (P34) Outlook. */
export function connectedMail(home: AssistantsHome, outlook?: MicrosoftAccount | null) {
  const ms = !!outlook?.connected && outlook.status !== "reconnect_needed";
  return {
    mail: !!home.google.account || (ms && !!outlook?.mail_ok),
    calendar: !!home.google.account?.calendar || (ms && !!outlook?.calendar_ok),
    google: !!home.google.account,
  };
}

/** The one-tap questions that work with what this person has connected. */
export function assistantPrompts(home: AssistantsHome, outlook?: MicrosoftAccount | null): QuickPrompt[] {
  const c = connectedMail(home, outlook);
  return QUICK_PROMPTS.filter((p) => !p.needs || (p.needs === "gmail" ? c.mail : c.calendar));
}

/** A nudge under the chat only when something is missing. */
export function connectFooter(home: AssistantsHome, outlook: MicrosoftAccount | null | undefined, t: ReturnType<typeof useT>) {
  const c = connectedMail(home, outlook);
  if (!c.mail) return <p className="text-[12px] text-muted">{t("Connect Google or Outlook and I can read your inbox and calendar too.")}</p>;
  if (!c.calendar && c.google) return <p className="text-[12px] text-muted">{t("Reconnect Google in Settings to add your calendar.")}</p>;
  return null;
}

/** The assistant extras for the chat (null for an ordinary agent); `loading` while they load. */
export function useAssistantChat(agent: Agent | undefined): { loading: boolean; props: Partial<ChatViewProps> | null } {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: home, isLoading } = useQuery({ ...assistantsQuery, enabled: !!agent?.private });
  const { data: outlook } = useQuery({ ...microsoftAccountQuery, enabled: !!agent?.private });
  if (!agent?.private) return { loading: false, props: null };
  if (!home || !home.assistants.some((a) => a.id === agent.id)) return { loading: isLoading, props: null };
  const waiting = home.drafts_pending + (home.calendar_pending ?? 0);
  const props: Partial<ChatViewProps> = {
    resumeLatest: true,
    quickPrompts: assistantPrompts(home, outlook),
    thinking: thinkingLine,
    emptyState: {
      title: t("Hi, I'm {name}.", { name: agent.name }),
      body: t("Ask me about the company, your team or your inbox. Try one of these:"),
      footer: connectFooter(home, outlook, t),
    },
    headerExtra: waiting ? (
      <Button size="sm" variant="outline" title={t("{n} to approve", { n: waiting })}
        onClick={() => navigate({ to: "/assistants", search: { a: agent.id, tab: "drafts" } })}>
        <CheckCircleIcon size={14} /> {waiting}<span className="max-sm:hidden"> {t("to approve")}</span>
      </Button>
    ) : null,
    onReply: (r) => {
      if (r.tools_used.some((x) => PROPOSES.includes(x))) {
        qc.invalidateQueries({ queryKey: assistantKeys.allDrafts });
        qc.invalidateQueries({ queryKey: assistantKeys.allCalendar });
        qc.invalidateQueries({ queryKey: assistantKeys.home });
      }
    },
  };
  return { loading: false, props };
}
