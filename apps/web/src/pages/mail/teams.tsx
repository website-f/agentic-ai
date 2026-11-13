/** P52 Microsoft 365 → Teams: your own Teams chats (never anyone else's), through your own
 * Microsoft 365 connection. Open one to read it, or hand it to your AI ("what needs me here?").
 * Your AI can also read and (after you approve) answer your chats itself (agents/teams_tools).
 * P102: "Draft a reply" in a chat and "Message someone" (a first message to anyone in the
 * organisation) ask your AI for a draft; it waits under Waiting for your approval and is sent
 * only when you press Send in Teams. A first message needs "Allow new Teams chats" once.
 * P63: and, read only, the posts of the channels in the teams you are a member of, once your
 * Microsoft 365 admin turned that on (Channels > Microsoft 365) and you reconnected. */
import { ArrowBendDownRightIcon, ArrowBendUpLeftIcon, ArrowSquareOutIcon, ChatsTeardropIcon, HashIcon, LockSimpleIcon, MicrosoftTeamsLogoIcon, PencilSimpleLineIcon, SparkleIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  microsoftAccountQuery,
  microsoftConfigQuery,
  startMicrosoftConnect,
  startNewChatsConnect,
  teamsChannelQuery,
  teamsChannelsQuery,
  teamsChatQuery,
  teamsChatsQuery,
  type TeamsChannel,
  type TeamsChat,
  type TeamsPost,
  type TeamsTeam,
} from "@/lib/microsoft";
import { timeAgo } from "@/lib/utils";
import { useAskMyAi } from "@/pages/desk/hub";

type View = "chats" | "channels";

function useReconnect() {
  return useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function TeamsPanel() {
  const t = useT();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  const ready = !!account.data?.connected && account.data.teams_ok !== false;
  const [view, setView] = useState<View>("chats");
  const chats = useQuery({ ...teamsChatsQuery, enabled: ready && view === "chats" });
  const connect = useReconnect();

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
        body={t("Your connection was made before Teams was added. Reconnect once and Microsoft asks you to allow reading and answering your Teams chats.")}
        action={<Button loading={connect.isPending} onClick={() => connect.mutate()}>{t("Reconnect Microsoft 365")}</Button>} />
    );
  }
  return (
    <>
      <Segmented label={t("Teams")} size="sm" value={view} onChange={setView} className="w-full sm:w-fit [&>button]:flex-1"
        options={[{ value: "chats", label: t("Chats") }, { value: "channels", label: t("Channels") }]} />
      {view === "channels" ? <ChannelsView channelsOk={account.data.channels_ok === true} /> : <ChatsList newChats={account.data.new_chats_ok === true} />}
    </>
  );
}

/** P102: ask your AI for a first Teams message to someone (by work email). The draft waits for
 * you under Waiting for your approval; nothing is sent before you press Send in Teams. */
function NewMessage({ newChats, onClose }: { newChats: boolean; onClose: () => void }) {
  const t = useT();
  const ask = useAskMyAi();
  const allow = useMutation({
    mutationFn: startNewChatsConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [to, setTo] = useState("");
  const [what, setWhat] = useState("");
  const email = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(to.trim());
  const go = () => ask.mutate(
    { text: t("Draft a Teams message to {to} with teams_send (to = {to}). What it should say: {what}. Do not send it: I read and approve it first on the Microsoft 365 page.", { to: to.trim(), what: what.trim() }) },
    { onSuccess: onClose },
  );
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Message someone in Teams")}
      description={t("Your AI writes the message. You read it and press Send in Teams under Waiting for your approval. Nothing is sent before that.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!email || !what.trim()} loading={ask.isPending} onClick={go}><SparkleIcon size={15} /> {t("Ask my AI to draft it")}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t("To (work email)")} type="email" autoComplete="off" placeholder="ali@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
        <TextareaField label={t("What should it say?")} rows={3} value={what} onChange={(e) => setWhat(e.target.value)}
          placeholder={t("e.g. The tender pack is ready, I will bring it at 3pm.")} />
        {!newChats ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-warn/40 bg-warn/5 px-3 py-2.5 text-[12.5px]">
            <p>{t("For someone you have never chatted with in Teams, allow new Teams chats first (one more Microsoft sign-in). Replying in chats you already have works now.")}</p>
            <Button size="sm" variant="outline" className="w-fit" loading={allow.isPending} onClick={() => allow.mutate()}>{t("Allow new Teams chats")}</Button>
          </div>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

function ChatsList({ newChats }: { newChats: boolean }) {
  const t = useT();
  const chats = useQuery(teamsChatsQuery);
  const [open, setOpen] = useState<TeamsChat | null>(null);
  const [composing, setComposing] = useState(false);
  const newButton = (
    <Button size="sm" variant="outline" className="max-sm:w-full" onClick={() => setComposing(true)}><PencilSimpleLineIcon size={15} /> {t("Message someone")}</Button>
  );
  const dialog = composing ? <NewMessage newChats={newChats} onClose={() => setComposing(false)} /> : null;
  if (chats.isLoading) return <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>;
  if (chats.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(chats.error)}</p>;
  if (!chats.data?.length) {
    return <>{dialog}<EmptyState icon={ChatsTeardropIcon} title={t("No Teams chats yet")} body={t("Chats you have in Microsoft Teams show here.")} action={newButton} /></>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-64 text-[12.5px] text-muted">{t("Only your own chats, from your own connection. Open a chat to read it or to have your AI draft a reply; you approve every message before it is sent.")}</p>
        {newButton}
      </div>
      {dialog}
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
  const draft = useAskMyAi();
  const [replying, setReplying] = useState(false);
  const [what, setWhat] = useState("");
  const askDraft = () => draft.mutate(
    { text: what.trim()
      ? t("Draft a reply in my Teams chat \"{title}\" (chat {id}) with teams_send. What it should say: {what}. Do not send it: I read and approve it first on the Microsoft 365 page.", { title: chat.title, id: chat.id, what: what.trim() })
      : t("Read my Teams chat \"{title}\" (chat {id}) with teams_read_chat, then draft the reply I should send with teams_send. Do not send it: I read and approve it first on the Microsoft 365 page.", { title: chat.title, id: chat.id }) },
    { onSuccess: () => { setReplying(false); setWhat(""); } },
  );
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={chat.title} description={t("Teams chat")}
      actions={<>
        <Button onClick={() => setReplying((r) => !r)} aria-expanded={replying}>
          <ArrowBendUpLeftIcon size={15} /> {t("Draft a reply")}
        </Button>
        <Button variant="outline" loading={ask.isPending} onClick={() => ask.mutate({ text: t("Read my Teams chat \"{title}\" (chat {id}) with teams_read_chat and tell me what needs my attention, what was decided and what I should answer.", { title: chat.title, id: chat.id }) })}>
          <SparkleIcon size={15} /> {t("Ask my AI about it")}
        </Button>
        {chat.url ? <Button variant="outline" asChild><a href={chat.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Teams")}</a></Button> : null}
      </>}>
      {replying ? (
        <div className="mb-4 grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-3">
          <TextareaField label={t("What should the reply say? (optional)")} rows={3} value={what} onChange={(e) => setWhat(e.target.value)}
            placeholder={t("Leave it empty and your AI answers what needs answering.")} />
          <p className="text-[12.5px] text-muted">{t("Your AI writes it; you read it and press Send in Teams under Waiting for your approval. Nothing is sent before that.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={draft.isPending} onClick={askDraft}><SparkleIcon size={14} /> {t("Ask my AI to draft it")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>{t("Cancel")}</Button>
          </div>
        </div>
      ) : null}
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

// ---------------------------------------------------------------- P63: channel posts, read only

function ChannelsOff() {
  const t = useT();
  const connect = useReconnect();
  return (
    <EmptyState icon={UsersThreeIcon} title={t("Teams channel posts are not on")}
      body={t("Reading Teams channel posts needs your Microsoft 365 admin to turn it on (Channels > Microsoft 365), then reconnect Microsoft.")}
      action={<Button variant="outline" loading={connect.isPending} onClick={() => connect.mutate()}>{t("Reconnect Microsoft 365")}</Button>} />
  );
}

function ChannelsView({ channelsOk }: { channelsOk: boolean }) {
  const t = useT();
  const teams = useQuery({ ...teamsChannelsQuery, enabled: channelsOk });
  const [teamId, setTeamId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ team: TeamsTeam; channel: TeamsChannel } | null>(null);

  if (!channelsOk || (teams.error instanceof ApiError && teams.error.code === "teams_channels_off")) return <ChannelsOff />;
  if (teams.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>;
  if (teams.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(teams.error)}</p>;
  const all = teams.data ?? [];
  const team = all.find((x) => x.id === teamId) ?? all[0];
  if (!team) {
    return <EmptyState icon={UsersThreeIcon} title={t("No teams yet")} body={t("The teams you are a member of in Microsoft Teams show here, with their channels.")} />;
  }
  return (
    <>
      <p className="text-[12.5px] text-muted">{t("Read only: the channels of the teams you are a member of, from your own connection. Your AI can summarise them and draft replies for you to post.")}</p>
      {all.length > 1 ? (
        <div className="grid gap-1.5 sm:max-w-sm">
          <span className="text-[13px] font-medium">{t("Team")}</span>
          <Select value={team.id} onValueChange={setTeamId} label={t("Team")} options={all.map((x) => ({ value: x.id, label: x.name || t("(no name)") }))} />
        </div>
      ) : <h3 className="text-[14px] font-semibold">{team.name}</h3>}
      {!team.channels.length ? <p className="text-[13px] text-muted">{t("No channels you can see in this team.")}</p> : (
        <ListCard>
          {team.channels.map((c) => (
            <ListRow key={c.id} onClick={() => setOpen({ team, channel: c })}
              leading={c.kind === "private" ? <LockSimpleIcon size={20} className="text-muted" /> : <HashIcon size={20} className="text-[#5b5fc7]" />}
              title={c.name}
              meta={c.description ? <span className="line-clamp-2 basis-full text-[12.5px]">{c.description}</span> : undefined} />
          ))}
        </ListCard>
      )}
      {open ? <ChannelSheet team={open.team} channel={open.channel} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function PostHead({ post }: { post: TeamsPost }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted">
      <b className="text-fg">{post.from || "?"}</b>{post.at ? timeAgo(post.at) : ""}
    </span>
  );
}

function ChannelSheet({ team, channel, onClose }: { team: TeamsTeam; channel: TeamsChannel; onClose: () => void }) {
  const t = useT();
  const posts = useQuery(teamsChannelQuery(team.id, channel.id));
  const ask = useAskMyAi();
  const title = `${team.name} › ${channel.name}`;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={title} description={t("Teams channel (read only)")}
      actions={<>
        <Button loading={ask.isPending} onClick={() => ask.mutate({ text: t("Read the Teams channel \"{title}\" (team {team}, channel {channel}) with teams_read_channel and summarise what was posted, what needs my attention and what was decided. If I should answer something, draft the reply as text for me to post myself.", { title, team: team.id, channel: channel.id }) })}>
          <SparkleIcon size={15} /> {t("Ask my AI about it")}
        </Button>
        {channel.url ? <Button variant="outline" asChild><a href={channel.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Teams")}</a></Button> : null}
      </>}>
      {posts.error instanceof ApiError && posts.error.code === "teams_channels_off" ? <ChannelsOff />
        : posts.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        : posts.error ? <p role="alert" className="text-danger">{errorMessage(posts.error)}</p>
        : !posts.data?.length ? <p className="text-[13px] text-muted">{t("No posts in this channel yet.")}</p> : (
          <ol className="grid gap-3">
            {posts.data.map((p) => (
              <li key={p.id} className="grid gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
                <PostHead post={p} />
                {p.subject ? <span className="text-[13.5px] font-semibold break-words">{p.subject}</span> : null}
                <span className="text-[13.5px] whitespace-pre-wrap break-words">{p.text}</span>
                {p.replies.length ? (
                  <ol className="mt-1 grid gap-2 border-l-2 border-border pl-3" aria-label={t("{n} replies", { n: p.replies.length })}>
                    {p.replies.map((r) => (
                      <li key={r.id} className="grid gap-0.5">
                        <span className="flex items-baseline gap-1.5"><ArrowBendDownRightIcon size={12} className="shrink-0 text-muted" aria-hidden /><PostHead post={r} /></span>
                        <span className="text-[13px] whitespace-pre-wrap break-words">{r.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        )}
    </SideSheet>
  );
}
