/** Mail (P34): what reached the person's Outlook and the company's shared mailboxes, and what
 * the AI did with each one (the task it made, the attachment it saved, the reply it drafted).
 * Live: the `mail.new` event refreshes the list at once, and it re-checks every minute. */
import {
  AlarmIcon,
  ArrowsClockwiseIcon,
  EnvelopeSimpleIcon,
  KanbanIcon,
  MicrosoftOutlookLogoIcon,
  NewspaperIcon,
  PaperclipIcon,
  PencilSimpleLineIcon,
  TrayIcon,
  UsersFourIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { calendarDraftsQuery, draftsQuery } from "@/lib/assistants";
import {
  actionLink,
  CATEGORY_CHIP,
  CATEGORY_TONE,
  isMissingApi,
  mailActivityQuery,
  mailboxesQuery,
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

import { accountMeta, MissingServer, OutlookConnection, useMsReturn } from "./outlook";

const ACTION_ICON: Record<MailActionKind, Icon> = {
  task: KanbanIcon,
  attachment_saved: PaperclipIcon,
  draft: PencilSimpleLineIcon,
  follow_up: AlarmIcon,
  digest: NewspaperIcon,
};

type Filter = "all" | MailStatus;
const FILTERS: Filter[] = ["all", "new", "pending", "processed", "ignored", "failed"];

export function MailPage() {
  const t = useT();
  const search = useSearch({ from: "/app/mail" });
  const navigate = useNavigate({ from: "/mail" });
  const { data: me } = useSuspenseQuery(meQuery);
  const assist = canAssist(me.permissions);
  const canManage = me.permissions.includes("channels.manage");
  const clearMs = useCallback(() => void navigate({ search: (s) => ({ ...s, ms: undefined, msg: undefined }), replace: true }), [navigate]);
  useMsReturn(search, clearMs);

  const config = useQuery(microsoftConfigQuery);
  const configured = !!config.data?.configured;
  const account = useQuery({ ...microsoftAccountQuery, enabled: configured });
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

  return (
    <Page>
      <PageHeader
        title={t("Mail")}
        description={t("What reached your Outlook and the company's shared mailboxes, and what the AI did with each.")}
        actions={ready ? (
          <Button variant="outline" size="sm" loading={activity.isFetching && !activity.isLoading} onClick={() => void activity.refetch()}>
            <ArrowsClockwiseIcon size={15} /> {t("Refresh")}
          </Button>
        ) : null}
      />

      {config.isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        : config.error ? (isMissingApi(config.error) ? <MissingServer /> : <p role="alert" className="text-[13.5px] text-danger">{errorMessage(config.error)}</p>)
        : !configured ? (
          <EmptyState icon={MicrosoftOutlookLogoIcon} title={t("Microsoft 365 is not set up yet")}
            body={config.data?.can_configure
              ? t("Register the office's app in Microsoft Entra once (Channels > Microsoft 365). Then everyone connects their own Outlook, and you can add shared mailboxes like accounts@ or tender@.")
              : t("Ask an admin to set up Microsoft 365. Then you can connect your Outlook here and see what your AI does with your mail.")}
            action={config.data?.can_configure ? <Button asChild><Link to="/channels">{t("Open Channels")}</Link></Button> : undefined} />
        ) : (
          <>
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

            {box === "personal" && account.data?.connected ? <WaitingDrafts assist={assist} /> : null}

            {!ready ? null : (
              <Section title={t("Recent mail")} description={t("Newest first. Chips show what the AI did; open one to see the task, the file or the draft.")}
                actions={items.length ? (
                  <Segmented<Filter> size="sm" label={t("Which mail")} value={filter} onChange={setFilter}
                    options={FILTERS.map((f) => ({ value: f, label: f === "all" ? t("All") : t(STATUS_LABEL[f]), count: counts[f] }))} />
                ) : null}>
                {activity.isLoading ? (
                  <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>
                ) : activity.error ? (
                  isMissingApi(activity.error) ? <MissingServer /> : <p role="alert" className="text-[13.5px] text-danger">{errorMessage(activity.error)}</p>
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

            {!shared.length && canManage ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                <UsersFourIcon size={15} className="shrink-0" /> {t("Shared mailboxes (accounts@, tender@) are added on Channels > Microsoft 365.")}
                <Link to="/channels" className="font-medium text-accent hover:underline">{t("Open Channels")}</Link>
              </p>
            ) : null}
          </>
        )}
    </Page>
  );
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
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted sm:gap-x-1.5">
      <MicrosoftOutlookLogoIcon size={16} weight="duotone" className="shrink-0 text-info" />
      <Meta items={accountMeta(account.data, t)} />
    </p>
  );
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

/** Replies the AI drafted in Outlook, waiting for the person (the same cards as My assistants). */
function WaitingDrafts({ assist }: { assist: boolean }) {
  const t = useT();
  const drafts = useQuery({ ...draftsQuery("pending"), retry: false });
  const events = useQuery({ ...calendarDraftsQuery("pending"), retry: false });
  const mail = (drafts.data ?? []).filter((d) => providerOf(d) === "microsoft");
  const cal = (events.data ?? []).filter((d) => providerOf(d) === "microsoft");
  if (!mail.length && !cal.length) return null;
  // Grouped by mailbox: a person's own Outlook, and each shared mailbox they approve for.
  const labels = [...new Set([...mail, ...cal].map((d) => d.mailbox_label ?? ""))];
  return (
    <Section guide="mail.drafts" title={<span id="mail-drafts" className="scroll-mt-20">{t("Waiting for your approval")}</span>}
      description={t("Replies and calendar changes the AI prepared in Outlook. Nothing is sent or booked until you approve it.")}
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
