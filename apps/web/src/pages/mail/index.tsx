/** Mail (P34): what reached the person's Outlook and the company's shared mailboxes, and what
 * the AI did with each one (the task it made, the attachment it saved, the reply it drafted).
 * Live: the `mail.new` event refreshes the list at once, and it re-checks every minute.
 * P109: the Microsoft 365 page: Outlook (read, reply, forward, new email, Ask AI), Teams chats
 * and channels shown like Teams, the calendar, Teams Approvals, and other email accounts
 * (Connections: back up their attachments, then disconnect). Tabs: ?app=teams|calendar|
 * approvals|accounts (none: mail).
 * P109b: full screen at /m365 (./frame.tsx) with a Back to where the person came from (?from=),
 * its own tabs (bottom tabs on a phone) and "New Teams meeting" (./meeting.tsx; ?new=meeting
 * opens it, as the desk's tile does). */
import {
  AlarmIcon,
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  EnvelopeSimpleIcon,
  KanbanIcon,
  MicrosoftOutlookLogoIcon,
  MicrosoftTeamsLogoIcon,
  NewspaperIcon,
  PaperclipIcon,
  PencilSimpleLineIcon,
  SealCheckIcon,
  TrayIcon,
  UsersFourIcon,
  VideoCameraIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { safeFrom } from "@/components/chat/links";
import { EmptyState, IconTile, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { calendarDraftsQuery, draftsQuery } from "@/lib/assistants";
import { m365Keys, m365SummaryQuery, summaryKey } from "@/lib/m365";
import {
  actionLink,
  CATEGORY_CHIP,
  CATEGORY_TONE,
  isMissingApi,
  mailActivityQuery,
  mailboxesQuery,
  mailKeys,
  microsoftAccountQuery,
  microsoftConfigQuery,
  providerOf,
  startMicrosoftConnect,
  STATUS_LABEL,
  STATUS_TONE,
  WEBHOOK_LABEL,
  WEBHOOK_TONE,
  type MailAction,
  type MailActionKind,
  type MailActivity,
  type MailStatus,
  type SharedMailbox,
} from "@/lib/microsoft";
import { canAssist } from "@/lib/my-ai";
import { meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { CalendarDraftCard, DraftCard } from "@/pages/assistants";

import { AccountSwitcher } from "./account-switcher";
import { M365Frame, type FrameTab } from "./frame";
import { OutlookInbox } from "./inbox";
import { MeetingComposerHost, useMeetingComposer } from "./meeting";
import { MicrosoftAbilities, MissingServer, OutlookConnection, useMsReturn } from "./outlook";
import { TeamsPanel } from "./teams";

// P109: the heavier tabs load when opened.
const OutlookCalendar = lazy(() => import("./calendar").then((m) => ({ default: m.OutlookCalendar })));
const TeamsApprovals = lazy(() => import("./approvals").then((m) => ({ default: m.TeamsApprovals })));
const OtherEmailAccounts = lazy(() => import("./accounts").then((m) => ({ default: m.OtherEmailAccounts })));

type M365App = "mail" | "teams" | "calendar" | "approvals" | "accounts";
const APPS: M365App[] = ["mail", "teams", "calendar", "approvals", "accounts"];
const tabFallback = <Skeleton className="h-64 rounded-[var(--radius-md)]" />;

const ACTION_ICON: Record<MailActionKind, Icon> = {
  task: KanbanIcon,
  attachment_saved: PaperclipIcon,
  draft: PencilSimpleLineIcon,
  follow_up: AlarmIcon,
  digest: NewspaperIcon,
};

type Filter = "all" | MailStatus;
const FILTERS: Filter[] = ["all", "new", "pending", "processed", "ignored", "failed"];

/** Back: to where the workspace was opened from (?from=), else one step back, else My workspace. */
function useBack(from: string | undefined) {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(() => {
    const to = safeFrom(from);
    if (to) void navigate({ href: to, replace: true });
    else if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/workspace" });
  }, [from, navigate, router]);
}

export function MailPage() {
  const t = useT();
  const qc = useQueryClient();
  const search = useSearch({ from: "/m365" });
  const navigate = useNavigate({ from: "/m365" });
  const { data: me } = useQuery(meQuery);
  const perms = me?.permissions ?? [];
  const assist = canAssist(perms);
  const canManage = perms.includes("channels.manage");
  const back = useBack(search.from);
  const clearMs = useCallback(() => void navigate({ search: (s) => ({ ...s, ms: undefined, msg: undefined }), replace: true }), [navigate]);
  useMsReturn(search, clearMs);

  const config = useQuery(microsoftConfigQuery);
  const configured = !!config.data?.configured;
  const account = useQuery({ ...microsoftAccountQuery, enabled: configured });
  const connected = !!account.data?.connected && account.data.status !== "reconnect_needed";
  const summary = useQuery(m365SummaryQuery(connected));
  // Shared mailboxes this person may see (the server scopes the list); none when not allowed.
  const boxes = useQuery({ ...mailboxesQuery, enabled: configured });
  const shared = useMemo(() => (boxes.error ? [] : boxes.data ?? []), [boxes.data, boxes.error]);
  const box = search.box && shared.some((b) => b.id === search.box) ? search.box : "personal";
  const current = shared.find((b) => b.id === box) ?? null;
  const setBox = (v: string) => void navigate({ search: (s) => ({ ...s, box: v === "personal" ? undefined : v }), replace: true });

  const ready = configured && (box !== "personal" || !!account.data?.connected);
  const activity = useQuery({ ...mailActivityQuery(box), enabled: ready });
  const [filter, setFilter] = useState<Filter>("all");
  const items = useMemo(() => activity.data ?? [], [activity.data]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, new: 0, pending: 0, processed: 0, ignored: 0, failed: 0 };
    for (const m of items) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((m) => m.status === filter);

  const options = [{ value: "personal", label: t("My Outlook") }, ...shared.map((b) => ({ value: b.id, label: b.display_name || b.address }))];
  const app: M365App = APPS.includes(search.app as M365App) ? (search.app as M365App) : "mail";
  const setApp = (v: M365App) => void navigate({ search: (s) => ({ ...s, app: v === "mail" ? undefined : v }), replace: true });
  // P109: Outlook itself (live from Microsoft), or what the AI did with each mail.
  const [mailView, setMailView] = useState<"inbox" | "activity">("inbox");
  const personalOk = box === "personal" && connected;
  const sum = summary.data;
  const tabs: FrameTab<M365App>[] = [
    { value: "mail", label: t("Outlook"), icon: EnvelopeSimpleIcon, count: sum?.unread_mail },
    { value: "teams", label: "Teams", icon: MicrosoftTeamsLogoIcon, count: sum?.unread_chats },
    { value: "calendar", label: t("Calendar"), icon: CalendarBlankIcon },
    { value: "approvals", label: t("Approvals"), icon: SealCheckIcon, count: sum?.approvals_pending },
    { value: "accounts", label: t("Other email"), icon: TrayIcon },
  ];

  // P109b: "New Teams meeting" from the desk's tile (?new=meeting) opens the composer once.
  const openMeeting = useMeetingComposer((st) => st.open);
  useEffect(() => {
    if (search.new !== "meeting" || !connected) return;
    openMeeting();
    void navigate({ search: (x) => ({ ...x, new: undefined }), replace: true });
  }, [search.new, connected, openMeeting, navigate]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: m365Keys.all });
    void qc.invalidateQueries({ queryKey: mailKeys.all });
    void qc.invalidateQueries({ queryKey: summaryKey });
  };

  const actions = connected ? (
    <>
      <Button size="sm" onClick={() => openMeeting()} className="max-sm:size-11 max-sm:px-0" aria-label={t("New Teams meeting")} title={t("New Teams meeting")}>
        <VideoCameraIcon size={16} /> <span className="max-sm:sr-only">{t("New Teams meeting")}</span>
      </Button>
      <Button size="icon" variant="ghost" aria-label={t("Refresh")} title={t("Refresh")} onClick={refresh}><ArrowsClockwiseIcon size={17} /></Button>
    </>
  ) : null;

  return (
    <M365Frame title={t("Microsoft 365")} tabs={tabs} value={app} onChange={setApp} onBack={back} actions={actions}
      switcher={connected ? <AccountSwitcher /> : null}>
      {config.isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        : config.error ? (isMissingApi(config.error) ? <MissingServer /> : <ErrorLine error={config.error} onRetry={() => void config.refetch()} />)
        : !configured ? (
          app === "accounts" ? <Suspense fallback={tabFallback}><OtherEmailAccounts /></Suspense> : (
            <EmptyState icon={MicrosoftOutlookLogoIcon} title={t("Microsoft 365 is not set up yet")}
              body={config.data?.can_configure
                ? t("Register the office's app in Microsoft Entra once (Channels > Microsoft 365). Then everyone connects their own Outlook, and you can add shared mailboxes like accounts@ or tender@.")
                : t("Ask an admin to set up Microsoft 365. Then you can connect your Outlook here and see what your AI does with your mail.")}
              action={config.data?.can_configure ? <Button asChild><Link to="/channels">{t("Open Channels")}</Link></Button> : undefined} />
          )
        ) : (
          <>
            {/* P102: what is connected and what the AI may do, then what waits for a yes. */}
            {app === "mail" && connected && account.data ? <MicrosoftAbilities account={account.data} /> : null}
            {app === "mail" || app === "teams" ? <WaitingDrafts assist={assist} /> : null}
            {app === "teams" ? <NeedsOutlook><TeamsPanel /></NeedsOutlook>
              : app === "calendar" ? <NeedsOutlook><Suspense fallback={tabFallback}><OutlookCalendar /></Suspense></NeedsOutlook>
              : app === "approvals" ? <NeedsOutlook><Suspense fallback={tabFallback}><TeamsApprovals /></Suspense></NeedsOutlook>
              : app === "accounts" ? <Suspense fallback={tabFallback}><OtherEmailAccounts /></Suspense>
              : <>
            {options.length > 1 ? (
              options.length <= 4 ? (
                <Segmented label={t("Mailbox")} value={box} onChange={setBox} className="w-full sm:w-fit" options={options} />
              ) : (
                <div className="grid gap-1.5 sm:max-w-sm">
                  <span className="text-[13px] font-medium">{t("Mailbox")}</span>
                  <Select value={box} onValueChange={setBox} label={t("Mailbox")} options={options} />
                </div>
              )
            ) : null}

            {box === "personal" ? <PersonalMailbox /> : current ? <SharedStatus box={current} /> : null}

            {personalOk ? (
              <Segmented<"inbox" | "activity"> size="sm" label={t("View")} value={mailView} onChange={setMailView} className="w-full sm:w-fit [&>button]:flex-1"
                options={[{ value: "inbox", label: t("My mail") }, { value: "activity", label: t("What my AI did") }]} />
            ) : null}
            {personalOk && mailView === "inbox" ? <OutlookInbox /> : !ready ? null : (
              <Section title={t("Recent mail")} description={t("Newest first. Chips show what the AI did; open one to see the task, the file or the draft.")}
                actions={items.length ? (
                  <Segmented<Filter> size="sm" label={t("Which mail")} value={filter} onChange={setFilter} className="w-full sm:w-fit"
                    options={FILTERS.map((f) => ({ value: f, label: f === "all" ? t("All") : t(STATUS_LABEL[f]), count: counts[f] }))} />
                ) : null}>
                {activity.isLoading ? (
                  <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>
                ) : activity.error ? (
                  isMissingApi(activity.error) ? <MissingServer /> : <ErrorLine error={activity.error} onRetry={() => void activity.refetch()} />
                ) : !items.length ? (
                  <EmptyState icon={TrayIcon} title={t("No mail yet")}
                    body={box === "personal"
                      ? (account.data?.webhooks === "live" ? t("New mail shows here a few seconds after it reaches your Outlook.") : t("New mail shows here within a few minutes of reaching your Outlook."))
                      : t("New mail to {address} shows here once the office has checked the mailbox.", { address: current?.address ?? "" })} />
                ) : !shown.length ? (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">{t("Nothing in this view.")}</p>
                ) : (
                  <ListCard>{shown.map((m) => <MailRow key={m.id} m={m} assist={assist} />)}</ListCard>
                )}
              </Section>
            )}

            </>}
            {!shared.length && canManage && app === "mail" ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                <UsersFourIcon size={15} className="shrink-0" /> {t("Shared mailboxes (accounts@, tender@) are added on Channels > Microsoft 365.")}
                <Link to="/channels" className="font-medium text-accent hover:underline">{t("Open Channels")}</Link>
              </p>
            ) : null}
          </>
        )}
      <MeetingComposerHost />
    </M365Frame>
  );
}

/** An error with a way to try again. */
function ErrorLine({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/6 px-4 py-3 text-[13.5px] text-danger">
      <span className="min-w-0 flex-1 break-words">{errorMessage(error)}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>{t("Try again")}</Button>
    </div>
  );
}

/** P109: a tab that reads the person's own Outlook: connect it first. */
function NeedsOutlook({ children }: { children: React.ReactNode }) {
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  if (account.isLoading) return tabFallback;
  if (!account.data?.connected || account.data.status === "reconnect_needed") return <PersonalMailbox />;
  return <>{children}</>;
}

/** My Outlook: connect it (empty state), or its status line when connected. */
function PersonalMailbox() {
  const t = useT();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  const connect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (account.isLoading) return <Skeleton className="h-20 rounded-[var(--radius-md)]" />;
  if (account.error) return isMissingApi(account.error) ? <MissingServer /> : <p role="alert" className="text-[13.5px] text-danger">{errorMessage(account.error)}</p>;
  if (!account.data?.connected) {
    return (
      <EmptyState icon={MicrosoftOutlookLogoIcon} title={t("Connect your Outlook")}
        body={t("Your AI then reads new mail as it arrives, sorts it, turns invoices and requests into tasks, saves attachments and drafts replies. Nothing is sent until you approve it.")}
        action={<Button loading={connect.isPending} onClick={() => connect.mutate()}><MicrosoftOutlookLogoIcon size={16} weight="bold" /> {t("Connect Outlook")}</Button>} />
    );
  }
  if (account.data.status === "reconnect_needed") return <OutlookConnection />;
  return null; // connected: the summary on top says so (MicrosoftAbilities)
}

function SharedStatus({ box }: { box: SharedMailbox }) {
  const t = useT();
  const bad = box.status === "error";
  const paused = box.status === "paused";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border px-4 py-3 text-[12.5px]", bad ? "border-warn/30 bg-warn/6" : "border-border bg-surface")}>
      <IconTile icon={UsersFourIcon} size="sm" tone={bad ? "warn" : "info"} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13.5px] font-medium break-all">{box.address}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted sm:gap-x-1.5">
          <Meta items={[
            box.branch_name,
            box.agent_name ? t("Handled by {name}", { name: box.agent_name }) : t("No agent assigned"),
            <Pill key="w" tone={WEBHOOK_TONE[box.webhooks]} live={box.webhooks === "live"} className="py-0 text-[11.5px]">{t(WEBHOOK_LABEL[box.webhooks])}</Pill>,
            box.last_sync_at ? t("Synced {ago}", { ago: timeAgo(box.last_sync_at).toLowerCase() }) : t("Not checked yet"),
          ]} />
        </span>
      </div>
      {bad ? <Pill tone="warn">{t("Needs attention")}</Pill> : paused ? <Pill>{t("Paused")}</Pill> : null}
      {bad && box.last_error ? <p className="w-full text-[12.5px] break-words text-danger">{box.last_error}</p> : null}
    </div>
  );
}

/** Emails and Teams messages the AI drafted, and calendar changes it proposed, waiting for the
 * person (the same cards as My assistants). P102: Teams messages too, on both tabs. */
function WaitingDrafts({ assist }: { assist: boolean }) {
  const t = useT();
  const drafts = useQuery({ ...draftsQuery("pending"), retry: false });
  const events = useQuery({ ...calendarDraftsQuery("pending"), retry: false });
  const mail = (drafts.data ?? []).filter((d) => providerOf(d) !== "google");
  const cal = (events.data ?? []).filter((d) => providerOf(d) === "microsoft");
  if (!mail.length && !cal.length) return null;
  // Grouped by mailbox: a person's own Outlook, and each shared mailbox they approve for.
  const labels = [...new Set([...mail, ...cal].map((d) => d.mailbox_label ?? ""))];
  return (
    <Section guide="mail.drafts" title={<span id="mail-drafts" className="scroll-mt-20">{t("Waiting for your approval")}</span>}
      description={t("Emails, Teams messages and calendar changes your AI prepared. Read each one, change it if you like, then press Send or Confirm. Nothing is sent or booked until you do.")}
      actions={assist ? <Link to="/assistants" search={{ tab: "drafts" }} className="text-[13px] text-accent hover:underline">{t("All drafts")} →</Link> : null}>
      <div className="grid gap-4">
        {labels.map((label) => (
          <div key={label || "-"} className="grid gap-3">
            {labels.length > 1 && label ? <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</p> : null}
            {mail.filter((d) => (d.mailbox_label ?? "") === label).map((d) => <DraftCard key={d.id} d={d} />)}
            {cal.filter((d) => (d.mailbox_label ?? "") === label).map((d) => <CalendarDraftCard key={d.id} d={d} />)}
          </div>
        ))}
      </div>
    </Section>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return d.toLocaleString(locale(), same ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function MailRow({ m, assist }: { m: MailActivity; assist: boolean }) {
  const t = useT();
  const from = m.from_name || m.from_address;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <IconTile icon={m.has_attachments ? PaperclipIcon : EnvelopeSimpleIcon} size="sm" tone={m.status === "failed" ? "danger" : m.status === "new" ? "info" : "neutral"} />
      <div className="grid min-w-0 gap-1">
        <p className="min-w-0 text-[14px] font-medium break-words">{m.subject || t("(no subject)")}</p>
        {m.summary ? <p className="min-w-0 text-[13px] break-words text-fg/85">{m.summary}</p> : null}
        {m.needs_person || m.due_at || m.answered_at ? (
          <p className="flex flex-wrap items-center gap-1.5">
            {m.needs_person && !m.answered_at ? <Pill tone="warn">{t("Needs you")}</Pill> : null}
            {m.due_at ? <Pill>{t("Due {date}", { date: when(m.due_at) })}</Pill> : null}
            {m.answered_at ? <Pill tone="ok">{t("Replied")}</Pill> : null}
          </p>
        ) : null}
        <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted sm:gap-x-1.5">
          <Meta items={[
            <span key="f" className="min-w-0 break-all" title={m.from_address}>{from}{m.from_name ? <span className="text-muted/80"> &lt;{m.from_address}&gt;</span> : null}</span>,
            m.mailbox_label,
          ]} />
        </p>
        {m.actions.length || m.category ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {m.category ? <Pill tone={CATEGORY_TONE[m.category] ?? "neutral"}>{t(CATEGORY_CHIP[m.category] ?? m.category)}</Pill> : null}
            {m.actions.map((a, i) => <ActionChip key={i} a={a} assist={assist} />)}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 max-sm:col-start-2 sm:flex-col sm:items-end sm:gap-1">
        <time dateTime={m.received_at} title={timeAgo(m.received_at)} className="text-[12.5px] whitespace-nowrap text-muted tabular">{when(m.received_at)}</time>
        <Pill tone={STATUS_TONE[m.status] ?? "neutral"}>{t(STATUS_LABEL[m.status] ?? m.status)}</Pill>
      </div>
    </li>
  );
}

function ActionChip({ a, assist }: { a: MailAction; assist: boolean }) {
  const IconCmp = ACTION_ICON[a.kind] ?? KanbanIcon;
  const link = actionLink(a, assist);
  const cls = "inline-flex max-w-full min-h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12px]";
  const inner = <><IconCmp size={13} className="shrink-0 text-accent" /><span className="min-w-0 truncate">{a.label}</span></>;
  if (!link) return <span className={cn(cls, "text-muted")}>{inner}</span>;
  if ("hash" in link) return <a href={`#${link.hash}`} className={cn(cls, "hover:border-accent/50 hover:text-accent")}>{inner}</a>;
  return <Link {...link} className={cn(cls, "hover:border-accent/50 hover:text-accent")}>{inner}</Link>;
}
