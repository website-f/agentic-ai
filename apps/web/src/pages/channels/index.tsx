import {
  ArrowClockwiseIcon,
  BellRingingIcon,
  CopyIcon,
  DeviceMobileIcon,
  DownloadSimpleIcon,
  KeyIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  TelegramLogoIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
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

const card = "grid gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5";

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
    <Section title="This device" description="Get a notification when an agent needs a decision, and approve it from the lock screen.">
      <div className={card}>
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
        <div className="flex flex-wrap gap-2">
          {state === "on" ? <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}><PaperPlaneTiltIcon size={15} /> Send a test</Button> : null}
          {installable ? (
            <Button size="sm" variant="outline" onClick={() => void install().then((ok) => ok && toast.success("Installed. Open it from your home screen or apps."))}>
              <DownloadSimpleIcon size={15} /> Install the app
            </Button>
          ) : null}
          {!installable && !isIOS() ? <p className="text-[12.5px] text-muted">To install: the browser menu, then Install app (or Add to Home screen).</p> : null}
        </div>
        {devices.length ? (
          <div className="grid gap-1.5">
            <h3 className="text-[13px] font-semibold">Your devices</h3>
            <ul className="divide-y divide-border rounded-sm border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <DeviceMobileIcon size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.label}</span>
                    <span className="block text-[12px] text-muted">
                      {d.last_ok_at ? `Last delivered ${timeAgo(d.last_ok_at).toLowerCase()}` : `Added ${timeAgo(d.created_at).toLowerCase()}`}
                      {d.failures ? ` · ${d.failures} failed` : ""}
                    </span>
                  </span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${d.label}`} onClick={() => removeDevice(d.id)}><TrashIcon size={14} /></Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
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
    <div className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <span className="text-[13px]">{label}</span>
      <Select value={current?.agent_id ?? "none"} onValueChange={(v) => save.mutate(v)} label={`Agent for ${label}`} size="sm"
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
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <TelegramLogoIcon size={20} weight="fill" className="text-info" />
        <span className="text-[14px] font-semibold">{ch.name}</span>
        {ch.bot_username ? <a href={`https://t.me/${ch.bot_username}`} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:underline">t.me/{ch.bot_username}</a> : null}
        <Pill tone={ch.enabled ? "ok" : "neutral"}>{ch.enabled ? "On" : "Off"}</Pill>
        {canManage ? <span className="ml-auto"><SwitchField checked={ch.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="Running" /></span> : null}
      </div>
      {ch.last_error ? <p role="alert" className="text-[12.5px] text-danger">Telegram said: {ch.last_error}</p> : null}

      <div className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Your account</h3>
        {ch.linked ? <p className="text-[13px] text-muted">Linked. Approvals reach you on Telegram with Approve and Deny buttons; reply to a question to answer it.</p> : (
          <>
            <p className="text-[13px] text-muted">Link your Telegram so the bot knows it is you. Only linked people can use it.</p>
            {code ? (
              <div className="grid gap-1.5 rounded-sm border border-border bg-surface-2/50 p-3 text-[13px]">
                {code.url ? <a href={code.url} target="_blank" rel="noreferrer" className="w-fit font-medium text-accent hover:underline">Open Telegram and press Start</a> : null}
                <span className="text-muted">or send <span className="font-mono text-fg">/start {code.code}</span> to the bot. The code works for 10 minutes.</span>
                <Button size="sm" variant="ghost" className="w-fit" onClick={() => qc.invalidateQueries({ queryKey: ["channels"] })}><ArrowClockwiseIcon size={14} /> I did it</Button>
              </div>
            ) : <Button size="sm" className="w-fit" loading={link.isPending} onClick={() => link.mutate()}>Link my account</Button>}
          </>
        )}
        {canManage && ch.links.length ? (
          <p className="text-[12.5px] text-muted">Linked: {ch.links.map((l) => `${l.user_name} (${l.display})`).join(", ")}</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <h3 className="text-[13px] font-semibold">Who answers</h3>
        <p className="text-[12.5px] text-muted">Messages from linked people go to an agent. A specific chat beats groups, groups beat direct messages.</p>
        {canManage ? (
          <>
            <BindingRow ch={ch} match="dm" label="Direct messages" agents={active} />
            <BindingRow ch={ch} match="group" label="Group chats" agents={active} />
            {custom.map((b) => <BindingRow key={b.id} ch={ch} match={b.match} label={`Chat ${b.match.slice(5)}`} agents={active} />)}
            <div className="grid items-center gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Chat id, e.g. -1001234" className="h-8 text-[13px]" aria-label="Chat id" />
              <Select value="" onValueChange={(v) => bindChat.mutate(v)} label="Agent for that chat" size="sm" disabled={!/^-?\d+$/.test(chatId.trim())}
                options={active.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))} />
            </div>
          </>
        ) : (
          <ul className="text-[13px] text-muted">
            {ch.bindings.length ? ch.bindings.map((b) => <li key={b.id}>{b.match === "dm" ? "Direct messages" : b.match === "group" ? "Groups" : `Chat ${b.match.slice(5)}`}: {b.agent_name}</li>) : <li>No agent answers yet.</li>}
          </ul>
        )}
      </div>
    </div>
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
  return (
    <Section title="Telegram" description="Approve from Telegram and chat with an agent. Works on a laptop with no public address (the worker polls Telegram).">
      {isLoading ? <Skeleton className="h-32 rounded-[var(--radius-md)]" /> : channels?.length ? (
        <div className="grid gap-3">{channels.map((ch) => <TelegramCard key={ch.id} ch={ch} canManage={canManage} />)}</div>
      ) : canManage ? (
        <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) add.mutate(); }} className={card}>
          <p className="text-[13.5px]">Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent hover:underline">@BotFather</a> (send <span className="font-mono">/newbot</span>), then paste the token it gives you.</p>
          <Field label="Bot token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." autoComplete="off" hint="Checked with Telegram, then stored encrypted. It is never shown again." />
          <Button type="submit" className="w-fit" loading={add.isPending} disabled={token.trim().length < 20}><TelegramLogoIcon size={16} /> Connect the bot</Button>
          <FormError message={add.error ? errorMessage(add.error) : null} />
        </form>
      ) : <p className="text-[13.5px] text-muted">No Telegram bot yet. An owner or admin can connect one.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- tokens

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
  return (
    <Section title="API tokens" description="Talk to agents from any OpenAI-compatible app (Open WebUI, scripts, editors): base URL and a token."
      actions={<Button size="sm" onClick={() => { setMade(null); setOpen(true); }}><PlusIcon size={14} weight="bold" /> New token</Button>}>
      <div className={card}>
        <p className="text-[13px]">Base URL <span className="font-mono">{base}</span> · model <span className="font-mono">agent/&lt;agent name&gt;</span> · <span className="font-mono">GET /models</span> lists them.</p>
        {tokens.length ? (
          <ul className="divide-y divide-border rounded-sm border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <KeyIcon size={15} className="text-muted" />
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-[12px] text-muted">{t.prefix}…</span>
                {t.revoked ? <Pill tone="neutral">Revoked</Pill> : t.expires_at && new Date(t.expires_at) < new Date() ? <Pill tone="warn">Expired</Pill> : <Pill tone="ok">Active</Pill>}
                <span className="text-[12px] text-muted">{t.last_used_at ? `used ${timeAgo(t.last_used_at).toLowerCase()}` : "never used"}{t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ""}</span>
                {!t.revoked ? <Button size="sm" variant="ghost" className="ml-auto" onClick={() => revoke(t.id)}>Revoke</Button> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted">No tokens yet.</p>}
      </div>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={made ? "Copy your token now" : "New API token"}
        description={made ? "It is shown once. Store it in the app that will use it." : "Lets an app chat with your agents. It cannot change settings."}
        footer={made ? <Button onClick={() => setOpen(false)}>Done</Button> : <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Create token</Button>}>
        {made ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <Input readOnly value={made} className="font-mono text-[12.5px]" aria-label="Token" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(made).then(() => toast.success("Copied."))}><CopyIcon size={16} /></Button>
            </div>
            <pre className="overflow-x-auto rounded-sm bg-surface-2 p-3 text-[11.5px] leading-relaxed">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${made.slice(0, 10)}…" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "agent/aina", "messages": [{"role": "user", "content": "Hi"}]}'`}</pre>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Open WebUI on the office PC" autoFocus />
            <Select value={days} onValueChange={setDays} label="Expires"
              options={[{ value: "30", label: "In 30 days" }, { value: "90", label: "In 90 days" }, { value: "365", label: "In a year" }, { value: "never", label: "Never" }]} />
            <FormError message={create.error ? errorMessage(create.error) : null} />
          </div>
        )}
      </ResponsiveDialog>
    </Section>
  );
}

// ---------------------------------------------------------------- ledger

function DeliveryLedger() {
  const qc = useQueryClient();
  const [state, setState] = useState("all");
  const { data } = useQuery({ queryKey: ["deliveries", state], queryFn: () => api<Ledger>(`/api/deliveries?state=${state}`), refetchInterval: 15_000 });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/deliveries/${id}/retry`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deliveries"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Delivery ledger" description="Every notification and reply, so nothing is lost or sent twice."
      actions={<Select value={state} onValueChange={setState} label="Which deliveries" size="sm" options={["all", "pending", "sent", "failed", "skipped"].map((s) => ({ value: s, label: s === "all" ? "All" : s[0]!.toUpperCase() + s.slice(1) }))} />}>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
        {data?.items.length ? (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-muted">
              <tr><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Where</th><th className="px-4 py-2 font-medium">State</th><th className="px-4 py-2 font-medium max-sm:hidden">When</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((d) => (
                <tr key={d.id}>
                  <td className="max-w-80 px-4 py-2"><span className="line-clamp-1">{d.summary || d.kind}</span>{d.last_error ? <span className="block truncate text-[12px] text-danger">{d.last_error}</span> : null}</td>
                  <td className="px-4 py-2 text-muted">{d.channel === "webpush" ? "Push" : "Telegram"} · {d.kind}</td>
                  <td className="px-4 py-2"><Pill tone={STATE_TONE[d.state as keyof typeof STATE_TONE] ?? "neutral"}>{d.state}{d.attempts > 1 ? ` (${d.attempts} tries)` : ""}</Pill></td>
                  <td className="px-4 py-2 text-muted max-sm:hidden">{timeAgo(d.created_at)}</td>
                  <td className="px-4 py-2 text-right">{d.state === "failed" ? <Button size="sm" variant="ghost" onClick={() => retry.mutate(d.id)}>Retry</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-6 text-[13px] text-muted">Nothing sent yet.</p>}
      </div>
    </Section>
  );
}

export function ChannelsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("channels.manage");
  return (
    <Page>
      <PageHeader title="Channels" description={<><BellRingingIcon size={15} className="mr-1 inline align-[-2px]" />Reach your office from your phone: notifications, Telegram, and apps that speak the OpenAI API.</>} />
      <div className="grid gap-8">
        <ThisDevice />
        <Telegram canManage={canManage} />
        {canManage ? <Tokens /> : null}
        {canManage ? <DeliveryLedger /> : null}
      </div>
    </Page>
  );
}
