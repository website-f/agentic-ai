import {
  ArrowClockwiseIcon,
  BellRingingIcon,
  CopyIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  KeyIcon,
  ListChecksIcon,
  PaperPlaneTiltIcon,
  PlugIcon,
  PlusIcon,
  TelegramLogoIcon,
  TrashIcon,
  UserCircleIcon,
  ChatsCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { canInstall, disablePush, enablePush, install, isIOS, onInstallChange, pushState, type PushState } from "@/lib/push";
import { meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

interface Device { id: string; label: string; created_at: string; last_ok_at: string | null; failures: number; service: string }
interface ChannelOut {
  id: string; kind: "telegram"; name: string; enabled: boolean; bot_username: string | null; last_error: string | null;
  links: { id: string; user_id: string; user_name: string; display: string; created_at: string }[];
  linked: boolean;
  bindings: { id: string; match: string; agent_id: string; agent_name: string }[];
}
interface TokenOut { id: string; name: string; prefix: string; scopes: string[]; created_at: string; created_by_name: string | null; expires_at: string | null; last_used_at: string | null; revoked: boolean }
interface Ledger { counts: Record<string, number>; items: { id: string; channel: string; kind: string; state: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; summary: string }[] }

const STATE_TONE = { pending: "info", sent: "ok", failed: "danger", skipped: "neutral" } as const;
const STATES = ["all", "pending", "sent", "failed", "skipped"] as const;

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
    <Card>
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

function BindingRow({ ch, match, label, agents }: { ch: ChannelOut; match: string; label: string; agents: { id: string; name: string; role: string }[] }) {
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
        options={[{ value: "none", label: "Nobody answers" }, ...agents.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))]} />
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
  const { data: channels, isLoading } = useQuery({ queryKey: ["channels"], queryFn: () => api<ChannelOut[]>("/api/channels") });
  const [token, setToken] = useState("");
  const add = useMutation({
    mutationFn: () => api("/api/channels/telegram", "POST", { token }),
    onSuccess: () => { setToken(""); qc.invalidateQueries({ queryKey: ["channels"] }); toast.success("Bot connected."); },
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (channels?.length) return <div className="grid gap-4">{channels.map((ch) => <TelegramCard key={ch.id} ch={ch} canManage={canManage} />)}</div>;
  return (
    <Card>
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
                  <Meta items={[d.channel === "webpush" ? "Push" : "Telegram", d.kind, timeAgo(d.created_at)]} />
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
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{d.channel === "webpush" ? "Push" : "Telegram"} · {d.kind}</td>
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
      <PageHeader title="Channels" description="Reach your office from your phone: notifications, Telegram, and apps that speak the OpenAI API." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-2">
        <ThisDevice />
        <Telegram canManage={canManage} />
      </div>
      {canManage ? <Tokens /> : null}
      {canManage ? <DeliveryLedger /> : null}
    </Page>
  );
}
