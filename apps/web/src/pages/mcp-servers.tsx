import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  LockSimpleIcon,
  PlugsConnectedIcon,
  PlusIcon,
  PuzzlePieceIcon,
  TrashIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface McpTool {
  name: string;
  description: string;
}
interface McpServer {
  id: string;
  name: string;
  url: string;
  description: string;
  enabled: boolean;
  has_auth: boolean;
  tool_count: number;
  tools: McpTool[];
  agent_ids: string[];
  health: string;
  last_error: string | null;
  created_by: string;
  created_at: string;
}

const serversQuery = queryOptions({
  queryKey: ["mcp-servers"],
  queryFn: () => api<McpServer[]>("/api/mcp-servers"),
});

function AddDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [auth, setAuth] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api<McpServer>("/api/mcp-servers", "POST", {
        name: name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
        url: url.trim(),
        description: description.trim(),
        auth_header: auth.trim(),
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast[s.health === "ok" ? "success" : "warning"](
        s.health === "ok" ? `Connected "${s.name}" — ${s.tool_count} tools.` : `Added, but could not reach it: ${s.last_error}`,
      );
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="Connect an MCP server" className="w-[min(96vw,40rem)]"
      description="Give the server's HTTP endpoint. The office will list its tools and offer them to agents through the tool bridge. Only http(s) servers are supported; the office never runs local programs."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim() || !url.trim()} loading={add.isPending} onClick={() => add.mutate()}>Connect</Button></>}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. tracker" autoFocus
            hint="How agents refer to it (letters, numbers, - _)." />
          <Field label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/rpc" />
        </div>
        <Field label="What it does (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Our issue tracker" />
        <Field label="Auth header (optional)" value={auth} onChange={(e) => setAuth(e.target.value)} placeholder="Authorization: Bearer …"
          hint="Stored encrypted. Leave empty for a public server." />
        <FormError message={add.error ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function ServerCard({ s }: { s: McpServer }) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const refresh = useMutation({
    mutationFn: () => api<McpServer>(`/api/mcp-servers/${s.id}/refresh`, "POST"),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["mcp-servers"] }); toast.success(`Refreshed — ${r.tool_count} tools.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<McpServer>(`/api/mcp-servers/${s.id}`, "PATCH", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-servers"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/mcp-servers/${s.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mcp-servers"] }); toast.success(`${s.name} removed.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const tone = s.health === "ok" ? "ok" : s.health === "down" ? "danger" : "neutral";
  return (
    <Card className={cn("flex flex-col", !s.enabled && "opacity-75")}>
      <div className="flex items-start gap-3 p-4">
        <IconTile icon={PuzzlePieceIcon} tone={s.enabled ? tone === "neutral" ? "accent" : tone : "neutral"} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-mono text-[14px] font-semibold break-all">{s.name}</span>
            <Pill tone={tone} live={s.health === "ok"} className="capitalize">{s.health}</Pill>
            {s.has_auth ? <Pill><LockSimpleIcon size={11} weight="bold" /> Auth</Pill> : null}
          </p>
          {s.description ? <p className="mt-0.5 text-[12.5px] break-words text-muted">{s.description}</p> : null}
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted" title={s.url}>{s.url}</p>
        </div>
        <Switch.Root
          checked={s.enabled}
          onCheckedChange={(v) => toggle.mutate(v)}
          aria-label={s.enabled ? `Turn off ${s.name}` : `Turn on ${s.name}`}
          className="relative mt-1 h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
        >
          <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
        </Switch.Root>
      </div>
      {s.last_error && s.health !== "ok" ? (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-sm bg-danger/8 px-3 py-2 text-[12.5px] break-words text-danger">
          <WarningCircleIcon size={14} weight="fill" className="mt-0.5 shrink-0" /> <span className="min-w-0">{s.last_error}</span>
        </p>
      ) : null}
      <div className="grid gap-2 border-t border-border bg-surface-2/30 px-4 py-3">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <WrenchIcon size={13} /> {s.tool_count} {s.tool_count === 1 ? "tool" : "tools"}
        </p>
        {s.tools.length ? (
          <div className="flex flex-wrap gap-1.5">
            {s.tools.slice(0, 10).map((t) => <Pill key={t.name} tone="neutral" title={t.description} className="font-mono text-[11.5px]">{t.name}</Pill>)}
            {s.tools.length > 10 ? <Pill tone="accent">+{s.tools.length - 10} more</Pill> : null}
          </div>
        ) : <p className="text-[12.5px] text-muted">No tools discovered.</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
        <span className="min-w-0 flex-1 text-[12px] text-muted">Added {timeAgo(s.created_at).toLowerCase()}</span>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> Remove</Button>
        <Button size="sm" variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate()}><ArrowClockwiseIcon size={14} /> Refresh tools</Button>
      </div>
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Remove ${s.name}?`} danger confirmLabel="Remove"
        body="Agents will no longer see its tools." onConfirm={async () => { await del.mutateAsync(); }} />
    </Card>
  );
}

export function McpServersPage() {
  const { data: servers = [], isLoading, error } = useQuery(serversQuery);
  const [adding, setAdding] = useState(false);
  const on = servers.filter((s) => s.enabled);
  const healthy = on.filter((s) => s.health === "ok").length;
  const down = on.filter((s) => s.health === "down").length;
  const tools = on.reduce((n, s) => n + s.tool_count, 0);
  return (
    <Page>
      <PageHeader title="MCP tools"
        description="Connect external MCP servers — a project tracker, a CRM, or a company's own server — and their tools become available to agents. Agents find them with a search bridge and every call is approved first, so their schemas never clog the prompt."
        actions={<Button data-guide="mcp-servers.add" onClick={() => setAdding(true)}><PlusIcon size={16} weight="bold" /> Connect server</Button>} />
      {isLoading ? (
        <div className="grid gap-5">
          <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-[var(--radius-md)]" />)}</div>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load MCP servers. {errorMessage(error)}</div>
      ) : !servers.length ? (
          <EmptyState icon={PlugsConnectedIcon} title="No MCP servers connected"
            body="MCP (Model Context Protocol) lets one connection add many tools. Point the office at a server's HTTP endpoint and its tools appear for your agents, behind the usual approvals."
            action={<Button onClick={() => setAdding(true)}><PlusIcon size={16} weight="bold" /> Connect a server</Button>} />
      ) : (
        <>
          <StatGrid>
            <Stat label="Servers" value={servers.length} icon={PlugsConnectedIcon} hint={servers.length - on.length ? `${servers.length - on.length} turned off` : "All turned on"} />
            <Stat label="Reachable" value={healthy} icon={CheckCircleIcon} tone="ok" hint={`of ${on.length} turned on`} />
            <Stat label="Unreachable" value={down} icon={WarningCircleIcon} tone={down ? "danger" : "neutral"} hint={down ? "Check the address or auth" : "Nothing failing"} />
            <Stat label="Tools offered" value={tools} icon={WrenchIcon} tone="info" hint="From servers turned on" />
          </StatGrid>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">{servers.map((s) => <ServerCard key={s.id} s={s} />)}</div>
        </>
      )}
      {adding ? <AddDialog onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}
