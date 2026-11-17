/** Microsoft 365 → Teams: the person's own Teams chats and channels, shown like Teams.
 * P52/P102: your own chats, through your own connection (never anyone else's); "Message
 * someone" asks your AI to draft a first message, which waits under Waiting for your approval.
 * P109: each chat opens as a Teams conversation (bubbles, yours on the right, names and times,
 * day dividers, mentions, reactions, files, system lines) with a box to answer directly, and
 * Ask AI ("what is this about?", "draft a reply" that fills the box: nothing is sent until you
 * press Send). Channels: teams → channels → posts with their threads, reply in a thread (once
 * the admin turned posting on), Ask AI per channel or thread. Refreshes on its own (React Query
 * polling: chats every 30 s, an open chat every 10 s). */
import {
  ArrowSquareOutIcon,
  ChatsTeardropIcon,
  HashIcon,
  LockSimpleIcon,
  MicrosoftTeamsLogoIcon,
  PencilSimpleLineIcon,
  SparkleIcon,
  TextAlignLeftIcon,
  UsersThreeIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  chatQuery,
  chatsQuery,
  m365Keys,
  olderChat,
  postsQuery,
  sendChat,
  sendPost,
  type ChatRow,
  type Invitee,
  type TeamsMsg,
  type TeamsPostThread,
  type Tone,
} from "@/lib/m365";
import {
  microsoftAccountQuery,
  microsoftConfigQuery,
  startMicrosoftConnect,
  startNewChatsConnect,
  teamsChannelsQuery,
  type TeamsChannel,
  type TeamsTeam,
} from "@/lib/microsoft";
import { useMedia } from "@/lib/use-media";
import { cn, timeAgo } from "@/lib/utils";
import { useAskMyAi } from "@/pages/desk/hub";

import { AiAnswer, ToneSelect, useAskAi } from "./ai";
import { useMeetingComposer } from "./meeting";
import { RecipientPicker } from "./recipients";
import { Body, clock, Conversation, MessageComposer, Reactions, ReplyLink, useStickToBottom } from "./teams-ui";

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
  const chats = useQuery({ ...chatsQuery, enabled: ready && view === "chats" });
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
      {view === "channels"
        ? <ChannelsView channelsOk={account.data.channels_ok === true} sendOk={account.data.channel_send_ok === true} />
        : <ChatsView newChats={account.data.new_chats_ok === true} />}
    </>
  );
}

// ---------------------------------------------------------------- chats

/** P102: ask your AI for a first Teams message to someone (by work email). The draft waits for
 * you under Waiting for your approval; nothing is sent before you press Send in Teams.
 * P111: pick the people from a search (office members you may see, your Outlook) or type a
 * new address; several make one new group chat. */
function NewMessage({ newChats, onClose }: { newChats: boolean; onClose: () => void }) {
  const t = useT();
  const ask = useAskMyAi();
  const allow = useMutation({
    mutationFn: startNewChatsConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // P111: several people (searched or typed); several make one new group chat.
  const [to, setTo] = useState<Invitee[]>([]);
  const [what, setWhat] = useState("");
  const emails = to.map((p) => p.email);
  const group = emails.length > 1;
  const go = () => ask.mutate(
    {
      text: group
        ? t("Draft one Teams message to a new group chat with {to} with teams_send (to = {to}, all of them in one group chat). What it should say: {what}. Do not send it: I read and approve it first on the Microsoft 365 page.", { to: emails.join(", "), what: what.trim() })
        : t("Draft a Teams message to {to} with teams_send (to = {to}). What it should say: {what}. Do not send it: I read and approve it first on the Microsoft 365 page.", { to: emails[0] ?? "", what: what.trim() }),
    },
    { onSuccess: onClose },
  );
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Message someone in Teams")}
      description={t("Your AI writes the message. You read it and press Send in Teams under Waiting for your approval. Nothing is sent before that.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!emails.length || !what.trim() || (group && !newChats)} loading={ask.isPending} onClick={go}><SparkleIcon size={15} /> {t("Ask my AI to draft it")}</Button>
      </>}>
      <div className="grid gap-3">
        <RecipientPicker label={t("To")} value={to} onChange={setTo} autoFocus
          hint={group ? t("{n} people: one new group chat with all of them.", { n: emails.length }) : t("Search your office and Outlook by name or email, or type a new email address.")} />
        <TextareaField label={t("What should it say?")} rows={3} value={what} onChange={(e) => setWhat(e.target.value)}
          placeholder={t("e.g. The tender pack is ready, I will bring it at 3pm.")} />
        {!newChats ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-warn/40 bg-warn/5 px-3 py-2.5 text-[12.5px]">
            <p>{group
              ? t("A chat with several people is always a new Teams chat, so allow new Teams chats first (one more Microsoft sign-in).")
              : t("For someone you have never chatted with in Teams, allow new Teams chats first (one more Microsoft sign-in). Replying in chats you already have works now.")}</p>
            <Button size="sm" variant="outline" className="w-fit" loading={allow.isPending} onClick={() => allow.mutate()}>{t("Allow new Teams chats")}</Button>
          </div>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

function ChatFace({ chat, size = "md" }: { chat: Pick<ChatRow, "title" | "kind" | "members">; size?: "sm" | "md" }) {
  if (chat.kind === "oneOnOne" || chat.members.length === 1) return <PersonAvatar name={chat.title} id={chat.members[0]?.id} size={size} />;
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-[#e8ebfa] text-[#5b5fc7] dark:bg-[#2f2f4a] dark:text-[#a6a8f0]", size === "md" ? "size-10" : "size-8")}>
      <UsersThreeIcon size={size === "md" ? 20 : 16} weight="fill" />
    </span>
  );
}

function ChatsView({ newChats }: { newChats: boolean }) {
  const t = useT();
  const wide = useMedia("(min-width: 1024px)");
  const chats = useQuery(chatsQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [composing, setComposing] = useState(false);
  const all = useMemo(() => chats.data ?? [], [chats.data]);
  const shown = filter.trim() ? all.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase())) : all;
  // A wide screen shows the newest chat until another is picked.
  const activeId = openId ?? (wide ? all[0]?.id ?? null : null);
  const open = all.find((c) => c.id === activeId) ?? null;

  const dialog = composing ? <NewMessage newChats={newChats} onClose={() => setComposing(false)} /> : null;
  const newButton = <Button size="sm" variant="outline" onClick={() => setComposing(true)}><PencilSimpleLineIcon size={15} /> {t("Message someone")}</Button>;
  if (chats.isLoading) return <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>;
  if (chats.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(chats.error)}</p>;
  if (!all.length) return <>{dialog}<EmptyState icon={ChatsTeardropIcon} title={t("No Teams chats yet")} body={t("Chats you have in Microsoft Teams show here.")} action={newButton} /></>;

  const list = (
    <div className="grid min-w-0 content-start gap-2">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("Find a chat")}</span>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Find a chat")} />
        </label>
        {newButton}
      </div>
      <ul className="grid divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface" aria-label={t("Chats")}>
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setOpenId(c.id)} aria-current={c.id === activeId ? "true" : undefined}
              className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                c.id === activeId && "bg-[#e8ebfa]/70 hover:bg-[#e8ebfa] dark:bg-[#2f2f4a]/70 dark:hover:bg-[#2f2f4a]")}>
              <ChatFace chat={c} />
              <span className="grid min-w-0">
                <span className={cn("truncate text-[13.5px]", c.unread ? "font-semibold" : "font-medium")}>
                  {c.unread ? <span aria-label={t("Unread")} className="mr-1.5 inline-block size-2 rounded-full bg-[#5b5fc7] align-middle" /> : null}
                  {c.title}
                </span>
                <span className={cn("truncate text-[12.5px]", c.unread ? "text-fg" : "text-muted")}>{c.last_mine ? t("You: {text}", { text: c.last_text }) : c.last_text || (c.kind === "oneOnOne" ? "" : t("{n} people", { n: c.people }))}</span>
              </span>
              <span className="self-start pt-0.5 text-[11.5px] text-muted tabular">{c.last_at ? shortWhen(c.last_at) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">{t("Only your own chats, from your own connection. You write and send; Ask AI only drafts.")}</p>
    </div>
  );
  if (wide) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        {dialog}
        {list}
        {open ? <ChatWindow key={open.id} chat={open} /> : null}
      </div>
    );
  }
  return (
    <>
      {dialog}
      {list}
      {open ? (
        <SideSheet open onOpenChange={(o) => !o && setOpenId(null)} size="lg" title={<span className="flex items-center gap-2"><ChatFace chat={open} size="sm" /> {open.title}</span>} description={t("Teams chat")}>
          <ChatWindow chat={open} bare />
        </SideSheet>
      ) : null}
    </>
  );
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? clock(iso) : timeAgo(iso);
}

function ChatWindow({ chat, bare }: { chat: ChatRow; bare?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const page = useQuery(chatQuery(chat.id));
  const [older, setOlder] = useState<TeamsMsg[]>([]);
  const [more, setMore] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [about, setAbout] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [tone, setTone] = useState<"" | Tone>("");
  const [what, setWhat] = useState("");
  const messages = useMemo(() => {
    const seen = new Set<string>();
    return [...older, ...(page.data?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [older, page.data]);
  const nextOlder = more === undefined ? page.data?.more ?? null : more;
  const { ref, onScroll } = useStickToBottom(messages.length);

  const loadOlder = useMutation({
    mutationFn: () => olderChat(chat.id, nextOlder ?? ""),
    onSuccess: (p) => { setOlder((o) => [...p.messages, ...o]); setMore(p.more); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: () => sendChat(chat.id, text.trim()),
    onSuccess: () => {
      setText("");
      void qc.invalidateQueries({ queryKey: m365Keys.chat(chat.id) });
      void qc.invalidateQueries({ queryKey: m365Keys.chats });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const openMeeting = useMeetingComposer((st) => st.open);
  const ai = useAskAi((r) => {
    if (r.action === "chat_about") setAbout(r.text ?? "");
    if (r.action === "chat_reply") { setText(r.body ?? ""); setDrafting(false); }
  });

  const head = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2.5">
      {!bare ? <><ChatFace chat={chat} size="sm" /><h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{chat.title}</h3></> : <span className="flex-1" />}
      <Menu>
        <MenuTrigger asChild><Button size="sm" variant="secondary" loading={ai.isPending && !drafting}><SparkleIcon size={15} /> {t("Ask AI")}</Button></MenuTrigger>
        <MenuContent>
          <MenuItem icon={<TextAlignLeftIcon />} onSelect={() => ai.mutate({ action: "chat_about", chat_id: chat.id })}>{t("What is this chat about?")}</MenuItem>
          <MenuItem icon={<PencilSimpleLineIcon />} onSelect={() => setDrafting(true)}>{t("Draft a reply…")}</MenuItem>
          <MenuItem icon={<VideoCameraIcon />} onSelect={() => openMeeting({ chat_id: chat.id, about: chat.title, instructions: t("Set up a Teams meeting about this chat with the people in it.") })}>{t("Set up a meeting about this")}</MenuItem>
        </MenuContent>
      </Menu>
      {chat.url ? <Button size="sm" variant="ghost" asChild><a href={chat.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Teams")}</a></Button> : null}
    </div>
  );

  return (
    <section className={cn("grid min-w-0 gap-2", !bare && "rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3")} aria-label={chat.title}>
      {head}
      {about != null ? <AiAnswer title={t("What this chat is about")} text={about} onClose={() => setAbout(null)} /> : null}
      <div ref={ref} onScroll={onScroll} className={cn("min-h-64 overflow-y-auto overscroll-contain", bare ? "h-[52dvh]" : "h-[calc(100dvh-24rem)] max-h-[44rem]")}>
        {page.isLoading ? <div className="grid gap-3 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className={cn("h-12 w-2/3", i % 2 && "justify-self-end")} />)}</div>
          : page.error ? <p role="alert" className="p-2 text-[13.5px] text-danger">{errorMessage(page.error)}</p>
          : !messages.length ? <p className="p-4 text-center text-[13px] text-muted">{t("No messages yet. Say hello.")}</p>
          : <Conversation messages={messages}
              top={nextOlder ? <Button size="sm" variant="ghost" loading={loadOlder.isPending} onClick={() => loadOlder.mutate()}>{t("Show earlier messages")}</Button> : null} />}
      </div>
      {drafting ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-[#7f85f5]/50 bg-[#e8ebfa]/40 p-2.5 dark:bg-[#2f2f4a]/40">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1"><span className="sr-only">{t("What should the reply say? (optional)")}</span>
              <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t("What should the reply say? (optional)")} maxLength={2000} />
            </label>
            <div className="sm:w-36"><ToneSelect value={tone} onChange={setTone} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={ai.isPending} onClick={() => ai.mutate({ action: "chat_reply", chat_id: chat.id, tone, instructions: what })}><SparkleIcon size={14} /> {t("Draft it")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDrafting(false)}>{t("Cancel")}</Button>
          </div>
        </div>
      ) : null}
      <MessageComposer value={text} onChange={setText} onSend={() => send.mutate()} sending={send.isPending}
        placeholder={t("Type a message")} onAi={() => setDrafting((d) => !d)} aiBusy={false} />
    </section>
  );
}

// ---------------------------------------------------------------- channels

function ChannelsOff({ title, body }: { title: string; body: string }) {
  const t = useT();
  const connect = useReconnect();
  return (
    <EmptyState icon={UsersThreeIcon} title={title} body={body}
      action={<Button variant="outline" loading={connect.isPending} onClick={() => connect.mutate()}>{t("Reconnect Microsoft 365")}</Button>} />
  );
}

function ChannelsView({ channelsOk, sendOk }: { channelsOk: boolean; sendOk: boolean }) {
  const t = useT();
  const wide = useMedia("(min-width: 1024px)");
  const teams = useQuery({ ...teamsChannelsQuery, enabled: channelsOk });
  const [teamId, setTeamId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ team: TeamsTeam; channel: TeamsChannel } | null>(null);
  const off = <ChannelsOff title={t("Teams channel posts are not on")}
    body={t("Reading Teams channel posts needs your Microsoft 365 admin to turn it on (Channels > Microsoft 365), then reconnect Microsoft.")} />;

  if (!channelsOk || (teams.error instanceof ApiError && teams.error.code === "teams_channels_off")) return off;
  if (teams.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-md)]" />)}</div>;
  if (teams.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(teams.error)}</p>;
  const all = teams.data ?? [];
  const team = all.find((x) => x.id === teamId) ?? all[0];
  if (!team) return <EmptyState icon={UsersThreeIcon} title={t("No teams yet")} body={t("The teams you are a member of in Microsoft Teams show here, with their channels.")} />;
  const current = open && open.team.id === team.id ? open : null;

  const list = (
    <div className="grid min-w-0 content-start gap-2">
      {all.length > 1 ? (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Team")}</span>
          <Select value={team.id} onValueChange={(v) => { setTeamId(v); setOpen(null); }} label={t("Team")} options={all.map((x) => ({ value: x.id, label: x.name || t("(no name)") }))} />
        </div>
      ) : <h3 className="flex items-center gap-2 text-[14px] font-semibold"><MicrosoftTeamsLogoIcon size={18} weight="duotone" className="text-[#5b5fc7]" /> {team.name}</h3>}
      {!team.channels.length ? <p className="text-[13px] text-muted">{t("No channels you can see in this team.")}</p> : (
        <ul className="grid overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface" aria-label={t("Channels")}>
          {team.channels.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen({ team, channel: c })} aria-current={current?.channel.id === c.id ? "true" : undefined}
                className={cn("flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left text-[13.5px] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                  current?.channel.id === c.id && "bg-[#e8ebfa]/70 font-medium dark:bg-[#2f2f4a]/70")}>
                {c.kind === "private" ? <LockSimpleIcon size={17} className="shrink-0 text-muted" /> : <HashIcon size={17} className="shrink-0 text-[#5b5fc7]" />}
                <span className="min-w-0 truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  const thread = current ? <ChannelThreads team={current.team} channel={current.channel} sendOk={sendOk} bare={!wide} /> : null;
  if (wide) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        {list}
        {thread ?? <div className="grid min-h-60 place-items-center rounded-[var(--radius-md)] border border-dashed border-border p-6 text-[13px] text-muted">{t("Pick a channel to read its posts.")}</div>}
      </div>
    );
  }
  return (
    <>
      {list}
      {current ? (
        <SideSheet open onOpenChange={(o) => !o && setOpen(null)} size="lg" title={`${current.team.name} › ${current.channel.name}`} description={t("Teams channel")}>
          {thread}
        </SideSheet>
      ) : null}
    </>
  );
}

function ChannelThreads({ team, channel, sendOk, bare }: { team: TeamsTeam; channel: TeamsChannel; sendOk: boolean; bare: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const posts = useQuery(postsQuery(team.id, channel.id));
  const [about, setAbout] = useState<string | null>(null);
  const [post, setPost] = useState("");
  const { ref, onScroll } = useStickToBottom(posts.data?.length ?? 0);
  const ai = useAskAi((r) => { if (r.action === "channel_about") setAbout(r.text ?? ""); });
  const newPost = useMutation({
    mutationFn: () => sendPost(team.id, channel.id, { text: post.trim() }),
    onSuccess: () => { setPost(""); void qc.invalidateQueries({ queryKey: m365Keys.posts(team.id, channel.id) }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section className={cn("grid min-w-0 gap-2", !bare && "rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3")} aria-label={channel.name}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2.5">
        {!bare ? <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold"><HashIcon size={17} className="shrink-0 text-[#5b5fc7]" /><span className="truncate">{channel.name}</span></h3> : <span className="flex-1" />}
        <Button size="sm" variant="secondary" loading={ai.isPending} onClick={() => ai.mutate({ action: "channel_about", team_id: team.id, channel_id: channel.id })}>
          <SparkleIcon size={15} /> {t("What is happening here?")}
        </Button>
        {channel.url ? <Button size="sm" variant="ghost" asChild><a href={channel.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Teams")}</a></Button> : null}
      </div>
      {about != null ? <AiAnswer title={t("What is happening in {name}", { name: channel.name })} text={about} onClose={() => setAbout(null)} /> : null}
      <div ref={ref} onScroll={onScroll} className={cn("min-h-64 overflow-y-auto overscroll-contain pr-1", bare ? "h-[56dvh]" : "h-[calc(100dvh-24rem)] max-h-[48rem]")}>
        {posts.error instanceof ApiError && posts.error.code === "teams_channels_off" ? <p className="p-2 text-[13px] text-muted">{errorMessage(posts.error)}</p>
          : posts.isLoading ? <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          : posts.error ? <p role="alert" className="text-danger">{errorMessage(posts.error)}</p>
          : !posts.data?.length ? <p className="p-4 text-center text-[13px] text-muted">{t("No posts in this channel yet.")}</p>
          : <ol className="grid gap-3" aria-label={t("Posts")}>{posts.data.map((p) => <Post key={p.id} p={p} team={team} channel={channel} sendOk={sendOk} />)}</ol>}
      </div>
      {sendOk ? (
        <MessageComposer value={post} onChange={setPost} onSend={() => newPost.mutate()} sending={newPost.isPending} placeholder={t("Start a new post")} />
      ) : (
        <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">{t("Posting and replying here needs your Microsoft 365 admin to turn on Teams channel posting (Channels > Microsoft 365); then reconnect Microsoft. Until then, Ask AI and Open in Teams work.")}</p>
      )}
    </section>
  );
}

function Post({ p, team, channel, sendOk }: { p: TeamsPostThread; team: TeamsTeam; channel: TeamsChannel; sendOk: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [about, setAbout] = useState<string | null>(null);
  const shown = all ? p.replies : p.replies.slice(-2);
  const ai = useAskAi((r) => {
    if (r.action === "channel_about") setAbout(r.text ?? "");
    if (r.action === "channel_reply") { setText(r.body ?? ""); setReplying(true); }
  });
  const reply = useMutation({
    mutationFn: () => sendPost(team.id, channel.id, { text: text.trim(), reply_to: p.id }),
    onSuccess: () => { setText(""); setReplying(false); void qc.invalidateQueries({ queryKey: m365Keys.posts(team.id, channel.id) }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[0_1px_1px_rgba(0,0,0,0.04)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <PersonAvatar name={p.from || "?"} id={p.from_id} size="sm" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted">
            <b className="text-[13px] text-fg">{p.mine ? t("You") : p.from || t("Unknown")}</b>
            <time dateTime={p.at ?? undefined}>{p.at ? new Date(p.at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</time>
            {p.edited ? <span>{t("Edited")}</span> : null}
          </span>
          <Body m={p} />
          <Reactions m={p} className="mt-1" />
        </div>
      </div>
      {p.replies.length ? (
        <div className="grid gap-2 border-l-2 border-[#c5c7f5] pl-3 dark:border-[#4a4a7a]">
          {p.replies.length > 2 ? (
            <button type="button" className="hit justify-self-start text-[12.5px] font-medium text-[#4f52b2] hover:underline dark:text-[#a6a8f0]" onClick={() => setAll((a) => !a)}>
              {all ? t("Show fewer replies") : t("See all {n} replies", { n: p.replies.length })}
            </button>
          ) : null}
          {shown.map((r) => (
            <div key={r.id} className="flex min-w-0 items-start gap-2">
              <PersonAvatar name={r.from || "?"} id={r.from_id} size="xs" className="mt-0.5" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-muted">
                  <b className="text-[12.5px] text-fg">{r.mine ? t("You") : r.from || t("Unknown")}</b>
                  <time dateTime={r.at ?? undefined}>{clock(r.at)}</time>
                </span>
                <Body m={r} />
                <Reactions m={r} className="mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {about != null ? <AiAnswer title={t("About this thread")} text={about} onClose={() => setAbout(null)} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {sendOk ? <ReplyLink count={0} onClick={() => setReplying((r) => !r)} /> : null}
        <button type="button" className="hit inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg" disabled={ai.isPending}
          onClick={() => ai.mutate({ action: "channel_about", team_id: team.id, channel_id: channel.id, post_id: p.id })}>
          <SparkleIcon size={14} /> {t("What is this about?")}
        </button>
        <button type="button" className="hit inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg" disabled={ai.isPending}
          onClick={() => ai.mutate({ action: "channel_reply", team_id: team.id, channel_id: channel.id, post_id: p.id })}>
          <PencilSimpleLineIcon size={14} /> {t("Draft a reply with AI")}
        </button>
        {ai.isPending ? <span className="text-[12px] text-muted">{t("Thinking…")}</span> : null}
      </div>
      {replying || (text && !sendOk) ? (
        sendOk ? (
          <MessageComposer value={text} onChange={setText} onSend={() => reply.mutate()} sending={reply.isPending} placeholder={t("Reply in this thread")} />
        ) : (
          <div className="grid gap-1.5 rounded-sm bg-surface-2 p-2.5 text-[12.5px]">
            <p className="text-muted">{t("Your draft (copy it into Teams: posting from here is not turned on yet):")}</p>
            <p className="whitespace-pre-wrap">{text}</p>
          </div>
        )
      ) : null}
    </li>
  );
}

