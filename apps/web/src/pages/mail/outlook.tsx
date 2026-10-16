/** P34: a person's own Outlook (Microsoft 365 mail + calendar), shown where Gmail is: My AI,
 * My assistants (Settings > Connections), Channels and the Mail page. Mirrors "Connect Gmail":
 * a status line, a reconnect banner when Microsoft stopped accepting the connection, and
 * Disconnect behind a confirmation. Connecting is a full-page trip to Microsoft and back
 * (?ms=connected|error&msg=…), which `useMsReturn` turns into a toast. */
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  InfoIcon,
  LinkBreakIcon,
  MicrosoftOutlookLogoIcon,
  PlugsIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { assistantKeys } from "@/lib/assistants";
import {
  CATEGORY_LABEL,
  disconnectMicrosoft,
  isMissingApi,
  mailKeys,
  microsoftAccountQuery,
  microsoftConfigQuery,
  microsoftKeys,
  microsoftPrefsQuery,
  needsReconnect,
  readMsReturn,
  saveMicrosoftPrefs,
  startMicrosoftConnect,
  TASK_CATEGORIES,
  WEBHOOK_LABEL,
  WEBHOOK_TONE,
  type MailboxRules,
  type MicrosoftAccount,
  type TaskCategory,
} from "@/lib/microsoft";
import { cn, timeAgo } from "@/lib/utils";

/** P34: what the person's own AI does with their Outlook. Off by default except the daily
 * report: it makes tasks only for the kinds of mail the person ticks. */
function OutlookPrefs() {
  const t = useT();
  const qc = useQueryClient();
  const prefs = useQuery(microsoftPrefsQuery);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MailboxRules | null>(null);
  const rules = draft ?? prefs.data ?? null;
  const save = useMutation({
    mutationFn: (r: MailboxRules) => saveMicrosoftPrefs(r),
    onSuccess: (r) => {
      qc.setQueryData(microsoftPrefsQuery.queryKey, r);
      setDraft(null);
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (prefs.error || !rules) return null; // an older server without prefs: nothing to show
  const set = (fn: (r: MailboxRules) => MailboxRules) => setDraft(fn(rules));
  const toggle = (c: TaskCategory) =>
    set((r) => ({ ...r, create_tasks_for: r.create_tasks_for.includes(c) ? r.create_tasks_for.filter((x) => x !== c) : [...r.create_tasks_for, c] }));
  const timeBad = rules.digest.enabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(rules.digest.time);
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-9 items-center justify-between gap-2 text-left text-[13.5px] font-medium">
        <span>{t("What your AI does with your mail")}</span>
        <span className="text-[12.5px] font-normal text-muted">
          {rules.digest.enabled ? t("Daily report at {time}", { time: rules.digest.time }) : t("No daily report")}
          {rules.create_tasks_for.length ? ` · ${t("Tasks: {list}", { list: rules.create_tasks_for.map((c) => t(CATEGORY_LABEL[c]).toLowerCase()).join(", ") })}` : ""}
        </span>
      </button>
      {open ? (
        <div className="grid gap-3">
          <SwitchField checked={rules.digest.enabled} onCheckedChange={(v) => set((r) => ({ ...r, digest: { ...r.digest, enabled: v } }))}
            label={t("Daily report")} hint={t("One summary of yesterday's mail: what needs you, what waits for a reply, what your AI did.")} />
          {rules.digest.enabled ? (
            <div className="grid max-w-48 gap-1.5">
              <span className="text-[13px] font-medium">{t("Report time")}</span>
              <Input type="time" value={rules.digest.time} aria-label={t("Report time")}
                onChange={(e) => set((r) => ({ ...r, digest: { ...r.digest, time: e.target.value } }))} />
            </div>
          ) : null}
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">{t("Make a task for my AI when mail is a")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {TASK_CATEGORIES.map((c) => {
                const on = rules.create_tasks_for.includes(c);
                return (
                  <Button key={c} type="button" size="sm" variant={on ? "primary" : "outline"} aria-pressed={on} onClick={() => toggle(c)}>
                    {on ? <CheckCircleIcon size={14} weight="fill" /> : null} {t(CATEGORY_LABEL[c])}
                  </Button>
                );
              })}
            </div>
            <p className="text-[12px] text-muted">{t("Nothing ticked: your AI only flags mail and lists it in the report.")}</p>
          </fieldset>
          <SwitchField checked={rules.save_attachments} onCheckedChange={(v) => set((r) => ({ ...r, save_attachments: v }))}
            label={t("Save attachments to my workspace")} hint={t("Into My workspace > Email attachments, checked for passwords and IDs like every upload.")} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!draft || timeBad} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>{t("Save")}</Button>
            {draft ? <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("Cancel")}</Button> : null}
            {timeBad ? <span className="text-[12.5px] text-danger">{t("Use a time like 08:00.")}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Back from Microsoft sign-in: one toast, fresh status, and the ?ms= params cleared. */
export function useMsReturn(search: Record<string, unknown>, clear: () => void, param: "ms" | "ms_admin" = "ms") {
  const t = useT();
  const qc = useQueryClient();
  const done = useRef<string | null>(null);
  useEffect(() => {
    const back = readMsReturn(search, param);
    const key = back ? `${back.ok}|${back.message ?? ""}` : null;
    if (!back || !key || done.current === key) return;
    done.current = key;
    if (param === "ms_admin") {
      if (back.ok) toast.success(t("Company-wide access granted. The office can now read the shared mailboxes you add."));
      else toast.error(back.message || t("Company-wide access was not granted."), { duration: 10_000 });
    } else if (back.ok) {
      toast.success(back.message ? t("Outlook connected: {detail}.", { detail: back.message }) : t("Outlook connected."));
    } else {
      toast.error(back.message || t("Microsoft sign-in failed."), { duration: 10_000 });
    }
    void qc.invalidateQueries({ queryKey: microsoftKeys.all });
    void qc.invalidateQueries({ queryKey: mailKeys.all });
    void qc.invalidateQueries({ queryKey: assistantKeys.home });
    clear();
  }, [search, clear, param, qc, t]);
}

/** "This server does not have Microsoft 365 yet": shown while P34 is not deployed (404). */
export function MissingServer({ className }: { className?: string }) {
  const t = useT();
  return (
    <p role="status" className={cn("flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[12.5px]", className)}>
      <PlugsIcon size={15} className="mt-0.5 shrink-0 text-warn" />
      <span className="min-w-0">{t("This server does not have the Microsoft 365 connection yet. Update the server to turn it on.")}</span>
    </p>
  );
}

/** "Connected as aina@company.com · Live · synced 2 min ago". */
export function accountMeta(a: MicrosoftAccount, t: ReturnType<typeof useT>) {
  return [
    a.email ? t("Connected as {email}", { email: a.email }) : t("Connected"),
    <Pill key="w" tone={WEBHOOK_TONE[a.webhooks]} live={a.webhooks === "live"} className="py-0 text-[11.5px]">{t(WEBHOOK_LABEL[a.webhooks])}</Pill>,
    a.last_sync_at ? t("Synced {ago}", { ago: timeAgo(a.last_sync_at).toLowerCase() }) : null,
  ];
}

function useOutlook() {
  const t = useT();
  const qc = useQueryClient();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  const connect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disconnect = async () => {
    try {
      await disconnectMicrosoft();
      await qc.invalidateQueries({ queryKey: microsoftKeys.account });
      void qc.invalidateQueries({ queryKey: mailKeys.all });
      void qc.invalidateQueries({ queryKey: assistantKeys.home });
      toast.success(t("Outlook disconnected."));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return { config, account, connect, disconnect };
}

/**
 * The person's own Outlook: connect, status, reconnect, disconnect. `bare` drops the card
 * (for the Channels card and the assistants Connections list).
 */
export function OutlookConnection({ bare, className }: { bare?: boolean; className?: string }) {
  const t = useT();
  const { config, account, connect, disconnect } = useOutlook();
  const [confirmOff, setConfirmOff] = useState(false);
  const cfg = config.data;
  const acct = account.data?.connected ? account.data : null;
  const reconnect = needsReconnect(acct);

  let body: ReactNode;
  if (config.isLoading || (cfg?.configured && account.isLoading)) body = <Skeleton className="h-16" />;
  else if (config.error) body = isMissingApi(config.error) ? <MissingServer /> : <p role="alert" className="text-[13px] text-danger">{errorMessage(config.error)}</p>;
  else if (!cfg?.configured) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-[13px] text-muted">
          <InfoIcon size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{cfg?.can_configure ? t("Set up Microsoft 365 once for the office (Channels > Microsoft 365), then connect your Outlook here.") : t("Ask an admin to set up Microsoft 365. Then you can connect your Outlook here.")}</span>
        </p>
        {cfg?.can_configure ? <Button size="sm" variant="outline" asChild><Link to="/channels">{t("Set up")}</Link></Button> : null}
      </div>
    );
  } else if (account.error) body = isMissingApi(account.error) ? <MissingServer /> : <p role="alert" className="text-[13px] text-danger">{errorMessage(account.error)}</p>;
  else if (!acct) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-[13px] text-muted">{t("Microsoft asks you to sign in with your work account and allow access, then brings you back here.")}</p>
        <Button className="max-sm:w-full" loading={connect.isPending} onClick={() => connect.mutate()}>
          <MicrosoftOutlookLogoIcon size={16} weight="bold" /> {t("Connect Outlook")}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className={cn("flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border p-3.5", reconnect ? "border-danger/30 bg-danger/6" : "border-border")}>
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          <IconTile icon={reconnect ? WarningCircleIcon : MicrosoftOutlookLogoIcon} tone={reconnect ? "danger" : "info"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium break-all">{acct.display_name || acct.email}</p>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted sm:gap-x-1.5"><Meta items={accountMeta(acct, t)} /></p>
            {reconnect ? (
              <p role="alert" className="mt-1.5 text-[12.5px] break-words text-danger">
                {t("Microsoft stopped accepting this connection (the password changed, or access was removed). Reconnect to fix it.")}
                {acct.last_error ? <span className="mt-0.5 block text-muted">{acct.last_error}</span> : null}
              </p>
            ) : (
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                <Pill tone={acct.mail_ok ? "ok" : "warn"}>{acct.mail_ok ? <CheckCircleIcon size={12} weight="fill" /> : <WarningCircleIcon size={12} />} {t("Mail")}</Pill>
                <Pill tone={acct.calendar_ok ? "ok" : "warn"}>{acct.calendar_ok ? <CalendarBlankIcon size={12} weight="fill" /> : <WarningCircleIcon size={12} />} {t("Calendar")}</Pill>
              </p>
            )}
            {!reconnect && (!acct.mail_ok || !acct.calendar_ok) ? (
              <p className="mt-1.5 text-[12.5px] text-muted">{t("Some access was not allowed at sign-in. Reconnect and accept every permission Microsoft asks for.")}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:pl-11">
          {reconnect || !acct.mail_ok || !acct.calendar_ok ? (
            <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><ArrowClockwiseIcon size={14} /> {t("Reconnect")}</Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}><LinkBreakIcon size={15} /> {t("Disconnect")}</Button>
        </div>
      </div>
    );
  }

  const dialog = (
    <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title={t("Disconnect your Outlook?")} confirmLabel={t("Disconnect")} danger
      body={t("Your AI can no longer read your Outlook mail or calendar, or draft replies. Drafts already in Outlook stay there.")}
      onConfirm={disconnect} />
  );

  if (bare) return <div className={cn("grid min-w-0 gap-3", className)}>{body}{dialog}</div>;
  // A server without P34 shows nothing here: My AI stays uncluttered until the update.
  if (isMissingApi(config.error)) return null;
  const pill = !cfg ? null
    : !cfg.configured ? <Pill>{t("Not set up")}</Pill>
    : reconnect ? <Pill tone="danger">{t("Needs attention")}</Pill>
    : acct ? <Pill tone="ok" live>{t("Connected")}</Pill> : <Pill>{t("Not connected")}</Pill>;
  return (
    <Card className={className} data-guide="outlook.connection">
      <CardHeader icon={<IconTile icon={MicrosoftOutlookLogoIcon} tone="info" size="sm" />} title="Outlook"
        description={t("Your AI reads your Outlook mail and calendar, drafts replies and proposes events. Nothing is sent until you approve it.")}
        actions={pill} />
      <CardBody className="grid gap-3">
        {body}
        {acct && !reconnect ? <OutlookPrefs /> : null}
        {acct && !reconnect ? (
          <Link to="/mail" className="inline-flex min-h-9 w-fit items-center gap-1 text-[13px] text-accent hover:underline">{t("See what came in and what your AI did")} →</Link>
        ) : null}
      </CardBody>
      {dialog}
    </Card>
  );
}

/** A row for the My assistants Connections list (same look as its Gmail row). */
export function OutlookRow() {
  const t = useT();
  const { config, account, connect, disconnect } = useOutlook();
  const [confirmOff, setConfirmOff] = useState(false);
  const cfg = config.data;
  if (config.isLoading || isMissingApi(config.error) || !cfg) return null;
  const acct = account.data?.connected ? account.data : null;
  const reconnect = needsReconnect(acct);
  const status = acct
    ? reconnect ? <span className="text-danger">{t("Microsoft stopped accepting this connection. Reconnect to fix it.")}</span>
      : <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><Meta items={accountMeta(acct, t)} /></span>
    : cfg.configured ? t("Read your Outlook mail and calendar, and draft replies you approve.")
    : cfg.can_configure ? t("Set up Microsoft 365 first (Channels > Microsoft 365).") : t("Ask an admin to set up Microsoft 365.");
  const action = acct ? (
    <>
      {reconnect ? <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><ArrowClockwiseIcon size={14} /> {t("Reconnect")}</Button>
        : <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> {t("Connected")}</Pill>}
      <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}>{t("Disconnect")}</Button>
    </>
  ) : cfg.configured ? <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><MicrosoftOutlookLogoIcon size={14} /> {t("Connect Outlook")}</Button>
    : cfg.can_configure ? <Button size="sm" variant="outline" asChild><Link to="/channels">{t("Set up")}</Link></Button> : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3">
      <IconTile icon={MicrosoftOutlookLogoIcon} tone="info" size="sm" />
      <span className="min-w-0"><span className="block text-[13.5px] font-medium">{t("Outlook (Microsoft 365)")}</span><span className="block text-[12px] break-words text-muted">{status}</span></span>
      {action ? <span className="col-start-2 flex min-w-0 flex-wrap gap-2">{action}</span> : null}
      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title={t("Disconnect your Outlook?")} confirmLabel={t("Disconnect")} danger
        body={t("Your AI can no longer read your Outlook mail or calendar, or draft replies. Drafts already in Outlook stay there.")}
        onConfirm={disconnect} />
    </li>
  );
}

/** "Outlook · Live": a small link to the Mail page next to the computers link (My AI, assistants). */
export function OutlookLink({ className }: { className?: string }) {
  const t = useT();
  const config = useQuery(microsoftConfigQuery);
  const account = useQuery({ ...microsoftAccountQuery, enabled: !!config.data?.configured });
  if (!config.data?.configured || !account.data) return null;
  const a = account.data;
  const reconnect = needsReconnect(a);
  const label = !a.connected ? t("Connect Outlook") : reconnect ? t("Reconnect Outlook") : t("Outlook · {state}", { state: t(WEBHOOK_LABEL[a.webhooks]).toLowerCase() });
  return (
    <Link to="/mail" title={t("Mail")}
      className={cn("inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-sm px-1 text-[12.5px] transition-colors hover:text-accent", reconnect ? "text-danger" : "text-muted", className)}>
      <span className="relative shrink-0">
        <MicrosoftOutlookLogoIcon size={16} weight="duotone" />
        {a.connected ? <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface", reconnect ? "bg-danger" : a.webhooks === "live" ? "bg-ok" : "bg-info")} /> : null}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Banner on top of My AI when the Outlook connection needs a fresh sign-in. */
export function ReconnectBanner() {
  const t = useT();
  const { config, account, connect } = useOutlook();
  if (!config.data?.configured || !needsReconnect(account.data)) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/6 px-4 py-3">
      <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-danger" />
      <p className="min-w-0 flex-1 basis-64 text-[13px]">
        <span className="font-medium">{t("Your Outlook needs to be reconnected.")}</span>{" "}
        <span className="text-muted">{t("Until then your AI cannot read new mail or send the replies you approve.")}</span>
      </p>
      <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()} className="max-sm:w-full"><ArrowClockwiseIcon size={14} /> {t("Reconnect Outlook")}</Button>
    </div>
  );
}
