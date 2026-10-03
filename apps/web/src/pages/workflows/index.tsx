import {
  ArrowLeftIcon, CheckCircleIcon, FlowArrowIcon, HandIcon, InfoIcon, PlayIcon, PlusIcon, RobotIcon, SparkleIcon, TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { agentsQuery, workKeys } from "@/lib/work";
import {
  NODE_TYPES, newNodeId, runsQuery, workflowKeys, workflowsQuery,
  type Graph, type NodeType, type WNode, type Workflow,
} from "@/lib/workflows";
import { meQuery } from "@/lib/queries";

import { Canvas } from "./canvas";
import { RecentRuns, RunView, StartRunDialog } from "./run";

type Sel = { kind: "node" | "edge"; id: string } | null;
const BLANK: Graph = { nodes: [], edges: [] };

function DraftDialog({ open, onOpenChange, onDraft }: { open: boolean; onOpenChange: (o: boolean) => void; onDraft: (g: Graph) => void }) {
  const [text, setText] = useState("");
  const draft = useMutation({
    mutationFn: () => api<{ graph: Graph }>("/api/workflows/draft", "POST", { description: text }),
    onSuccess: (r) => { onDraft(r.graph); toast.success("Drafted. Edit it on the canvas, then save."); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Draft from a description"
      description="Describe the job in plain words. An analyst agent turns it into steps you can edit."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button loading={draft.isPending} disabled={text.trim().length < 10} onClick={() => draft.mutate()}><SparkleIcon size={15} /> Draft it</Button></>}>
      <TextareaField label="What is the procedure?" value={text} onChange={(e) => setText(e.target.value)} rows={6}
        placeholder="e.g. When a new client enquiry comes in: a sales agent qualifies it, research checks the company, if it fits finance prepares a quote, otherwise we send a polite decline." />
    </ResponsiveDialog>
  );
}

const NOBODY = "__none";

function NodePanel({ node, onChange, onDelete }: { node: WNode; onChange: (n: Partial<WNode>) => void; onDelete: () => void }) {
  const { data: agents = [] } = useQuery(agentsQuery);
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of);
  const work = node.type === "step" || node.type === "handoff";
  const agentPick = (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">Agent when it runs</span>
      <Select value={node.agent_id || NOBODY} onValueChange={(v) => onChange({ agent_id: v === NOBODY ? "" : v })} label="Agent"
        options={[{ value: NOBODY, label: "Choose when the run starts" }, ...usable.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))]} />
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-accent/40 bg-surface p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: NODE_TYPES.find((t) => t.type === node.type)?.color }} />
          <span className="truncate">Edit step</span>
        </h3>
        <Button size="sm" variant="ghost" className="hover:text-danger" onClick={onDelete}><TrashIcon size={14} /> Delete</Button>
      </div>
      <Field label="Title" value={node.title} onChange={(e) => onChange({ title: e.target.value })} />
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Type</span>
        <Select value={node.type} onValueChange={(v) => onChange({ type: v as NodeType })} label="Type"
          options={NODE_TYPES.map((t) => ({ value: t.type, label: t.label }))} />
      </div>
      <Field label="Who does it (optional)" value={node.role} onChange={(e) => onChange({ role: e.target.value })} placeholder="e.g. Finance" />
      <TextareaField label="Details" value={node.body} onChange={(e) => onChange({ body: e.target.value })} rows={4}
        placeholder="What happens at this step." />
      {work ? (
        <>
          {agentPick}
          <SwitchField checked={!!node.review} onCheckedChange={(v) => onChange({ review: v })}
            label="I review it before it moves on" hint="The run waits until you accept the result (or send it back)." />
        </>
      ) : null}
      {node.type === "decision" ? (
        <>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Who decides when it runs</span>
            <Select value={node.decider ?? "person"} onValueChange={(v) => onChange({ decider: v as "person" | "agent" })} label="Who decides"
              options={[{ value: "person", label: "A person (the run waits for you)" }, { value: "agent", label: "An agent picks a branch" }]} />
          </div>
          {node.decider === "agent" ? agentPick : null}
          <p className="text-[12px] text-muted">Label each connection out of this step (e.g. yes / no): those are the choices.</p>
        </>
      ) : null}
    </div>
  );
}

function Editor({ existing, onDone, onOpenRun }: { existing: Workflow | null; onDone: () => void; onOpenRun: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const mine = agents.filter((a) => a.status !== "retired" && !a.clone_of && a.can_manage);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [graph, setGraph] = useState<Graph>(existing?.graph ?? BLANK);
  const [status, setStatus] = useState<"draft" | "active">(existing?.status ?? "draft");
  const [agentIds, setAgentIds] = useState<string[]>(existing?.agent_ids ?? []);
  const [sel, setSel] = useState<Sel>(null);
  const [drafting, setDrafting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [running, setRunning] = useState(false);
  const dirty = !!existing && JSON.stringify(graph) !== JSON.stringify(existing.graph);

  const save = useMutation({
    mutationFn: () => {
      const payload = { name, description, graph, status, agent_ids: agentIds };
      return existing
        ? api<Workflow>(`/api/workflows/${existing.id}`, "PATCH", payload)
        : api<Workflow>("/api/workflows", "POST", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      toast.success(existing ? "Workflow saved." : `Workflow "${name}" created.`);
      onDone();
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/api/workflows/${existing!.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: workflowKeys.all }); toast.success("Workflow deleted."); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  const addNode = (type: NodeType) => {
    const n: WNode = { id: newNodeId(), type, title: NODE_TYPES.find((t) => t.type === type)!.label, body: "", role: "", x: 60 + graph.nodes.length % 3 * 250, y: 60 + Math.floor(graph.nodes.length / 3) * 140 };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, n] }));
    setSel({ kind: "node", id: n.id });
  };
  const patchNode = (id: string, p: Partial<WNode>) =>
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }));
  const deleteNode = (id: string) =>
    setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id) }));
  const selectedNode = sel?.kind === "node" ? graph.nodes.find((n) => n.id === sel.id) ?? null : null;
  const selectedEdge = sel?.kind === "edge" ? graph.edges.find((e) => e.id === sel.id) ?? null : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <button type="button" onClick={onDone} className="inline-flex min-h-9 w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg"><ArrowLeftIcon size={14} /> All workflows</button>
      <Card>
        <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <Field label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New client enquiry" error={fields.name} />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button variant="outline" onClick={() => setDrafting(true)}><SparkleIcon size={15} /> Draft with AI</Button>
              {existing ? <Button variant="ghost" className="hover:text-danger" onClick={() => setRemoving(true)}><TrashIcon size={15} /> Delete</Button> : null}
              <Button variant={existing ? "outline" : "primary"} loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button>
              {existing ? (
                <Button disabled={dirty || !graph.nodes.length} title={dirty ? "Save your changes first" : undefined} onClick={() => setRunning(true)}>
                  <PlayIcon size={15} weight="fill" /> Run
                </Button>
              ) : null}
            </div>
          </div>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line: what this procedure is for" aria-label="Description" />
          {dirty ? <p className="flex items-center gap-1.5 text-[12.5px] text-warn"><InfoIcon size={14} weight="fill" /> Unsaved changes on the canvas. Save before running.</p> : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-muted">Add a step:</span>
          {NODE_TYPES.map((t) => (
            <button type="button" key={t.type} onClick={() => addNode(t.type)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[12.5px] font-medium transition-colors hover:border-accent/40 hover:bg-surface-2 sm:min-h-8">
              <span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} /> {t.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">Drag a card to move it; drag from its bottom dot to another card to connect.<span className="sm:hidden"> Drag the dotted background to pan.</span></p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <Canvas graph={graph} onChange={setGraph} selected={sel} onSelect={setSel} />
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          {selectedNode ? (
            <NodePanel node={selectedNode} onChange={(p) => patchNode(selectedNode.id, p)} onDelete={() => { deleteNode(selectedNode.id); setSel(null); }} />
          ) : selectedEdge ? (
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-accent/40 bg-surface p-4 shadow-[var(--shadow-soft)]">
              <h3 className="text-[14px] font-semibold">Connection</h3>
              <Field label="Label (for a decision branch)" value={selectedEdge.label}
                onChange={(e) => setGraph((g) => ({ ...g, edges: g.edges.map((ed) => ed.id === selectedEdge.id ? { ...ed, label: e.target.value } : ed) }))}
                placeholder="e.g. yes / no" />
            </div>
          ) : (
            <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted">Select a step or a connection to edit it.</p>
          )}

          <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <h3 className="text-[14px] font-semibold">When it's ready</h3>
            <SwitchField checked={status === "active"} onCheckedChange={(v) => setStatus(v ? "active" : "draft")}
              label="Active" hint="Active workflows are followed by the agents you attach below." />
            <fieldset className="mt-1 grid gap-2">
              <legend className="text-[13px] font-medium">Agents that follow it</legend>
              {mine.length ? (
                <div className="flex flex-wrap gap-2">
                  {mine.map((a) => {
                    const on = agentIds.includes(a.id);
                    return (
                      <button key={a.id} type="button" aria-pressed={on} onClick={() => setAgentIds((s) => on ? s.filter((x) => x !== a.id) : [...s, a.id])}
                        className={cn("min-h-9 rounded-full border px-3 py-1 text-[12.5px] transition-colors sm:min-h-8", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-2")}>
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              ) : <p className="text-[12.5px] text-muted">No agents you can manage yet.</p>}
            </fieldset>
          </div>
        </div>
      </div>
      <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />

      {existing ? <RecentRuns workflowId={existing.id} onOpen={onOpenRun} /> : null}
      {running && existing ? <StartRunDialog wf={existing} onClose={() => setRunning(false)} /> : null}
      {drafting ? <DraftDialog open onOpenChange={setDrafting} onDraft={(g) => { setGraph(g); setSel(null); }} /> : null}
      {existing ? <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${existing.name}?`}
        body="Agents following it stop following it. Their past work is unaffected." confirmLabel="Delete" danger onConfirm={async () => { await del.mutateAsync(); }} /> : null}
    </div>
  );
}

function WorkflowCard({ wf, onOpen }: { wf: Workflow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-3">
        <IconTile icon={FlowArrowIcon} tone={wf.status === "active" ? "accent" : "neutral"} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] leading-snug font-semibold break-words">{wf.name}</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">{wf.steps} {wf.steps === 1 ? "step" : "steps"}</span>
        </span>
        <Pill tone={wf.status === "active" ? "ok" : "neutral"}>{wf.status === "active" ? "Active" : "Draft"}</Pill>
      </div>
      {wf.description ? <span className="line-clamp-2 text-[13px] break-words text-muted">{wf.description}</span> : null}
      {wf.agent_ids.length || wf.source === "analyst" ? (
        <div className="flex flex-wrap gap-1.5">
          {wf.agent_ids.length ? <Pill tone="accent">{wf.agent_ids.length} {wf.agent_ids.length === 1 ? "agent follows" : "agents follow"}</Pill> : null}
          {wf.source === "analyst" ? <Pill tone="info">AI-drafted</Pill> : null}
        </div>
      ) : null}
    </button>
  );
}

export function WorkflowsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const { data: workflows = [], isLoading, error } = useQuery(workflowsQuery);
  const { data: runs = [] } = useQuery(runsQuery());
  const search = useSearch({ strict: false }) as { w?: string; run?: string };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const open = (id?: string) => navigate({ to: "/workflows", search: id ? { w: id } : {}, replace: true });
  const openRun = (id: string) => navigate({ to: "/workflows", search: { run: id } });
  const editing = search.w ? workflows.find((w) => w.id === search.w) ?? null : null;

  if (search.run) {
    return <Page className="max-w-7xl"><RunView key={search.run} id={search.run} /></Page>;
  }
  if (creating || editing) {
    return (
      <Page className="max-w-6xl">
        <Editor existing={editing} onDone={() => { setCreating(false); open(); }} onOpenRun={openRun} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Workflows"
        description="Draw how a job is done — steps, decisions, hand-offs — or let an analyst agent draft it. Attach it to agents as the procedure they follow, or run a job through it: each step goes to its agent, and you take the decisions."
        actions={canManage ? <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New workflow</Button> : null} />
      {workflows.length ? (
        <StatGrid>
          <Stat label="Workflows" value={workflows.length} icon={FlowArrowIcon} tone="accent" />
          <Stat label="Active" value={workflows.filter((w) => w.status === "active").length} icon={CheckCircleIcon} tone="ok" hint="Followed by their agents" />
          <Stat label="Recent runs" value={runs.length} icon={RobotIcon} tone="info" hint={runs.some((r) => r.status === "running") ? `${runs.filter((r) => r.status === "running").length} running now` : "None running"} />
          <Stat label="Needs you" value={runs.reduce((n, r) => n + r.needs_you, 0)} icon={HandIcon} tone={runs.some((r) => r.needs_you) ? "warn" : "neutral"} hint="Decisions and reviews" />
        </StatGrid>
      ) : null}
      {isLoading ? <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-[var(--radius-md)]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !workflows.length ? (
          <EmptyState icon={FlowArrowIcon} title="No workflows yet"
            body="A workflow is a map of how a job gets done: each step, who does it, and where decisions branch. Agents you attach follow it like a trained process."
            action={canManage ? <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> Create first workflow</Button> : undefined} />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.map((wf) => <WorkflowCard key={wf.id} wf={wf} onOpen={() => open(wf.id)} />)}
          </div>
        )}
      <RecentRuns onOpen={openRun} />
    </Page>
  );
}
