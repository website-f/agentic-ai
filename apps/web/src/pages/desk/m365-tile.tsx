/** P109b the Microsoft 365 tile on My workspace (Fitri, 17 Nov 2026: "put it in My workspace as
 * well, and when clicked do a full screen page"): unread mail, the next meeting (with Join),
 * unread Teams chats and approvals waiting (when they are turned on); "Connect Microsoft" when
 * the person has not connected yet. Opens the full-screen workspace (/m365) with a Back here.
 * Shown only to people who may use Microsoft 365 here, once it is set up. */
import {
  ArrowRightIcon,
  CalendarBlankIcon,
  EnvelopeSimpleIcon,
  MicrosoftOutlookLogoIcon,
  MicrosoftTeamsLogoIcon,
  SealCheckIcon,
  VideoCameraIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { m365SummaryQuery, type M365Summary } from "@/lib/m365";
import { microsoftConfigQuery, startMicrosoftConnect } from "@/lib/microsoft";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MAIL_PERMS = ["agents.own", "assistants.use", "channels.manage"];

/** Whether the tile shows for this person: they may open Microsoft 365 here and it is set up. */
export function useM365Tile(): boolean {
  const { data: me } = useQuery(meQuery);
  const may = MAIL_PERMS.some((p) => me?.permissions.includes(p));
  const config = useQuery({ ...microsoftConfigQuery, enabled: may });
  return may && !!config.data?.configured;
}

const FROM = "/workspace";

export function M365Tile() {
  const t = useT();
  const q = useQuery(m365SummaryQuery());
  const connect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data;
  return (
    <section aria-label={t("Microsoft 365")} data-guide="desk.m365">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <MicrosoftOutlookLogoIcon size={18} className="shrink-0 text-accent" weight="duotone" />
          <span className="truncate">{t("Microsoft 365")}</span>
        </h2>
        <Link to="/m365" search={{ from: FROM }} className="hit inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
          {t("Open full screen")} <ArrowRightIcon size={13} />
        </Link>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-28 rounded-[var(--radius-lg)]" />
      ) : q.error || !s ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 text-[13px] text-muted">
          <span className="min-w-0 flex-1">{q.error ? errorMessage(q.error) : t("Microsoft 365 could not be read just now.")}</span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>{t("Try again")}</Button>
        </div>
      ) : !s.connected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-4">
          <MicrosoftOutlookLogoIcon size={28} weight="duotone" className="shrink-0 text-[#0f6cbd]" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-[14px] font-medium">{s.status === "reconnect_needed" ? t("Reconnect Microsoft 365") : t("Connect Microsoft 365")}</span>
            <span className="text-[12.5px] text-muted">{t("Your Outlook mail, calendar and Teams chats here, and Teams meetings set up with AI.")}</span>
          </div>
          <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()} className="max-sm:w-full">
            {s.status === "reconnect_needed" ? t("Reconnect Microsoft") : t("Connect Microsoft")}
          </Button>
        </div>
      ) : (
        <Connected s={s} />
      )}
    </section>
  );
}

function Connected({ s }: { s: M365Summary }) {
  const t = useT();
  const next = s.next_meeting;
  const stats: { key: string; icon: Icon; label: string; value: number | null; app?: "teams" | "approvals" }[] = [
    { key: "mail", icon: EnvelopeSimpleIcon, label: t("Unread mail"), value: s.unread_mail },
    { key: "chats", icon: MicrosoftTeamsLogoIcon, label: t("Unread chats"), value: s.unread_chats, app: "teams" },
    ...(s.approvals_pending != null ? [{ key: "approvals", icon: SealCheckIcon, label: t("Approvals waiting"), value: s.approvals_pending, app: "approvals" as const }] : []),
  ];
  return (
    <div className="grid min-w-0 gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:p-4">
      <div className="grid min-w-0 content-start gap-2 rounded-[var(--radius-md)] bg-surface-2/60 p-3">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted"><CalendarBlankIcon size={14} /> {t("Next meeting")}</span>
        {next ? (
          <>
            <Link to="/m365" search={{ from: FROM, app: "calendar" }} className="min-w-0 rounded-sm text-[14.5px] font-semibold break-words hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none">
              {next.subject}
            </Link>
            <span className="text-[12.5px] text-muted tabular">{meetingWhen(t, next.start, next.end)}</span>
            {next.join_url ? (
              <Button asChild size="sm" className="w-fit bg-[#5b5fc7] text-white hover:brightness-110">
                <a href={next.join_url} target="_blank" rel="noreferrer noopener"><VideoCameraIcon size={15} /> {t("Join")}</a>
              </Button>
            ) : null}
          </>
        ) : (
          <span className="text-[13px] text-muted">{t("Nothing in the next 7 days.")}</span>
        )}
      </div>
      <div className="grid min-w-0 content-start gap-2">
        <ul className="grid gap-1.5">
          {stats.map((x) => (
            <li key={x.key}>
              <Link to="/m365" search={{ from: FROM, ...(x.app ? { app: x.app } : {}) }}
                className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-[13.5px] transition-colors hover:border-accent/40 hover:bg-accent-soft/30 focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none">
                <x.icon size={17} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
                <span className={cn("shrink-0 rounded-full px-2 text-[12.5px] font-semibold tabular", x.value ? "bg-accent text-accent-fg" : "text-muted")}>
                  {x.value == null ? "–" : x.value}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link to="/m365" search={{ from: FROM, app: "calendar", new: "meeting" }}><VideoCameraIcon size={15} /> {t("New Teams meeting")}</Link>
        </Button>
      </div>
    </div>
  );
}

function meetingWhen(t: ReturnType<typeof useT>, start: string | null, end: string | null): string {
  if (!start) return "";
  const a = new Date(start);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const hm = (d: Date) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const range = `${hm(a)}${end ? `–${hm(new Date(end))}` : ""}`;
  if (a.toDateString() === now.toDateString()) return t("Today {time}", { time: range });
  if (a.toDateString() === tomorrow.toDateString()) return t("Tomorrow {time}", { time: range });
  return `${a.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })}, ${range}`;
}
