import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  BellRingingIcon,
  CalendarPlusIcon,
  CaretDownIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CopyIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  GoogleLogoIcon,
  InfoIcon,
  KeyIcon,
  LinkBreakIcon,
  ListChecksIcon,
  PaperPlaneTiltIcon,
  PencilSimpleLineIcon,
  PlugIcon,
  PlusIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  SignOutIcon,
  TelegramLogoIcon,
  TimerIcon,
  TrashIcon,
  UserCircleIcon,
  UsersIcon,
  WarningCircleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import {
  channelsQuery,
  googleQuery,
  integrationKeys,
  waNumber,
  whatsappStatusQuery,
  type ChannelOut,
  type GoogleStatus,
  type LinkCode,
  type WaStatus,
  type WhatsAppStatus,
} from "@/lib/integrations";
import { canInstall, disablePush, enablePush, install, isIOS, onInstallChange, pushState, type PushState } from "@/lib/push";
import { meQuery } from "@/lib/queries";
import { useMedia } from "@/lib/use-media";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

interface Device { id: string; label: string; created_at: string; last_ok_at: string | null; failures: number; service: string }
interface TokenOut { id: string; name: string; prefix: string; scopes: string[]; created_at: string; created_by_name: string | null; expires_at: string | null; last_used_at: string | null; revoked: boolean }
interface Ledger { counts: Record<string, number>; items: { id: string; channel: string; kind: string; state: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; summary: string }[] }

const STATE_TONE = { pending: "info", sent: "ok", failed: "danger", skipped: "neutral" } as const;
const STATES = ["all", "pending", "sent", "failed", "skipped"] as const;
const CHANNEL_LABEL: Record<string, string> = { webpush: "Push", telegram: "Telegram", whatsapp: "WhatsApp" };
const channelLabel = (c: string) => CHANNEL_LABEL[c] ?? c;

// ---------------------------------------------------------------- this device

function ThisDevice() {
  const qc = useQueryClient();
  const [state, setState] = useState<PushState | null>(null);
  const [installable, setInstallable] = useState(canInstall());
  const { data: devices = [] } = useQuery({ queryKey: ["push", "devices"], queryFn: () => api<Device[]>("/api/push/devices") });
  const refresh = () => {
    void pushState().then(setState);
    qc.invalidateQueries({ queryKey: ["push", "devices"] });
  };
  useEffect(() => {
    let alive = true;
    void pushState().then((s) => alive && setState(s));
    const off = onInstallChange(() => setInstallable(canInstall()));
    return () => { alive = false; off(); };
  }, []);
  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enablePush() : disablePush()),
    onSuccess: (_r, on) => { refresh(); toast.success(on ? "Notifications are on for this device." : "Notifications are off for this device."); },
    onError: (e) => { refresh(); toast.error(errorMessage(e)); },
  });
  const test = useMutation({
    mutationFn: () => api<{ results: { device: string; state: string; error: string | null }[] }>("/api/push/test", "POST"),
    onSuccess: (r) => {
      const bad = r.results.filter((x) => x.state !== "sent");
      if (bad.length) toast.error(`${bad[0]!.device}: ${bad[0]!.error ?? bad[0]!.state}`);
      else toast.success("Sent. It should appear in a few seconds.");
      qc.invalidateQueries({ queryKey: ["push", "devices"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeDevice = async (id: string) => {
    try {
      await api(`/api/push/devices/${id}`, "DELETE");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card data-guide="channels.push">
      <CardHeader
        icon={<IconTile icon={BellRingingIcon} size="sm" />}
        title="This device"
        description="Get a notification when an agent needs a decision, and approve it from the lock screen."
        actions={state === "on" ? <Pill tone="ok" live>On</Pill> : state === "denied" ? <Pill tone="danger">Blocked</Pill> : null}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {state === null ? <Skeleton className="h-10" /> : state === "needs-install" ? (
          <div className="grid gap-1.5 text-[13.5px]">
            <p className="font-medium">On iPhone, add the app to your Home Screen first.</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>Tap the Share button in Safari.</li>
              <li>Choose <span className="font-medium text-fg">Add to Home Screen</span>.</li>
              <li>Open Agentic Office from the new icon and come back here.</li>
            </ol>
            <p className="text-[12.5px] text-muted">iPhone notifications have no buttons: tapping one opens a page with Approve and Deny.</p>
          </div>
        ) : state === "unsupported" ? (
          <p className="text-[13.5px] text-muted">This browser cannot receive notifications. Use Chrome, Edge, Firefox, or Safari 16.4+.</p>
        ) : state === "denied" ? (
          <p className="text-[13.5px] text-muted">Notifications are blocked for this site. Allow them in the browser's site settings, then reload.</p>
        ) : (
          <SwitchField
            checked={state === "on"}
            onCheckedChange={(on) => toggle.mutate(on)}
            disabled={toggle.isPending}
            label="Notifications on this device"
            hint={toggle.isPending ? "Turning on… registering with the browser's push service can take half a minute the first time."
              : state === "on" ? "Approvals arrive with Approve and Deny buttons (iPhone: tap to open)." : "Your browser asks for permission when you turn this on."}
          />
        )}
        {state === "on" || installable || !isIOS() ? (
          <div className="flex flex-wrap items-center gap-2">
            {state === "on" ? <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}><PaperPlaneTiltIcon size={15} /> Send a test</Button> : null}
            {installable ? (
              <Button size="sm" variant="outline" onClick={() => void install().then((ok) => ok && toast.success("Installed. Open it from your home screen or apps."))}>
                <DownloadSimpleIcon size={15} /> Install the app
              </Button>
            ) : null}
            {!installable && !isIOS() ? (
              <p className="flex items-start gap-1.5 text-[12.5px] text-muted">
                <DownloadSimpleIcon size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0">To install: the browser menu, then Install app (or Add to Home screen).</span>
              </p>
            ) : null}
          </div>
        ) : null}
        {devices.length ? (
          <div className="grid gap-2">
            <h3 className="text-[12.5px] font-medium text-muted">Your devices</h3>
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <IconTile icon={DeviceMobileIcon} size="sm" tone={d.failures ? "warn" : "neutral"} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{d.label}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                      <Meta items={[
                        d.last_ok_at ? `Last delivered ${timeAgo(d.last_ok_at).toLowerCase()}` : `Added ${timeAgo(d.created_at).toLowerCase()}`,
                        d.failures ? <span className="text-warn">{d.failures} failed</span> : null,
                      ]} />
                    </span>
                  </span>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${d.label}`} onClick={() => removeDevice(d.id)}><TrashIcon size={15} /></Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- telegram

function BindingRow({ ch, match, label, agents, noneLabel = "Nobody answers" }: { ch: ChannelOut; match: string; label: string; agents: { id: string; name: string; role: string }[]; noneLabel?: string }) {
  const qc = useQueryClient();
  const current = ch.bindings.find((b) => b.match === match);
  const save = useMutation({
    mutationFn: (agentId: string) => agentId === "none"
      ? (current ? api(`/api/channels/${ch.id}/bindings/${current.id}`, "DELETE") : Promise.resolve())
      : api(`/api/channels/${ch.id}/bindings`, "PUT", { match, agent_id: agentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-[13px] font-medium break-words">{label}</span>
      <Select value={current?.agent_id ?? "none"} onValueChange={(v) => save.mutate(v)} label={`Agent for ${label}`} className="w-full"
        options={[{ value: "none", label: noneLabel }, ...agents.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))]} />
    </div>
  );
}

function TelegramCard({ ch, canManage }: { ch: ChannelOut; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const [code, setCode] = useState<{ code: string; url: string | null } | null>(null);
  const [chatId, setChatId] = useState("");
  const link = useMutation({
    mutationFn: () => api<{ code: string; url: string | null }>(`/api/channels/${ch.id}/link-code`, "POST"),
    onSuccess: setCode,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(`/api/channels/${ch.id}`, "PATCH", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });
  const bindChat = useMutation({
    mutationFn: (agentId: string) => api(`/api/channels/${ch.id}/bindings`, "PUT", { match: `chat:${chatId.trim()}`, agent_id: agentId }),
    onSuccess: () => { setChatId(""); qc.invalidateQueries({ queryKey: ["channels"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const active = agents.filter((a) => a.status === "active");
  const custom = ch.bindings.filter((b) => b.match.startsWith("chat:"));

  return (
    <Card>
      <CardHeader
        icon={<IconTile icon={TelegramLogoIcon} tone="info" size="sm" />}
        title={<span className="flex flex-wrap items-center gap-2">{ch.name}<Pill tone={ch.enabled ? "ok" : "neutral"} live={ch.enabled}>{ch.enabled ? "On" : "Off"}</Pill></span>}
        description={ch.bot_username ? <a href={`https://t.me/${ch.bot_username}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">t.me/{ch.bot_username}</a> : "Telegram bot"}
        actions={canManage ? <SwitchField checked={ch.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="Running" /> : null}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {ch.last_error ? <p role="alert" className="rounded-sm bg-danger/8 px-3 py-2 text-[12.5px] break-words text-danger">Telegram said: {ch.last_error}</p> : null}

        <div className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><UserCircleIcon size={16} className="text-muted" /> Your account</h3>
          {ch.linked ? <p className="text-[13px] text-muted">Linked. Approvals reach you on Telegram with Approve and Deny buttons; reply to a question to answer it.</p> : (
            <>
              <p className="text-[13px] text-muted">Link your Telegram so the bot knows it is you. Only linked people can use it.</p>
              {code ? (
                <div className="grid gap-1.5 rounded-sm border border-border bg-surface-2/50 p-3 text-[13px]">
                  {code.url ? <a href={code.url} target="_blank" rel="noreferrer" className="w-fit font-medium text-accent hover:underline">Open Telegram and press Start</a> : null}
                  <span className="text-muted">or send <span className="font-mono break-all text-fg">/start {code.code}</span> to the bot. The code works for 10 minutes.</span>
                  <Button size="sm" variant="ghost" className="w-fit" onClick={() => qc.invalidateQueries({ queryKey: ["channels"] })}><ArrowClockwiseIcon size={14} /> I did it</Button>
                </div>
              ) : <Button size="sm" className="w-fit" loading={link.isPending} onClick={() => link.mutate()}>Link my account</Button>}
            </>
          )}
          {canManage && ch.links.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-muted">Linked:</span>
              {ch.links.map((l) => <Pill key={l.id} className="max-w-full whitespace-normal break-words">{l.user_name} ({l.display})</Pill>)}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 border-t border-border pt-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ChatsCircleIcon size={16} className="text-muted" /> Who answers</h3>
            <p className="text-[12.5px] text-muted">Messages from linked people go to an agent. A specific chat beats groups, groups beat direct messages.</p>
          </div>
          {canManage ? (
            <>
              <BindingRow ch={ch} match="dm" label="Direct messages" agents={active} />
              <BindingRow ch={ch} match="group" label="Group chats" agents={active} />
              {custom.map((b) => <BindingRow key={b.id} ch={ch} match={b.match} label={`Chat ${b.match.slice(5)}`} agents={active} />)}
              <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-2 rounded-sm border border-dashed border-border p-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
                <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Chat id, e.g. -1001234" className="text-[13px]" aria-label="Chat id" />
                <Select value="" onValueChange={(v) => bindChat.mutate(v)} label="Agent for that chat" placeholder="Pick an agent for that chat" className="w-full" disabled={!/^-?\d+$/.test(chatId.trim())}
                  options={active.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))} />
              </div>
            </>
          ) : (
            <ul className="grid gap-1 text-[13px] text-muted">
              {ch.bindings.length ? ch.bindings.map((b) => <li key={b.id}>{b.match === "dm" ? "Direct messages" : b.match === "group" ? "Groups" : `Chat ${b.match.slice(5)}`}: <span className="text-fg">{b.agent_name}</span></li>) : <li>No agent answers yet.</li>}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Telegram({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { data: all, isLoading } = useQuery(channelsQuery);
  const channels = all?.filter((c) => c.kind === "telegram");
  const [token, setToken] = useState("");
  const add = useMutation({
    mutationFn: () => api("/api/channels/telegram", "POST", { token }),
    onSuccess: () => { setToken(""); qc.invalidateQueries({ queryKey: ["channels"] }); toast.success("Bot connected."); },
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (channels?.length) return <div data-guide="channels.telegram" className="grid gap-4">{channels.map((ch) => <TelegramCard key={ch.id} ch={ch} canManage={canManage} />)}</div>;
  return (
    <Card data-guide="channels.telegram">
      <CardHeader
        icon={<IconTile icon={TelegramLogoIcon} tone="info" size="sm" />}
        title="Telegram"
        description="Approve from Telegram and chat with an agent. Works on a laptop with no public address (the worker polls Telegram)."
        actions={<Pill>Not connected</Pill>}
      />
      <CardBody>
        {canManage ? (
          <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) add.mutate(); }} className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <ol className="grid gap-2 text-[13px]">
              <li className="flex items-start gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">1</span>
                <span className="min-w-0">Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent hover:underline">@BotFather</a> (send <span className="font-mono">/newbot</span>).</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">2</span>
                <span className="min-w-0">Paste the token it gives you below.</span>
              </li>
            </ol>
            <Field label="Bot token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." autoComplete="off" hint="Checked with Telegram, then stored encrypted. It is never shown again." />
            <Button type="submit" className="w-fit max-sm:w-full" loading={add.isPending} disabled={token.trim().length < 20}><TelegramLogoIcon size={16} /> Connect the bot</Button>
            <FormError message={add.error ? errorMessage(add.error) : null} />
          </form>
        ) : <p className="text-[13.5px] text-muted">No Telegram bot yet. An owner or admin can connect one.</p>}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- shared bits

type PillTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied."), () => toast.error("Copy blocked by the browser."));
}

/** A labelled value in mono with a copy button (URLs, tokens). Long values wrap instead of overflowing. */
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <div className="flex min-w-0 items-start gap-1.5 rounded-sm border border-border bg-surface py-1 pr-1 pl-2.5">
        <span className="min-w-0 flex-1 py-1 font-mono text-[12.5px] break-all">{value}</span>
        <button type="button" onClick={() => copyText(value)} aria-label={`Copy ${label}`}
          className="grid size-8 shrink-0 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <CopyIcon size={14} />
        </button>
      </div>
    </div>
  );
}

/** Numbered steps with accent bullets (the same look as the Telegram setup). */
function Steps({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ol className={cn("grid gap-2.5 text-[13px]", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent tabular">{i + 1}</span>
          <span className="min-w-0 flex-1 leading-relaxed">{it}</span>
        </li>
      ))}
    </ol>
  );
}

/** A collapsible block with a caret header (advanced fields, long guides). */
function Disclosure({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 rounded-sm border border-border">
      <button type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}
        className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-surface-2/60">
        <span className="min-w-0">{title}</span>
        <CaretDownIcon size={14} className={cn("shrink-0 text-muted transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? <div className="grid min-w-0 gap-3 border-t border-border p-3">{children}</div> : null}
    </div>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <span className="font-medium text-fg">{children}</span>;
const Code = ({ children }: { children: ReactNode }) => <span className="rounded bg-surface-2 px-1 py-px font-mono text-[12px] text-fg">{children}</span>;

// ---------------------------------------------------------------- whatsapp

const WA_PILL: Record<WaStatus, { label: string; tone: PillTone; live?: boolean }> = {
  WORKING: { label: "Connected", tone: "ok", live: true },
  SCAN_QR_CODE: { label: "Waiting for scan", tone: "warn" },
  STARTING: { label: "Starting", tone: "info" },
  FAILED: { label: "Failed", tone: "danger" },
  UNREACHABLE: { label: "Unreachable", tone: "danger" },
  STOPPED: { label: "Stopped", tone: "neutral" },
  MISSING: { label: "No session", tone: "warn" },
  UNKNOWN: { label: "Unknown", tone: "neutral" },
};

const WA_PROBLEM: Partial<Record<WaStatus, { title: string; hint: string }>> = {
  FAILED: { title: "The WhatsApp session failed", hint: "Restart the session. If it keeps failing, log out and scan again." },
  UNREACHABLE: { title: "The WhatsApp gateway is not answering", hint: "Check that the WAHA container is running, then try again." },
  STOPPED: { title: "The session is stopped", hint: "Start it again to get a new code." },
  MISSING: { title: "There is no session on the gateway yet", hint: "Start the session to get a code to scan." },
  UNKNOWN: { title: "The status is unknown", hint: "Check again in a moment." },
};

type WaProvider = "waha" | "meta";

function WhatsAppSetup({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<WaProvider>("waha");
  const narrow = useMedia("(max-width: 480px)");
  const [advanced, setAdvanced] = useState(false);
  const [waha, setWaha] = useState({ base_url: "", api_key: "", session: "" });
  const [meta, setMeta] = useState({ phone_number_id: "", token: "", app_secret: "", template: "", template_lang: "en" });
  const sessionBad = !!waha.session.trim() && !/^[A-Za-z0-9_-]+$/.test(waha.session.trim());
  const metaReady = !!(meta.phone_number_id.trim() && meta.token.trim() && meta.app_secret.trim());
  const opt = (v: string) => v.trim() || undefined;
  const add = useMutation({
    mutationFn: () => api<WhatsAppStatus>("/api/channels/whatsapp", "POST", provider === "waha"
      ? { provider, base_url: opt(waha.base_url), api_key: opt(waha.api_key), session: opt(waha.session) }
      : { provider, phone_number_id: meta.phone_number_id.trim(), token: meta.token.trim(), app_secret: meta.app_secret.trim(), template: opt(meta.template), template_lang: opt(meta.template_lang) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: integrationKeys.channels });
      toast.success(provider === "waha" ? "Session started. Scan the code with the office phone." : "WhatsApp Business connected.");
    },
  });
  const submit = () => {
    if (provider === "waha" ? sessionBad : !metaReady) return;
    add.mutate();
  };

  return (
    <Card data-guide="channels.whatsapp">
      <CardHeader
        icon={<IconTile icon={WhatsappLogoIcon} tone="ok" size="sm" />}
        title="WhatsApp"
        description="Get approvals and questions on WhatsApp, and chat with your assistant from your own phone."
        actions={<Pill>Not connected</Pill>}
      />
      <CardBody>
        {canManage ? (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <div className="grid gap-2">
              <span className="text-[13px] font-medium">How to connect the office number</span>
              <Segmented label="WhatsApp provider" value={provider} onChange={(v) => { setProvider(v); add.reset(); }}
                className={narrow ? "w-full [&>button]:flex-1 [&>button]:justify-center" : "w-fit"}
                options={narrow
                  ? [{ value: "waha", label: "WAHA (quick)" }, { value: "meta", label: "Meta (official)" }]
                  : [{ value: "waha", label: "WAHA (quick, self-hosted)" }, { value: "meta", label: "Meta Cloud API (official)" }]} />
            </div>

            {provider === "waha" ? (
              <>
                <ul className="grid gap-2 rounded-sm border border-border bg-surface-2/40 p-3 text-[13px]">
                  <li className="flex items-start gap-2"><CheckCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-ok" /><span className="min-w-0">Free, and runs on your own server. Uses the WAHA gateway that ships with the office.</span></li>
                  <li className="flex items-start gap-2"><QrCodeIcon size={16} className="mt-0.5 shrink-0 text-muted" /><span className="min-w-0">You scan a QR code with the office phone, the same way as WhatsApp Web.</span></li>
                  <li className="flex items-start gap-2"><WarningCircleIcon size={16} className="mt-0.5 shrink-0 text-warn" /><span className="min-w-0">Unofficial, so keep it polite: the office only ever messages people who linked themselves. Numbers that spam can be banned by WhatsApp.</span></li>
                </ul>
                <Disclosure open={advanced} onOpenChange={setAdvanced} title={<span>Advanced settings <span className="font-normal text-muted">(the defaults work)</span></span>}>
                  <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 sm:grid-cols-2">
                    <Field className="sm:col-span-2" label="WAHA address" value={waha.base_url} onChange={(e) => setWaha({ ...waha, base_url: e.target.value })} placeholder="Bundled WAHA container" autoComplete="off" hint="Only for your own WAHA server, e.g. http://waha:3000." />
                    <Field label="API key" type="password" value={waha.api_key} onChange={(e) => setWaha({ ...waha, api_key: e.target.value })} placeholder="Server default" autoComplete="new-password" />
                    <Field label="Session name" value={waha.session} onChange={(e) => setWaha({ ...waha, session: e.target.value })} placeholder="default" autoComplete="off" error={sessionBad ? "Letters, digits, - and _ only." : undefined} />
                  </div>
                </Disclosure>
              </>
            ) : (
              <>
                <ul className="grid gap-2 rounded-sm border border-border bg-surface-2/40 p-3 text-[13px]">
                  <li className="flex items-start gap-2"><ShieldCheckIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-ok" /><span className="min-w-0">The official WhatsApp Business number from Meta. No phone to keep online.</span></li>
                  <li className="flex items-start gap-2"><KeyIcon size={16} className="mt-0.5 shrink-0 text-muted" /><span className="min-w-0">Needs the phone number ID, a permanent access token and the app secret from your Meta app.</span></li>
                  <li className="flex items-start gap-2"><WarningCircleIcon size={16} className="mt-0.5 shrink-0 text-warn" /><span className="min-w-0">Messages to someone who has not written in the last 24 hours need an approved template.</span></li>
                </ul>
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 sm:grid-cols-2">
                  <Field label="Phone number ID" value={meta.phone_number_id} onChange={(e) => setMeta({ ...meta, phone_number_id: e.target.value })} placeholder="e.g. 109876543210987" autoComplete="off" inputMode="numeric" />
                  <Field label="App secret" type="password" value={meta.app_secret} onChange={(e) => setMeta({ ...meta, app_secret: e.target.value })} autoComplete="new-password" hint="App settings > Basic. Used to check webhooks." />
                  <Field className="sm:col-span-2" label="Permanent access token" type="password" value={meta.token} onChange={(e) => setMeta({ ...meta, token: e.target.value })} autoComplete="new-password" hint="A system user token with whatsapp_business_messaging. Stored encrypted, never shown again." />
                  <Field label="Template name (optional)" value={meta.template} onChange={(e) => setMeta({ ...meta, template: e.target.value })} placeholder="e.g. office_update" autoComplete="off" hint="Used for messages outside the 24-hour window." />
                  <Field label="Template language" value={meta.template_lang} onChange={(e) => setMeta({ ...meta, template_lang: e.target.value })} placeholder="en" autoComplete="off" />
                </div>
              </>
            )}

            <FormError message={add.error ? errorMessage(add.error) : null} />
            <Button type="submit" className="w-fit max-sm:w-full" loading={add.isPending} disabled={provider === "waha" ? sessionBad : !metaReady}>
              <WhatsappLogoIcon size={16} /> {provider === "waha" ? "Connect and show the QR code" : "Connect WhatsApp Business"}
            </Button>
          </form>
        ) : <p className="text-[13.5px] text-muted">No WhatsApp number yet. An owner or admin can connect one.</p>}
      </CardBody>
    </Card>
  );
}

/** The office number: QR while waiting, the number when connected, or what went wrong. */
function OfficeNumber({ ch, st, loading, fetchError, canManage, onStart, starting, onCheck, checking }: {
  ch: ChannelOut; st: WhatsAppStatus | undefined; loading: boolean; fetchError: unknown; canManage: boolean;
  onStart: () => void; starting: boolean; onCheck: () => void; checking: boolean;
}) {
  const provider = st?.provider ?? ch.provider ?? "waha";
  const status: WaStatus = fetchError ? "UNREACHABLE" : st?.status ?? ch.status ?? "UNKNOWN";
  const number = waNumber(st?.number ?? ch.number);

  if (loading && !st) return <Skeleton className="h-64" />;

  if (status === "WORKING") {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-ok/25 bg-ok/6 p-4">
        <IconTile icon={CheckCircleIcon} tone="ok" />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold tabular break-all">{number ?? "Number not known yet"}</p>
          <p className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-1.5 text-[12.5px] text-muted">
            <Meta items={[st?.display, provider === "waha" ? `WAHA session ${st?.session ?? "default"}` : "Meta Cloud API"]} />
          </p>
        </div>
      </div>
    );
  }

  if (status === "STARTING") {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-4 text-[13px]">
        <CircleNotchIcon size={20} className="shrink-0 animate-spin text-info" />
        <div className="min-w-0">
          <p className="font-medium">Starting the WhatsApp session…</p>
          <p className="text-muted">This takes a few seconds. The code to scan appears here.</p>
        </div>
      </div>
    );
  }

  if (status === "SCAN_QR_CODE") {
    if (!canManage || !st?.qr) {
      return (
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-4 text-[13px]">
          <QrCodeIcon size={20} className="mt-0.5 shrink-0 text-warn" />
          <p className="min-w-0 text-muted">The office phone is not linked yet. {canManage ? "Loading the code to scan…" : "An owner or admin scans a code on this page to connect it."}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-4">
        <div className="rounded-[var(--radius-md)] bg-white p-3 shadow-[var(--shadow-soft)] ring-1 ring-border max-sm:mx-auto">
          <img src={st.qr} alt="WhatsApp login code for the office phone" width={240} height={240} className="block size-60 [image-rendering:pixelated]" />
        </div>
        <div className="grid min-w-[14rem] flex-1 content-start gap-3">
          <p className="text-[14px] font-semibold">Scan with the office phone</p>
          <Steps items={[
            <>On the office phone, open <Kbd>WhatsApp</Kbd>.</>,
            <>Go to <Kbd>Settings</Kbd> &gt; <Kbd>Linked devices</Kbd> &gt; <Kbd>Link a device</Kbd>.</>,
            <>Point the camera at this code. It refreshes by itself.</>,
          ]} />
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <CircleNotchIcon size={14} className="shrink-0 animate-spin" /> Waiting for the scan…
          </p>
        </div>
      </div>
    );
  }

  // FAILED, UNREACHABLE, STOPPED, MISSING, UNKNOWN
  const problem = WA_PROBLEM[status] ?? WA_PROBLEM.UNKNOWN!;
  const detail = fetchError ? errorMessage(fetchError) : st?.error ?? ch.last_error;
  const serious = status === "FAILED" || status === "UNREACHABLE";
  return (
    <div role="alert" className={cn("grid gap-3 rounded-[var(--radius-md)] border p-4 text-[13px]", serious ? "border-danger/30 bg-danger/6" : "border-warn/30 bg-warn/6")}>
      <div className="flex items-start gap-3">
        <WarningCircleIcon size={20} weight="fill" className={cn("mt-0.5 shrink-0", serious ? "text-danger" : "text-warn")} />
        <div className="min-w-0">
          <p className="font-medium">{problem.title}</p>
          {detail ? <p className="break-words text-muted">{detail}</p> : null}
          <p className="text-muted">{provider === "meta" ? "Check the token and phone number ID in your Meta app, then check again." : problem.hint}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManage && provider === "waha" ? <Button size="sm" loading={starting} onClick={onStart}><ArrowClockwiseIcon size={14} /> Start the session</Button> : null}
        <Button size="sm" variant="outline" loading={checking} onClick={onCheck}>Check again</Button>
      </div>
    </div>
  );
}

/** Webhook values to paste into the Meta developer console. */
function MetaWebhook({ st }: { st: WhatsAppStatus }) {
  if (!st.webhook_url) return null;
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-4">
      <div>
        <p className="text-[13.5px] font-semibold">Webhook setup</p>
        <p className="text-[12.5px] text-muted">So replies reach the office. The address must be reachable from the internet.</p>
      </div>
      <CopyRow label="Callback URL" value={st.webhook_url} />
      {st.verify_token ? <CopyRow label="Verify token" value={st.verify_token} /> : null}
      <Steps items={[
        <>In <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-accent hover:underline">developers.facebook.com</a>, open your app &gt; <Kbd>WhatsApp</Kbd> &gt; <Kbd>Configuration</Kbd>.</>,
        <>Under <Kbd>Webhook</Kbd>, press Edit, paste the callback URL and verify token, then <Kbd>Verify and save</Kbd>.</>,
        <>Under <Kbd>Webhook fields</Kbd>, subscribe to <Code>messages</Code>.</>,
      ]} />
      <p className="flex items-start gap-2 text-[12.5px] text-muted">
        <InfoIcon size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{st.template ? <>Messages outside the 24-hour window use the template <Code>{st.template}</Code>.</> : "No template set: messages to people who have not written in 24 hours will not be delivered."}</span>
      </p>
    </div>
  );
}

/** A fresh link code: big, with a countdown, and a poll until the person shows up as linked. */
function LinkCodeBox({ code, number, onNew, renewing, onCancel }: {
  code: LinkCode & { at: number }; number: string | null; onNew: () => void; renewing: boolean; onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round(code.expires_in - (now - code.at) / 1000));
  // Watch the channel list until `linked` flips (the card above swaps to the linked view).
  useQuery({ ...channelsQuery, refetchInterval: left > 0 ? 4_000 : false });

  if (left === 0) {
    return (
      <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-border p-4 text-[13px]">
        <p className="font-medium">That code expired.</p>
        <p className="text-muted">Codes work for {Math.round(code.expires_in / 60)} minutes. Get a new one and send it right away.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={renewing} onClick={onNew}>New code</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">Your link code</span>
        <Pill tone={left > 60 ? "info" : "warn"} className="tabular"><TimerIcon size={13} /> {mm}:{ss}</Pill>
      </div>
      <p className="font-mono text-[30px] leading-none font-semibold tracking-[0.18em] break-all text-fg tabular">{code.code}</p>
      <p className="text-[13px] text-muted">
        From your own WhatsApp, send <span className="whitespace-nowrap"><Code>LINK {code.code}</Code></span> to {number ? <span className="font-medium text-fg tabular">{number}</span> : "the office number"}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {code.url ? (
          <Button asChild size="sm" className="max-sm:flex-1">
            <a href={code.url} target="_blank" rel="noreferrer"><WhatsappLogoIcon size={15} /> Open WhatsApp <ArrowSquareOutIcon size={13} /></a>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="flex items-center gap-2 text-[12.5px] text-muted">
        <CircleNotchIcon size={14} className="shrink-0 animate-spin" /> Waiting for your message…
      </p>
    </div>
  );
}

/** Every user: link my own WhatsApp, send a test, unlink. */
function WhatsAppMe({ ch, ready, number }: { ch: ChannelOut; ready: boolean; number: string | null }) {
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const mine = ch.links.find((l) => l.user_id === me.user.id);
  const [code, setCode] = useState<(LinkCode & { at: number }) | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const link = useMutation({
    mutationFn: () => api<LinkCode>(`/api/channels/${ch.id}/link-code`, "POST"),
    onSuccess: (c) => setCode({ ...c, at: Date.now() }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => api<{ state: string; error?: string }>(`/api/channels/${ch.id}/whatsapp/test`, "POST"),
    onSuccess: (r) => {
      if (r.state === "sent") toast.success("Sent. Check WhatsApp on your phone.");
      else if (r.state === "failed") toast.error(r.error ? `Not sent: ${r.error}` : "Not sent. See the delivery ledger.");
      else toast(r.state === "retrying" ? `Not sent yet, retrying${r.error ? `: ${r.error}` : "."}` : `Queued (${r.state}).`);
      qc.invalidateQueries({ queryKey: ["deliveries"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const linked = ch.linked;
  useEffect(() => {
    if (linked && code) toast.success("Your WhatsApp is linked.");
  }, [linked, code]);

  return (
    <div className="grid gap-2.5">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><UserCircleIcon size={16} className="text-muted" /> Your WhatsApp</h3>
      {linked ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-4">
          <div className="flex items-start gap-3">
            <IconTile icon={CheckCircleIcon} tone="ok" size="sm" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                Linked{mine?.display ? <span className="font-normal text-muted tabular">{mine.display}</span> : null}
              </p>
              <p className="text-[12.5px] text-muted">Approvals and questions reach you here. Message the office number to chat with your assistant.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}><PaperPlaneTiltIcon size={15} /> Send a test</Button>
            {mine ? <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(true)}><LinkBreakIcon size={15} /> Unlink</Button> : null}
          </div>
        </div>
      ) : code ? (
        <LinkCodeBox code={code} number={number} onNew={() => link.mutate()} renewing={link.isPending} onCancel={() => setCode(null)} />
      ) : (
        <div className="grid gap-3">
          <p className="text-[13px] text-muted">
            {ready ? "Link your own WhatsApp so the office knows it is you. Only linked people can message it." : "Linking opens once the office number is connected."}
          </p>
          <Button size="sm" variant={ready ? "primary" : "secondary"} className="w-fit max-sm:w-full" loading={link.isPending} disabled={!ready} onClick={() => link.mutate()}>
            <WhatsappLogoIcon size={15} /> Link my WhatsApp
          </Button>
        </div>
      )}
      <ConfirmDialog open={confirmUnlink} onOpenChange={setConfirmUnlink} title="Unlink your WhatsApp?" confirmLabel="Unlink" danger
        body="The office stops messaging you on WhatsApp, and messages from your number are ignored. You can link again any time."
        onConfirm={async () => {
          if (!mine) return;
          try {
            await api(`/api/channels/links/${mine.id}`, "DELETE");
            setCode(null);
            await qc.invalidateQueries({ queryKey: integrationKeys.channels });
            toast.success("Unlinked.");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </div>
  );
}

function WhatsAppCard({ ch, canManage }: { ch: ChannelOut; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const statusQ = useQuery(whatsappStatusQuery(ch.id));
  const st = statusQ.data;
  const provider = st?.provider ?? ch.provider ?? "waha";
  const status: WaStatus = statusQ.error && !st ? "UNREACHABLE" : st?.status ?? ch.status ?? "UNKNOWN";
  const digits = st?.number ?? ch.number ?? null;
  const number = waNumber(digits);
  const [confirm, setConfirm] = useState<null | "logout" | "remove" | { linkId: string; name: string }>(null);

  // The list keeps a cached number (the link code's wa.me URL uses it): refresh it when it changes.
  const listNumber = ch.number ?? null;
  useEffect(() => {
    if (st?.number && st.number !== listNumber) void qc.invalidateQueries({ queryKey: integrationKeys.channels });
  }, [st?.number, listNumber, qc]);

  const merge = (s: Partial<WhatsAppStatus>) =>
    qc.setQueryData(integrationKeys.whatsapp(ch.id), (old: WhatsAppStatus | undefined) => (old ? { ...old, error: undefined, ...s } : old));
  const start = useMutation({
    mutationFn: () => api<WhatsAppStatus>(`/api/channels/${ch.id}/whatsapp/start`, "POST"),
    onSuccess: (s) => { merge(s); toast.success("Session restarted."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(`/api/channels/${ch.id}`, "PATCH", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.channels }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pill = WA_PILL[status];
  const active = agents.filter((a) => a.status === "active" && !a.view_only);
  const dm = ch.bindings.find((b) => b.match === "dm");

  const runConfirm = async () => {
    try {
      if (confirm === "logout") {
        const s = await api<WhatsAppStatus>(`/api/channels/${ch.id}/whatsapp/logout`, "POST");
        merge(s);
        await qc.invalidateQueries({ queryKey: integrationKeys.channels });
        toast.success("Logged out. Scan a new code to connect again.");
      } else if (confirm === "remove") {
        await api(`/api/channels/${ch.id}`, "DELETE");
        qc.removeQueries({ queryKey: integrationKeys.whatsapp(ch.id) });
        await qc.invalidateQueries({ queryKey: integrationKeys.channels });
        toast.success("WhatsApp removed.");
      } else if (confirm) {
        await api(`/api/channels/links/${confirm.linkId}`, "DELETE");
        await qc.invalidateQueries({ queryKey: integrationKeys.channels });
        toast.success(`${confirm.name} is unlinked.`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card data-guide="channels.whatsapp">
      <CardHeader
        icon={<IconTile icon={WhatsappLogoIcon} tone="ok" size="sm" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{ch.name}</span>
            {ch.enabled ? <Pill tone={pill.tone} live={pill.live}>{pill.label}</Pill> : <Pill>Off</Pill>}
          </span>
        }
        description={<span className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-1.5"><Meta items={[number ? <span key="n" className="tabular">{number}</span> : null, provider === "meta" ? "Meta Cloud API" : "WAHA, self-hosted"]} /></span>}
        actions={canManage ? <SwitchField checked={ch.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="Running" /> : null}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><DeviceMobileIcon size={16} className="text-muted" /> Office number</h3>
          <OfficeNumber ch={ch} st={st} loading={statusQ.isLoading} fetchError={st ? null : statusQ.error} canManage={canManage}
            onStart={() => start.mutate()} starting={start.isPending}
            onCheck={() => void statusQ.refetch()} checking={statusQ.isFetching} />
          {canManage && provider === "meta" && st ? <MetaWebhook st={st} /> : null}
        </div>

        <div className="grid min-w-0 content-start gap-5 border-border max-lg:border-t max-lg:pt-5 lg:border-l lg:pl-5">
          <WhatsAppMe ch={ch} ready={status === "WORKING" && ch.enabled} number={number} />

          {canManage ? (
            <div className="grid gap-2.5">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <UsersIcon size={16} className="text-muted" /> People linked
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted tabular">{ch.links.length}</span>
              </h3>
              {ch.links.length ? (
                <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border">
                  {ch.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                      <IconTile icon={UserCircleIcon} size="sm" tone="neutral" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words">{l.user_name}</span>
                        <span className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-1.5 text-[12px] text-muted">
                          <Meta items={[<span key="n" className="tabular">{l.display}</span>, `Linked ${timeAgo(l.created_at).toLowerCase()}`]} />
                        </span>
                      </span>
                      <Button size="icon" variant="ghost" aria-label={`Unlink ${l.user_name}`} onClick={() => setConfirm({ linkId: l.id, name: l.user_name })}><LinkBreakIcon size={15} /></Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-sm border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted">
                  Nobody yet. Each person opens this page and presses Link my WhatsApp.
                </p>
              )}
            </div>
          ) : null}

          <div className="grid gap-2.5">
            <div>
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ChatsCircleIcon size={16} className="text-muted" /> Who answers</h3>
              <p className="text-[12.5px] text-muted">Each person's messages go to their own personal assistant (or an agent they own), unless you pick one agent for every chat.</p>
            </div>
            {canManage ? (
              <BindingRow ch={ch} match="dm" label="Private chats" agents={active} noneLabel="Each person's own assistant" />
            ) : (
              <p className="text-[13px] text-muted">Private chats: <span className="text-fg">{dm ? dm.agent_name : "your own assistant"}</span></p>
            )}
          </div>
        </div>
      </CardBody>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-5">
          {provider === "waha" ? (
            <Button size="sm" variant="outline" loading={start.isPending} onClick={() => start.mutate()}><ArrowClockwiseIcon size={14} /> Restart session</Button>
          ) : null}
          {provider === "waha" && status === "WORKING" ? (
            <Button size="sm" variant="outline" onClick={() => setConfirm("logout")}><SignOutIcon size={14} /> Log out</Button>
          ) : null}
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger sm:ml-auto" onClick={() => setConfirm("remove")}><TrashIcon size={14} /> Remove WhatsApp</Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        danger
        title={confirm === "logout" ? "Log out the office phone?" : confirm === "remove" ? "Remove WhatsApp?" : `Unlink ${confirm?.name ?? ""}?`}
        confirmLabel={confirm === "logout" ? "Log out" : confirm === "remove" ? "Remove" : "Unlink"}
        body={confirm === "logout"
          ? "WhatsApp on the office phone is disconnected from this office. Nobody gets messages until someone scans a new code."
          : confirm === "remove"
            ? "This removes the WhatsApp channel, everyone's links and its settings. People stop getting messages on WhatsApp."
            : "They stop getting messages on WhatsApp and their number is ignored until they link again."}
        onConfirm={runConfirm}
      />
    </Card>
  );
}

function WhatsApp({ canManage }: { canManage: boolean }) {
  const { data: channels, isLoading } = useQuery(channelsQuery);
  if (isLoading) return <Skeleton className="h-72 rounded-[var(--radius-md)]" />;
  const ch = channels?.find((c) => c.kind === "whatsapp");
  return ch ? <WhatsAppCard ch={ch} canManage={canManage} /> : <WhatsAppSetup canManage={canManage} />;
}

// ---------------------------------------------------------------- gmail

function GoogleSetup({ g, onDone }: { g: GoogleStatus; onDone?: () => void }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [guide, setGuide] = useState(!g.configured);
  const id = clientId.trim();
  const idErr = id && !id.endsWith(".apps.googleusercontent.com")
    ? "That is not an OAuth Client ID. It ends with .apps.googleusercontent.com (an API key will not work)."
    : undefined;
  const save = useMutation({
    mutationFn: () => api<GoogleStatus>("/api/integrations/google", "PUT", { client_id: id, client_secret: secret.trim() }),
    onSuccess: (r) => {
      qc.setQueryData(integrationKeys.google, r);
      qc.invalidateQueries({ queryKey: ["assistants"] });
      setClientId("");
      setSecret("");
      toast.success("Google sign-in is set up. Everyone can now connect their Gmail.");
      onDone?.();
    },
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
      <div className="grid min-w-0 content-start gap-3">
        <p className="flex items-start gap-2 rounded-sm border border-info/25 bg-info/8 px-3 py-2.5 text-[12.5px]">
          <InfoIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-info" />
          <span className="min-w-0">An API key cannot read Gmail. Google sign-in needs an <span className="font-medium">OAuth client ID</span>, which ends in <Code>.apps.googleusercontent.com</Code>.</span>
        </p>
        <Disclosure open={guide} onOpenChange={setGuide} title="Step by step: create the OAuth client in Google Cloud">
          <Steps items={[
            <>In <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">Google Cloud Console</a>, go to <Kbd>APIs &amp; Services</Kbd> &gt; <Kbd>Library</Kbd> and enable the <Kbd>Gmail API</Kbd> and the <Kbd>Google Calendar API</Kbd>. The project that holds your existing API key is fine.</>,
            <>Open <Kbd>OAuth consent screen</Kbd>: choose <Kbd>External</Kbd> (or <Kbd>Internal</Kbd> on Google Workspace), add your email as a <Kbd>Test user</Kbd>, and add the scopes <Code>gmail.readonly</Code>, <Code>gmail.compose</Code> and <Code>calendar.events</Code>.</>,
            <>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-accent hover:underline">Credentials</a> &gt; <Kbd>Create credentials</Kbd> &gt; <Kbd>OAuth client ID</Kbd> &gt; <Kbd>Web application</Kbd>. Under <Kbd>Authorised redirect URIs</Kbd>, add the redirect URI shown here.</>,
            <>Copy the <Kbd>Client ID</Kbd> and <Kbd>Client secret</Kbd> into this form and save.</>,
          ]} />
        </Disclosure>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (id && secret.trim() && !idErr) save.mutate(); }} className="grid min-w-0 content-start gap-3">
        <CopyRow label="Authorised redirect URI" value={g.redirect_uri} />
        <Field label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" autoComplete="off" spellCheck={false} error={idErr} />
        <Field label="Client secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" autoComplete="new-password" hint="Stored encrypted. It is never shown again." />
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="max-sm:flex-1" loading={save.isPending} disabled={!id || secret.trim().length < 6 || !!idErr}>
            <ShieldCheckIcon size={16} /> {g.configured ? "Replace Google sign-in" : "Save Google sign-in"}
          </Button>
          {onDone ? <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button> : null}
        </div>
      </form>
    </div>
  );
}

function Gmail() {
  const qc = useQueryClient();
  const { data: g, isLoading } = useQuery(googleQuery);
  const [editing, setEditing] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/api/integrations/google/connect", "POST"),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const acct = g?.account ?? null;
  const pill = !g ? null
    : acct?.status === "connected" ? <Pill tone="ok" live>Connected</Pill>
      : acct ? <Pill tone="danger">Needs attention</Pill>
        : g.configured ? <Pill>Not connected</Pill> : <Pill>Not set up</Pill>;

  return (
    <Card>
      <CardHeader
        icon={<IconTile icon={GoogleLogoIcon} tone="info" size="sm" />}
        title="Gmail"
        description="Your assistants read your Gmail and calendar, draft replies and propose events for you."
        actions={pill}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border bg-surface-2/40 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { icon: EnvelopeSimpleIcon, title: "Reads your inbox", body: "Searches and reads mail when you ask. Reading is free." },
            { icon: PencilSimpleLineIcon, title: "Drafts replies", body: "Writes reply drafts for you. Nothing is sent on its own." },
            { icon: ShieldCheckIcon, title: "You approve", body: "Every email waits for you to approve it before it goes out." },
          ].map((f) => (
            <li key={f.title} className="flex items-start gap-2.5 p-3">
              <f.icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-info" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{f.title}</span>
                <span className="block text-[12.5px] text-muted">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>

        {isLoading || !g ? <Skeleton className="h-20" /> : !g.configured ? (
          g.can_configure ? (
            <div className="grid gap-3 border-t border-border pt-5">
              <div>
                <h3 className="text-[13.5px] font-semibold">Set up Google sign-in</h3>
                <p className="text-[12.5px] text-muted">Once, for the whole office. Then each person connects their own Gmail.</p>
              </div>
              <GoogleSetup g={g} />
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-sm border border-dashed border-border px-3 py-4 text-[13px] text-muted">
              <InfoIcon size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0">Ask an admin to set up Google sign-in. Then you can connect your Gmail here.</span>
            </p>
          )
        ) : (
          <div className="grid gap-4 border-t border-border pt-5">
            {acct ? (
              <div className={cn("flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border p-4", acct.status === "error" ? "border-danger/30 bg-danger/6" : "border-border")}>
                <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
                  <IconTile icon={acct.status === "error" ? WarningCircleIcon : EnvelopeSimpleIcon} tone={acct.status === "error" ? "danger" : "info"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium break-all">{acct.email}</p>
                    <p className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-1.5 text-[12.5px] text-muted">
                      <Meta items={[`Connected ${timeAgo(acct.connected_at).toLowerCase()}`, acct.can_send ? "Can draft replies" : "Read only", acct.calendar ? "Calendar" : "No calendar"]} />
                    </p>
                    {acct.status === "error" ? (
                      <p className="mt-1.5 text-[12.5px] break-words text-danger">{acct.last_error || "Google stopped accepting this connection."} Reconnect to fix it.</p>
                    ) : !acct.can_send ? (
                      <p className="mt-1.5 text-[12.5px] text-muted">Drafting was not allowed at sign-in. Reconnect and tick the Gmail compose permission.</p>
                    ) : !acct.calendar ? (
                      <p className="mt-1.5 text-[12.5px] text-muted">Connected before calendar access was added. Reconnect Google and tick the calendar box so your assistants can read your calendar and propose events.</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:pl-11">
                  {acct.status === "error" || !acct.can_send ? (
                    <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><ArrowClockwiseIcon size={14} /> Reconnect</Button>
                  ) : !acct.calendar ? (
                    <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><CalendarPlusIcon size={14} /> Reconnect Google to add Calendar</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}><LinkBreakIcon size={15} /> Disconnect</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 basis-64 text-[13px] text-muted">Google asks you to pick your account and allow access, then brings you back to My assistants.</p>
                <Button className="max-sm:w-full" loading={connect.isPending} onClick={() => connect.mutate()}><GoogleLogoIcon size={16} weight="bold" /> Connect my Gmail</Button>
              </div>
            )}
            {g.can_configure ? (
              editing ? (
                <div className="grid gap-3 border-t border-border pt-4">
                  <h3 className="text-[13.5px] font-semibold">Replace the OAuth client</h3>
                  <GoogleSetup g={g} onDone={() => setEditing(false)} />
                </div>
              ) : (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-[12.5px] text-muted">
                  <ShieldCheckIcon size={14} className="shrink-0 text-ok" /> Google sign-in is set up for the office.
                  <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">Change OAuth client</button>
                </p>
              )
            ) : null}
          </div>
        )}
      </CardBody>
      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title="Disconnect your Gmail?" confirmLabel="Disconnect" danger
        body="Your assistants can no longer read your mail or draft replies."
        onConfirm={async () => {
          try {
            await api("/api/integrations/google/account", "DELETE");
            await qc.invalidateQueries({ queryKey: integrationKeys.google });
            qc.invalidateQueries({ queryKey: ["assistants"] });
            toast.success("Gmail disconnected.");
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </Card>
  );
}

// ---------------------------------------------------------------- tokens

function tokenState(t: TokenOut): { label: string; tone: "neutral" | "warn" | "ok" } {
  if (t.revoked) return { label: "Revoked", tone: "neutral" };
  if (t.expires_at && new Date(t.expires_at) < new Date()) return { label: "Expired", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

function Tokens() {
  const qc = useQueryClient();
  const { data: tokens = [] } = useQuery({ queryKey: ["tokens"], queryFn: () => api<TokenOut[]>("/api/tokens") });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [made, setMade] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<TokenOut & { token: string }>("/api/tokens", "POST", { name, scopes: ["chat"], expires_days: days === "never" ? null : Number(days) }),
    onSuccess: (t) => { setMade(t.token); setName(""); qc.invalidateQueries({ queryKey: ["tokens"] }); },
  });
  const revoke = async (id: string) => {
    try {
      await api(`/api/tokens/${id}`, "DELETE");
      qc.invalidateQueries({ queryKey: ["tokens"] });
      toast.success("Revoked. Apps using it stop working now.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const base = `${window.location.origin}/api/v1`;
  const copyBase = () => void navigator.clipboard.writeText(base).then(() => toast.success("Copied."), () => toast.error("Copy blocked by the browser."));
  return (
    <Card>
      <CardHeader
        icon={<IconTile icon={PlugIcon} tone="violet" size="sm" />}
        title="API tokens"
        description="Talk to agents from any OpenAI-compatible app (Open WebUI, scripts, editors): base URL and a token."
        actions={<Button size="sm" onClick={() => { setMade(null); setOpen(true); }}><PlusIcon size={14} weight="bold" /> New token</Button>}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-sm border border-border bg-surface-2/40 p-3 text-[13px] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">Base URL</dt>
            <dd className="flex items-start gap-1.5">
              <span className="min-w-0 font-mono text-[12.5px] break-all">{base}</span>
              <button type="button" onClick={copyBase} aria-label="Copy base URL" className="-my-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg"><CopyIcon size={14} /></button>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">Model</dt>
            <dd className="font-mono text-[12.5px] break-all">agent/&lt;agent name&gt;</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted">List agents</dt>
            <dd className="font-mono text-[12.5px]">GET /models</dd>
          </div>
        </dl>
        {tokens.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-sm border border-border">
            {tokens.map((t) => {
              const st = tokenState(t);
              return (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <IconTile icon={KeyIcon} size="sm" tone={st.tone === "ok" ? "accent" : "neutral"} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 font-medium break-words">{t.name}</span>
                      <span className="font-mono text-[12px] text-muted">{t.prefix}…</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                      <Meta items={[
                        t.last_used_at ? `Used ${timeAgo(t.last_used_at).toLowerCase()}` : "Never used",
                        t.expires_at ? `Expires ${new Date(t.expires_at).toLocaleDateString()}` : "No expiry",
                      ]} />
                    </p>
                  </div>
                  {!t.revoked ? <Button size="sm" variant="ghost" className="shrink-0 text-danger" onClick={() => revoke(t.id)}>Revoke</Button> : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="rounded-sm border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted">No tokens yet. Create one for each app that should talk to your agents.</p>}
      </CardBody>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={made ? "Copy your token now" : "New API token"}
        description={made ? "It is shown once. Store it in the app that will use it." : "Lets an app chat with your agents. It cannot change settings."}
        footer={made ? <Button onClick={() => setOpen(false)}>Done</Button> : <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Create token</Button>}>
        {made ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={made} className="min-w-0 font-mono text-[12.5px]" aria-label="Token" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(made).then(() => toast.success("Copied."))}><CopyIcon size={16} /></Button>
            </div>
            <pre className="overflow-x-auto rounded-sm bg-surface-2 p-3 text-[11.5px] leading-relaxed">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${made.slice(0, 10)}…" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "agent/aina", "messages": [{"role": "user", "content": "Hi"}]}'`}</pre>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Open WebUI on the office PC" autoFocus />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Expires</span>
              <Select value={days} onValueChange={setDays} label="Expires" className="w-full"
                options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days" }, { value: "365", label: "In a year" }, { value: "never", label: "Never" }]} />
            </div>
            <FormError message={create.error ? errorMessage(create.error) : null} />
          </div>
        )}
      </ResponsiveDialog>
    </Card>
  );
}

// ---------------------------------------------------------------- ledger

function DeliveryLedger() {
  const qc = useQueryClient();
  const [state, setState] = useState<(typeof STATES)[number]>("all");
  const { data } = useQuery({ queryKey: ["deliveries", state], queryFn: () => api<Ledger>(`/api/deliveries?state=${state}`), refetchInterval: 15_000 });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/deliveries/${id}/retry`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deliveries"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<IconTile icon={ListChecksIcon} tone="neutral" size="sm" />}
        title="Delivery ledger"
        description="Every notification and reply, so nothing is lost or sent twice."
      />
      <div className="border-b border-border px-4 py-2.5 sm:px-5">
        <Segmented
          size="sm"
          label="Which deliveries"
          value={state}
          onChange={setState}
          options={STATES.map((s) => ({
            value: s,
            label: s === "all" ? "All" : s[0]!.toUpperCase() + s.slice(1),
            count: data ? (s === "all" ? total : counts[s] ?? 0) : undefined,
          }))}
        />
      </div>
      {data?.items.length ? (
        <>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border md:hidden">
            {data.items.map((d) => (
              <li key={d.id} className="grid gap-1 px-4 py-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[13px] font-medium break-words">{d.summary || d.kind}</p>
                  <Pill tone={STATE_TONE[d.state as keyof typeof STATE_TONE] ?? "neutral"}>{d.state}{d.attempts > 1 ? ` (${d.attempts} tries)` : ""}</Pill>
                </div>
                <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                  <Meta items={[channelLabel(d.channel), d.kind, timeAgo(d.created_at)]} />
                </p>
                {d.last_error ? <p className="text-[12px] break-words text-danger">{d.last_error}</p> : null}
                {d.state === "failed" ? <Button size="sm" variant="outline" className="mt-1 w-fit" onClick={() => retry.mutate(d.id)}><ArrowClockwiseIcon size={14} /> Retry</Button> : null}
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface-2/60 text-[12px] text-muted">
                <tr><th className="px-5 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Where</th><th className="px-4 py-2 font-medium">State</th><th className="px-4 py-2 font-medium">When</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((d) => (
                  <tr key={d.id} className="transition-colors hover:bg-surface-2/40">
                    <td className="max-w-96 px-5 py-2.5"><span className="line-clamp-2 break-words">{d.summary || d.kind}</span>{d.last_error ? <span className="block truncate text-[12px] text-danger" title={d.last_error}>{d.last_error}</span> : null}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{channelLabel(d.channel)} · {d.kind}</td>
                    <td className="px-4 py-2.5"><Pill tone={STATE_TONE[d.state as keyof typeof STATE_TONE] ?? "neutral"}>{d.state}{d.attempts > 1 ? ` (${d.attempts} tries)` : ""}</Pill></td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{timeAgo(d.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">{d.state === "failed" ? <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>Retry</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : data ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted">{state === "all" ? "Nothing sent yet." : `No ${state} deliveries.`}</p>
      ) : (
        <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      )}
    </Card>
  );
}

export function ChannelsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("channels.manage");
  return (
    <Page>
      <PageHeader title="Channels" description="Reach your office from your phone: notifications, Telegram, WhatsApp, Gmail, and apps that speak the OpenAI API." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <ThisDevice />
        <Telegram canManage={canManage} />
      </div>
      <WhatsApp canManage={canManage} />
      <Gmail />
      {canManage ? <Tokens /> : null}
      {canManage ? <DeliveryLedger /> : null}
    </Page>
  );
}
