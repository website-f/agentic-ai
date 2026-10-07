/** A person's conversations with one agent: the list beside (or in a sheet over) the chat, and
 * the small "recent conversations" list the chat launchers show. */
import { ChatCircleDotsIcon, PlusIcon, TelegramLogoIcon, WhatsappLogoIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { usePagedList } from "@/lib/paged";
import { cn, timeAgo } from "@/lib/utils";
import { workKeys } from "@/lib/work";

export interface ChatSession { id: string; title: string; updated_at: string }

/** WhatsApp and Telegram conversations live with the channel; the web chat picks up the rest. */
export const channelOf = (s: ChatSession): "whatsapp" | "telegram" | null =>
  s.title.startsWith("WhatsApp") ? "whatsapp" : s.title.startsWith("Telegram") ? "telegram" : null;

/** The person's conversations with an agent, newest first, in pages. */
export function useSessions(agentId: string, pageSize = 30) {
  return usePagedList<ChatSession>(workKeys.sessions(agentId), `/api/agents/${agentId}/sessions`, {}, { pageSize });
}

export function SessionIcon({ s, on }: { s: ChatSession; on?: boolean }) {
  const ch = channelOf(s);
  if (ch === "whatsapp") return <WhatsappLogoIcon size={16} className="shrink-0 text-ok" />;
  if (ch === "telegram") return <TelegramLogoIcon size={16} className="shrink-0 text-info" />;
  return <ChatCircleDotsIcon size={16} className={cn("shrink-0", on ? "text-accent" : "text-muted")} />;
}

export function SessionList({ sessions, current, onPick, onNew }: {
  sessions: ReturnType<typeof useSessions>;
  current: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}><PlusIcon size={15} /> {t("New conversation")}</Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label={t("Conversations")}>
        {sessions.isLoading ? [0, 1, 2].map((i) => <li key={i}><Skeleton className="mb-1.5 h-12 rounded-sm" /></li>) : null}
        {!sessions.isLoading && !sessions.items.length ? <li className="px-2 py-6 text-center text-[12.5px] text-muted">{t("No conversations yet.")}</li> : null}
        {sessions.items.map((s) => {
          const on = s.id === current;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s.id)} aria-current={on || undefined}
                className={cn("flex min-h-12 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors", on ? "bg-accent-soft" : "hover:bg-surface-2")}>
                <SessionIcon s={s} on={on} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px]", on && "font-medium text-accent")}>{s.title || t("Conversation")}</span>
                  <span className="block truncate text-[11.5px] text-muted">{timeAgo(s.updated_at)}</span>
                </span>
              </button>
            </li>
          );
        })}
        {sessions.hasMore ? (
          <li className="pt-1">
            <Button variant="ghost" size="sm" className="w-full" loading={sessions.isFetchingMore} onClick={sessions.loadMore}>
              {sessions.isFetchingMore ? t("Loading older conversations…") : t("Load older conversations…")}
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
