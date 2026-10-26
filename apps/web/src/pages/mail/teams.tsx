/** P52 Microsoft 365 → Teams: your own Teams chats (never anyone else's), through your own
 * Microsoft 365 connection. Open one to read it, or hand it to your AI ("what needs me here?").
 * Your AI can also read and (after you approve) answer your chats itself (agents/teams_tools). */
import { ArrowSquareOutIcon, ChatsTeardropIcon, MicrosoftTeamsLogoIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import { microsoftAccountQuery, microsoftConfigQuery, startMicrosoftConnect, teamsChatQuery, teamsChatsQuery, type TeamsChat } from "@/lib/microsoft";
import { timeAgo } from "@/lib/utils";
import { useAskMyAi } from "@/pages/desk/hub";

export function TeamsPanel() {
  const t = useT();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  const ready = !!account.data?.connected && account.data.teams_ok !== false;
  const chats = useQuery({ ...teamsChatsQuery, enabled: ready });
  const [open, setOpen] = useState<TeamsChat | null>(null);
  const connect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (account.isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (!account.data?.connected) {
    return (
      <EmptyState icon={MicrosoftTeamsLogoIcon} title={t("Connect your Microsoft 365")}
        body={t("Your Outlook mail, calendar and Teams chats, in one connection that is yours alone. Your AI reads them for you; it never sends anything until you approve it.")}
        action={<Button loading={connect.isPending} onClick={() => connect.mutate()}><MicrosoftTeamsLogoIcon size={16} weight="bold" /> {t("Connect Microsoft 365")}</Button>} />
    );
  }
  const needsReconnect = account.data.teams_ok === false
    || (chats.error instanceof ApiError && chats.error.code === "teams_not_allowed");
  if (needsReconnect) {
    return (
      <EmptyState icon={MicrosoftTeamsLogoIcon} title={t("Allow Teams once")}
        body={t("Your connection was made before Teams was added. Reconnect once and Microsoft asks you to allow reading and sending your Teams chats.")}
        action={<Button loading={connect.isPending} onClick={() => connect.mutate()}>{t("Reconnect Microsoft 365")}</Button>} />
    );
  }
  if (chats.isLoading) return <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>;
  if (chats.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(chats.error)}</p>;
  if (!chats.data?.length) {
    return <EmptyState icon={ChatsTeardropIcon} title={t("No Teams chats yet")} body={t("Chats you have in Microsoft Teams show here.")} />;
  }
  return (
    <>
      <p className="text-[12.5px] text-muted">{t("Only your own chats, from your own connection. Your AI can read them and draft answers that you approve.")}</p>
      <ListCard>
        {chats.data.map((c) => (
          <ListRow key={c.id} onClick={() => setOpen(c)}
            leading={<MicrosoftTeamsLogoIcon size={22} weight="duotone" className="text-[#5b5fc7]" />}
            title={c.title}
            meta={<>
              <Meta items={[c.last_from, c.last_at ? timeAgo(c.last_at) : null, c.kind === "oneOnOne" ? null : t("{n} people", { n: c.people })]} />
              {c.last_text ? <span className="line-clamp-2 basis-full text-[12.5px]">{c.last_text}</span> : null}
            </>} />
        ))}
      </ListCard>
      {open ? <ChatSheet chat={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ChatSheet({ chat, onClose }: { chat: TeamsChat; onClose: () => void }) {
  const t = useT();
  const msgs = useQuery(teamsChatQuery(chat.id));
  const ask = useAskMyAi();
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={chat.title} description={t("Teams chat")}
      actions={<>
        <Button loading={ask.isPending} onClick={() => ask.mutate({ text: t("Read my Teams chat \"{title}\" (chat {id}) with teams_read_chat and tell me what needs my attention, what was decided and what I should answer.", { title: chat.title, id: chat.id }) })}>
          <SparkleIcon size={15} /> {t("Ask my AI about it")}
        </Button>
        {chat.url ? <Button variant="outline" asChild><a href={chat.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Teams")}</a></Button> : null}
      </>}>
      {msgs.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        : msgs.error ? <p role="alert" className="text-danger">{errorMessage(msgs.error)}</p>
        : !msgs.data?.length ? <p className="text-[13px] text-muted">{t("No messages.")}</p> : (
          <ol className="grid gap-3">
            {msgs.data.map((m) => (
              <li key={m.id} className="grid gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
                <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted"><b className="text-fg">{m.from || "?"}</b>{m.at ? timeAgo(m.at) : ""}</span>
                <span className="text-[13.5px] whitespace-pre-wrap break-words">{m.text}</span>
              </li>
            ))}
          </ol>
        )}
    </SideSheet>
  );
}
