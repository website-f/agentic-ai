/** Where a page used to embed a chat box: one big "Open chat" (full screen), one-tap questions
 * and the latest conversations to pick up. */
import { ArrowRightIcon, ChatsCircleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { cn, timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/work";

import type { QuickPrompt } from "./chat-view";
import { askOnOpen, chatRoute } from "./links";
import { SessionIcon, useSessions } from "./sessions";

export function ChatLauncher({ agent, from, canWrite, quickPrompts, guide, footer, className }: {
  agent: Agent;
  /** The page to come back to (a same-origin path). */
  from: string;
  canWrite: boolean;
  quickPrompts?: QuickPrompt[];
  /** data-guide ids for the guide's highlights. */
  guide?: { root?: string; quick?: string };
  footer?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const sessions = useSessions(agent.id, 5);
  const open = (session?: string) => navigate(chatRoute(agent.id, { from, session }));
  const locked = !canWrite || agent.status !== "active";
  const recent = sessions.items.slice(0, 5);
  return (
    <section data-guide={guide?.root} className={cn("grid grid-cols-[minmax(0,1fr)] gap-5 rounded-[var(--radius-lg)] border border-border bg-surface p-4 sm:p-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AgentAvatar name={agent.name} color={agent.color} size="lg" working={agent.current_task?.status === "running"} />
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold break-words">{t("Chat with {name}", { name: agent.name })}</h2>
            <p className="text-[13px] text-muted">
              {agent.status === "paused" ? t("{name} is paused", { name: agent.name })
                : agent.status === "retired" ? t("{name} is retired", { name: agent.name })
                : !canWrite ? t("Your role can read but not chat")
                : t("Opens full screen so replies are easy to read. Back or Esc brings you here.")}
            </p>
          </div>
        </div>
        <Button size="lg" className="max-sm:w-full" onClick={() => open()}>
          <ChatsCircleIcon size={18} weight="fill" /> {t("Open chat")}
        </Button>
      </div>

      {quickPrompts?.length && !locked ? (
        <div data-guide={guide?.quick} className="flex flex-wrap gap-2">
          {quickPrompts.slice(0, 6).map((p) => (
            <button key={p.label} type="button"
              onClick={() => { askOnOpen(agent.id, p.prompt); open(); }}
              className="h-9 rounded-full border border-border px-3.5 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:bg-accent-soft/40 hover:text-fg">
              {t(p.label)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
        <p className="text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Recent conversations")}</p>
        {sessions.isLoading ? (
          <div className="grid gap-1.5">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-sm" />)}</div>
        ) : recent.length ? (
          <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
            {recent.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => open(s.id)}
                  className="group flex min-h-12 w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-surface-2">
                  <SessionIcon s={s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{s.title || t("Conversation")}</span>
                    <span className="block text-[11.5px] text-muted">{timeAgo(s.updated_at)}</span>
                  </span>
                  <ArrowRightIcon size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 py-2 text-[13px] text-muted">{t("No conversations yet.")}</p>
        )}
      </div>
      {footer}
    </section>
  );
}
