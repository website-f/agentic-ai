/** P109 Outlook on the Microsoft 365 page: the person's own mail folders (live from Microsoft,
 * refreshed every minute and on the `mail.new` event), a reading pane, Reply / Reply all /
 * Forward / New email, attachments (download or save to my Files) and Ask AI (summary, a
 * reply draft in a tone, tasks). Desktop: list and reading pane side by side; phone: the
 * message opens over the list. */
import {
  ArrowBendDoubleUpLeftIcon,
  ArrowBendUpLeftIcon,
  ArrowBendUpRightIcon,
  ArrowSquareOutIcon,
  CheckSquareIcon,
  DownloadSimpleIcon,
  EnvelopeOpenIcon,
  EnvelopeSimpleIcon,
  FloppyDiskIcon,
  ImageIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperclipIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  SparkleIcon,
  TextAlignLeftIcon,
  TrayIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  attachmentUrl,
  fileSize,
  mailDocument,
  mailListQuery,
  mailQuery,
  markRead,
  moreMail,
  prefixed,
  saveAttachment,
  type MailFolder,
  type MailFull,
  type MailRow,
} from "@/lib/m365";
import { meQuery } from "@/lib/queries";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";

import { AiAnswer, DraftWithAi, useAskAi } from "./ai";
import { Composer, type ComposeStart } from "./compose";

const FOLDER_LABEL: Record<MailFolder, string> = {
  inbox: msg("Inbox"),
  sentitems: msg("Sent"),
  drafts: msg("Drafts"),
  archive: msg("Archive"),
};

export function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return d.toLocaleString(locale(), same ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });
}

export function OutlookInbox() {
  const t = useT();
  const wide = useMedia("(min-width: 1024px)");
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [unread, setUnread] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState<ComposeStart | null>(null);
  const [extra, setExtra] = useState<MailRow[]>([]);
  const [loaded, setLoaded] = useState<number | null | undefined>(undefined);
  const list = useQuery(mailListQuery(folder, search, unread));
  const next = loaded === undefined ? list.data?.next_skip ?? null : loaded;
  const reset = () => { setExtra([]); setLoaded(undefined); setOpenId(null); };
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(list.data?.items ?? []), ...extra].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [list.data, extra]);
  const more = useMutation({
    mutationFn: () => moreMail(folder, next ?? 0, unread),
    onSuccess: (p) => { setExtra((x) => [...x, ...p.items]); setLoaded(p.next_skip); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const listPane = (
    <div className="grid min-w-0 content-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<MailFolder> size="sm" label={t("Folder")} value={folder} onChange={(f) => { setFolder(f); reset(); }}
          className="min-w-0 flex-1 sm:flex-none" options={(["inbox", "sentitems", "drafts", "archive"] as MailFolder[]).map((f) => ({ value: f, label: t(FOLDER_LABEL[f]) }))} />
        <Button size="sm" onClick={() => setComposing({ mode: "new" })} className="max-sm:w-full"><PlusIcon size={15} weight="bold" /> {t("New email")}</Button>
      </div>
      <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); reset(); }}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("Search mail")}</span>
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value && search) { setSearch(""); reset(); } }} placeholder={t("Search mail")} className="pl-9" maxLength={200} />
        </label>
        <Button type="button" size="sm" variant={unread ? "secondary" : "ghost"} className="h-10" aria-pressed={unread} onClick={() => { setUnread((u) => !u); reset(); }}>
          <EnvelopeSimpleIcon size={15} /> {t("Unread")}
        </Button>
      </form>
      {list.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[4.5rem] rounded-[var(--radius-md)]" />)}</div>
      ) : list.error ? (
        <p role="alert" className="text-[13.5px] text-danger">{errorMessage(list.error)}</p>
      ) : !rows.length ? (
        <EmptyState icon={TrayIcon} title={search ? t("Nothing found") : t("No mail here")} body={search ? t("Try other words.") : t("New mail shows here as it arrives.")} />
      ) : (
        <ul className="grid divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface" aria-label={t(FOLDER_LABEL[folder])}>
          {rows.map((m) => <MailListRow key={m.id} m={m} folder={folder} active={openId === m.id} onOpen={() => setOpenId(m.id)} />)}
        </ul>
      )}
      {next != null && !search ? (
        <Button variant="ghost" size="sm" className="justify-self-center" loading={more.isPending} onClick={() => more.mutate()}>{t("Show older mail")}</Button>
      ) : null}
    </div>
  );

  const reader = openId ? <Reader key={openId} id={openId} onCompose={setComposing} onClose={() => setOpenId(null)} /> : null;
  const composer = composing ? (
    <SideSheet open onOpenChange={(o) => !o && setComposing(null)} size="lg"
      title={composing.mode === "new" ? t("New email") : composing.mode === "forward" ? t("Forward") : composing.mode === "reply_all" ? t("Reply all") : t("Reply")}
      description={t("From your own Outlook. Nothing is sent until you press Send.")}>
      <Composer start={composing} onDone={() => setComposing(null)} onCancel={() => setComposing(null)} />
    </SideSheet>
  ) : null;

  if (wide) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
        {listPane}
        <div className="sticky top-4 min-w-0">
          {reader ?? (
            <div className="grid min-h-80 place-items-center rounded-[var(--radius-md)] border border-dashed border-border p-8 text-center text-[13px] text-muted">
              <span className="grid justify-items-center gap-2"><EnvelopeOpenIcon size={28} className="text-muted/70" />{t("Pick an email to read it here.")}</span>
            </div>
          )}
        </div>
        {composer}
      </div>
    );
  }
  return (
    <>
      {listPane}
      {openId ? (
        <SideSheet open onOpenChange={(o) => !o && setOpenId(null)} size="lg" title={t("Email")}>
          {reader}
        </SideSheet>
      ) : null}
      {composer}
    </>
  );
}

function MailListRow({ m, folder, active, onOpen }: { m: MailRow; folder: MailFolder; active: boolean; onOpen: () => void }) {
  const t = useT();
  const who = folder === "sentitems" || folder === "drafts"
    ? m.to.map((x) => x.name || x.address).join(", ") || t("(no one yet)")
    : m.from.name || m.from.address;
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined}
        className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
          active && "bg-accent-soft/50 hover:bg-accent-soft/60")}>
        <PersonAvatar name={who || "?"} id={m.from.address} size="sm" className="mt-0.5" />
        <span className="grid min-w-0 gap-0.5">
          <span className={cn("truncate text-[13.5px]", !m.is_read && "font-semibold")}>
            {!m.is_read ? <span aria-label={t("Unread")} className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" /> : null}
            {who}
          </span>
          <span className={cn("truncate text-[13px]", !m.is_read ? "font-medium text-fg" : "text-fg/90")}>{m.subject || t("(no subject)")}</span>
          <span className="line-clamp-1 text-[12px] text-muted">{m.preview}</span>
        </span>
        <span className="grid justify-items-end gap-1 text-[11.5px] text-muted tabular">
          <time dateTime={m.received_at ?? undefined}>{when(m.received_at)}</time>
          <span className="flex items-center gap-1">
            {m.importance === "high" ? <WarningIcon size={13} className="text-danger" aria-label={t("Important")} /> : null}
            {m.has_attachments ? <PaperclipIcon size={13} aria-label={t("Has attachments")} /> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function Reader({ id, onCompose, onClose }: { id: string; onCompose: (c: ComposeStart) => void; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const msgQ = useQuery(mailQuery(id));
  const m = msgQ.data;
  const [images, setImages] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [tasks, setTasks] = useState<{ title: string; due: string | null }[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  useEffect(() => {
    if (m && !m.is_read) {
      markRead(m.id).then(() => void qc.invalidateQueries({ queryKey: ["mail", "m365", "list"] })).catch(() => undefined);
    }
  }, [m, qc]);
  const ai = useAskAi((r) => {
    if (r.action === "mail_summary") setSummary(r.text ?? "");
    if (r.action === "mail_tasks") setTasks(r.tasks ?? []);
    if (r.action === "mail_reply" && m) {
      setDrafting(false);
      onCompose({ mode: "reply", original: m, body: r.body ?? "" });
    }
  });

  if (msgQ.isLoading) return <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}<Skeleton className="h-64" /></div>;
  if (msgQ.error || !m) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(msgQ.error)}</p>;
  const hasImages = /<img\b/i.test(m.body_html);
  const files = m.attachments.filter((a) => !a.inline);
  const reply = (mode: "reply" | "reply_all") => onCompose({ mode, original: m, subject: prefixed("RE:", m.subject) });

  return (
    <article className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4" aria-label={m.subject || t("(no subject)")}>
      <header className="grid gap-2">
        <h3 className="text-[16px] font-semibold break-words">{m.subject || t("(no subject)")}</h3>
        <div className="flex min-w-0 items-start gap-3">
          <PersonAvatar name={m.from.name || m.from.address} id={m.from.address} size="md" />
          <div className="grid min-w-0 flex-1 gap-0.5 text-[12.5px]">
            <span className="min-w-0 break-words"><b className="text-[13.5px]">{m.from.name || m.from.address}</b> <span className="text-muted">&lt;{m.from.address}&gt;</span></span>
            <span className="min-w-0 break-words text-muted">{t("To")}: {m.to.map((x) => x.name || x.address).join(", ") || "-"}</span>
            {m.cc.length ? <span className="min-w-0 break-words text-muted">{t("Cc")}: {m.cc.map((x) => x.name || x.address).join(", ")}</span> : null}
          </div>
          <time className="shrink-0 text-[12px] text-muted tabular" dateTime={m.received_at ?? undefined}>
            {m.received_at ? new Date(m.received_at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
          </time>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reply("reply")}><ArrowBendUpLeftIcon size={15} /> {t("Reply")}</Button>
          <Button size="sm" variant="outline" onClick={() => reply("reply_all")}><ArrowBendDoubleUpLeftIcon size={15} /> {t("Reply all")}</Button>
          <Button size="sm" variant="outline" onClick={() => onCompose({ mode: "forward", original: m })}><ArrowBendUpRightIcon size={15} /> {t("Forward")}</Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="secondary" loading={ai.isPending}><SparkleIcon size={15} /> {t("Ask AI")}</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem icon={<TextAlignLeftIcon />} onSelect={() => ai.mutate({ action: "mail_summary", message_id: m.id })}>{t("Summarise this email")}</MenuItem>
              <MenuItem icon={<PencilSimpleLineIcon />} onSelect={() => setDrafting(true)}>{t("Draft a reply…")}</MenuItem>
              <MenuItem icon={<ListChecksIcon />} onSelect={() => ai.mutate({ action: "mail_tasks", message_id: m.id })}>{t("Find the tasks in it")}</MenuItem>
            </MenuContent>
          </Menu>
          {m.web_link ? <Button size="sm" variant="ghost" asChild><a href={m.web_link} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Outlook")}</a></Button> : null}
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={onClose}>{t("Back")}</Button>
        </div>
      </header>

      {drafting ? (
        <div className="grid gap-1.5">
          <p className="text-[12.5px] text-muted">{t("Your AI writes a reply for you to check. It opens in the reply box; nothing is sent until you press Send.")}</p>
          <DraftWithAi busy={ai.isPending} placeholder={t("What should the reply say? (optional)")}
            onDraft={({ tone, instructions }) => ai.mutate({ action: "mail_reply", message_id: m.id, tone, instructions })} />
        </div>
      ) : null}
      {summary != null ? <AiAnswer title={t("Summary")} text={summary} onClose={() => setSummary(null)} /> : null}
      {tasks != null ? <TaskList tasks={tasks} onClose={() => setTasks(null)} /> : null}

      {files.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("Attachments")}>
          {files.map((a) => <AttachmentChip key={a.id} m={m} a={a} />)}
        </ul>
      ) : null}

      {hasImages && !images ? (
        <p className="flex flex-wrap items-center gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
          <ImageIcon size={15} className="shrink-0" /> {t("Pictures from outside are hidden to protect your privacy.")}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setImages(true)}>{t("Show pictures")}</button>
        </p>
      ) : null}
      <iframe title={m.subject || t("Email")} sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={mailDocument(m.body_html, m.body_text, { images, dark })}
        className="h-[60vh] min-h-72 w-full rounded-sm border border-border bg-surface lg:h-[calc(100dvh-22rem)]" />
    </article>
  );
}

function AttachmentChip({ m, a }: { m: MailFull; a: MailFull["attachments"][number] }) {
  const t = useT();
  const save = useMutation({
    mutationFn: () => saveAttachment(m.id, a.id),
    onSuccess: (r) => toast.success(t("Saved in your Files: {folder}", { folder: r.folder })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-3 text-[12.5px]">
      <PaperclipIcon size={13} className="shrink-0 text-muted" />
      <span className="min-w-0 truncate">{a.name}</span>
      <span className="shrink-0 text-muted tabular">{fileSize(a.size)}</span>
      <a href={attachmentUrl(m.id, a.id)} download={a.name} aria-label={t("Download {name}", { name: a.name })}
        className="hit grid size-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg">
        <DownloadSimpleIcon size={15} />
      </a>
      <button type="button" aria-label={t("Save {name} to my Files", { name: a.name })} onClick={() => save.mutate()} disabled={save.isPending}
        className="hit grid size-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg disabled:opacity-50">
        <FloppyDiskIcon size={15} />
      </button>
    </li>
  );
}

function TaskList({ tasks, onClose }: { tasks: { title: string; due: string | null }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const add = useMutation({
    mutationFn: ({ i }: { i: number }) => {
      const task = tasks[i]!;
      return api("/api/tasks", "POST", {
        title: task.title,
        assignee_user_id: me.user.id,
        requires_review: false,
        ...(task.due ? { due_at: new Date(`${task.due}T17:00:00`).toISOString() } : {}),
      });
    },
    onSuccess: (_r, { i }) => { setAdded((s) => new Set(s).add(i)); void qc.invalidateQueries({ queryKey: workKeys.tasks }); toast.success(t("Task added.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <AiAnswer title={t("Tasks in this email")} text={tasks.length ? "" : t("No tasks found in this email.")} onClose={onClose}>
      {tasks.length ? (
        <ul className="grid gap-1.5">
          {tasks.map((x, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-sm bg-surface px-3 py-2 text-[13px]">
              <CheckSquareIcon size={15} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 break-words">{x.title}</span>
              {x.due ? <Pill>{t("Due {date}", { date: new Date(`${x.due}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" }) })}</Pill> : null}
              <Button size="sm" variant="outline" disabled={added.has(i)} loading={add.isPending && add.variables?.i === i} onClick={() => add.mutate({ i })}>
                {added.has(i) ? t("Added") : t("Add to my tasks")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </AiAnswer>
  );
}
