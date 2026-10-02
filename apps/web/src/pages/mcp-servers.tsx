import { ArrowClockwiseIcon, PlugsConnectedIcon, PlusIcon, PuzzlePieceIcon, TrashIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

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
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent"><PuzzlePieceIcon size={18} weight="duotone" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[14px] font-semibold">{s.name}
            <Pill tone={s.health === "ok" ? "ok" : s.health === "down" ? "danger" : "neutral"}>{s.health}</Pill>
            {s.has_auth ? <Pill>auth</Pill> : null}
          </p>
          <p className="truncate text-[12.5px] text-muted">{s.description || s.url}</p>
        </div>
        <SwitchField checked={s.enabled} onCheckedChange={(v) => toggle.mutate(v)} label="" hint="" />
      </div>
      {s.last_error && s.health !== "ok" ? <p className="rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{s.last_error}</p> : null}
      {s.tools.length ? (
        <div className="flex flex-wrap gap-1.5">
          {s.tools.slice(0, 10).map((t) => <Pill key={t.name} tone="neutral" title={t.description}>{t.name}</Pill>)}
          {s.tools.length > 10 ? <Pill>+{s.tools.length - 10} more</Pill> : null}
        </div>
      ) : <p className="text-[12.5px] text-muted">No tools discovered.</p>}
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Button size="sm" variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate()}><ArrowClockwiseIcon size={14} /> Refresh tools</Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> Remove</Button>
        <span className="ml-auto">added {timeAgo(s.created_at)}</span>
      </div>
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Remove ${s.name}?`} danger confirmLabel="Remove"
        body="Agents will no longer see its tools." onConfirm={async () => { await del.mutateAsync(); }} />
    </div>
  );
}

export function McpServersPage() {
  const { data: servers = [], isLoading, error } = useQuery(serversQuery);
  const [adding, setAdding] = useState(false);
  return (
    <Page>
      <PageHeader title="MCP tools"
        description="Connect external MCP servers — a project tracker, a CRM, or a company's own server — and their tools become available to agents. Agents find them with a search bridge and every call is approved first, so their schemas never clog the prompt."
        actions={<Button onClick={() => setAdding(true)}><PlusIcon size={16} weight="bold" /> Connect server</Button>} />
      {isLoading ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !servers.length ? (
          <EmptyState icon={PlugsConnectedIcon} title="No MCP servers connected"
            body="MCP (Model Context Protocol) lets one connection add many tools. Point the office at a server's HTTP endpoint and its tools appear for your agents, behind the usual approvals."
            action={<Button onClick={() => setAdding(true)}><PlusIcon size={16} weight="bold" /> Connect a server</Button>} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">{servers.map((s) => <ServerCard key={s.id} s={s} />)}</div>
        )}
      {adding ? <AddDialog onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}
