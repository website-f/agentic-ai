import {
  ArrowLeftIcon, CheckCircleIcon, FlowArrowIcon, HandIcon, PencilSimpleLineIcon, PlusIcon, RobotIcon, SparkleIcon, SquaresFourIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, Toolbar } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { runsQuery, workflowsQuery, type Graph, type Workflow } from "@/lib/workflows";

import { WorkflowEditor, type Draft } from "./editor";
import { itemFor } from "./library";
import { RecentRuns, RunView } from "./run";
import { TEMPLATES, type WorkflowTemplate } from "./templates";

const EXAMPLES = [
  "When a supplier invoice arrives: read it, ask finance for the PO number, check it matches, the manager approves, record it in the payables sheet and email the supplier.",
  "Every Friday: gather the week's sales and spend files, work out the totals vs last week, write a one-page summary, and share it with management.",
  "A customer complains: summarise it, decide how urgent it is, hand urgent ones to operations, reply to the customer, then follow up after two days.",
];

/** A row of the step icons in a graph: a quick picture of what the workflow does. */
function StepStrip({ graph, max = 7 }: { graph: Graph; max?: number }) {
  const steps = graph.nodes.filter((n) => n.type !== "note" && n.type !== "start" && n.type !== "end");
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {steps.slice(0, max).map((n) => {
        const it = itemFor(n);
        return <IconTile key={n.id} icon={it.icon} tone={it.tone} size="sm" className="size-7 [&_svg]:size-3.5" />;
      })}
      {steps.length > max ? <span className="ml-0.5 text-[11.5px] text-muted">+{steps.length - max}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- new workflow

function NewWorkflowDialog({ onClose, onStart }: { onClose: () => void; onStart: (d: Draft) => void }) {
  const [mode, setMode] = useState<"choose" | "ai" | "template">("choose");
  const [text, setText] = useState("");
  const [area, setArea] = useState<string>("All");
  const draft = useMutation({
    mutationFn: () => api<{ graph: Graph }>("/api/workflows/draft", "POST", { description: text }),
    onSuccess: (r) => {
      const first = text.trim().split(/[.:\n]/)[0]!.replace(/^(when|every|a|an)\s+/i, "").slice(0, 60);
      onStart({ name: first ? first[0]!.toUpperCase() + first.slice(1) : "New workflow", description: text.trim().slice(0, 300), graph: r.graph });
      toast.success("Drafted. Change anything on the board, then save.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const areas = ["All", ...new Set(TEMPLATES.map((t) => t.area))];
  const shown = TEMPLATES.filter((t) => area === "All" || t.area === area);
  const pick = (t: WorkflowTemplate) => onStart({ name: t.name, description: t.description, graph: structuredClone(t.graph) });

  const title = mode === "ai" ? "Describe it, AI draws it" : mode === "template" ? "Start from a template" : "New workflow";
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={title} className={mode === "template" ? "w-[min(96vw,60rem)]" : "w-[min(96vw,44rem)]"}
      description={mode === "choose" ? "Hand a whole job to your agents: map it once, and they follow it every time." : undefined}
      footer={mode === "ai" ? (
        <>
          <Button variant="outline" onClick={() => setMode("choose")}><ArrowLeftIcon size={14} /> Back</Button>
          <Button loading={draft.isPending} disabled={text.trim().length < 10} onClick={() => draft.mutate()}><SparkleIcon size={15} /> Draft it</Button>
        </>
      ) : mode === "template" ? <Button variant="outline" onClick={() => setMode("choose")}><ArrowLeftIcon size={14} /> Back</Button> : undefined}>
      {mode === "choose" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { key: "blank", icon: PencilSimpleLineIcon, tone: "accent" as const, title: "Draw it yourself", body: "An empty board and the full step library. Drag, connect, done." },
            { key: "ai", icon: SparkleIcon, tone: "violet" as const, title: "Ask AI to draft it", body: "Describe the job in your own words; an analyst agent draws the steps." },
            { key: "template", icon: SquaresFourIcon, tone: "info" as const, title: "Start from a template", body: `${TEMPLATES.length} ready-made office workflows to adapt.` },
          ].map((o) => (
            <button key={o.key} type="button"
              onClick={() => (o.key === "blank" ? onStart({ name: "", description: "", graph: { nodes: [], edges: [] } }) : setMode(o.key as "ai" | "template"))}
              className="grid content-start gap-3 rounded-[var(--radius-md)] border border-border p-4 text-left transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-[var(--shadow-soft)]">
              <IconTile icon={o.icon} tone={o.tone} size="lg" />
              <span>
                <span className="block text-[14px] font-semibold">{o.title}</span>
                <span className="mt-1 block text-[12.5px] text-muted">{o.body}</span>
              </span>
            </button>
          ))}
        </div>
      ) : mode === "ai" ? (
        <div className="grid gap-3">
          <TextareaField label="The job, in your own words" rows={6} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            hint="Say who does what, where it branches, who approves, and what 'done' means. You can change everything afterwards."
            placeholder="e.g. When a new client enquiry comes in, sales qualifies it…" />
          <div className="grid gap-1.5">
            <span className="text-[12px] font-medium text-muted">Or try one of these</span>
            {EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setText(x)} className="rounded-sm border border-border px-3 py-2 text-left text-[12.5px] text-muted hover:border-accent hover:text-fg">{x}</button>
            ))}
          </div>
          <FormError message={draft.error ? errorMessage(draft.error) : null} />
        </div>
      ) : (
        <div className="grid gap-3">
          <Segmented label="Area" value={area} onChange={setArea} size="sm" options={areas.map((a) => ({ value: a, label: a }))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <button key={t.id} type="button" onClick={() => pick(t)}
                className="grid content-start gap-2.5 rounded-[var(--radius-md)] border border-border p-3.5 text-left transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-[var(--shadow-soft)]">
                <div className="flex items-center justify-between gap-2">
                  <Pill>{t.area}</Pill>
                  <span className="text-[11.5px] text-muted">{t.graph.nodes.length} steps</span>
                </div>
                <span className="text-[14px] font-semibold">{t.name}</span>
                <span className="text-[12.5px] text-muted">{t.description}</span>
                <StepStrip graph={t.graph} max={6} />
              </button>
            ))}
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- list

function WorkflowCard({ wf, onOpen }: { wf: Workflow; onOpen: () => void }) {
  return (
    <Card interactive className="p-0">
      <button type="button" onClick={onOpen} className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 p-4 text-left">
        <div className="flex items-start gap-3">
          <IconTile icon={FlowArrowIcon} tone={wf.status === "active" ? "accent" : "neutral"} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] leading-snug font-semibold break-words">{wf.name}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">{wf.steps} {wf.steps === 1 ? "step" : "steps"}</span>
          </span>
          <Pill tone={wf.status === "active" ? "ok" : "neutral"}>{wf.status === "active" ? "Active" : "Draft"}</Pill>
        </div>
        {wf.description ? <span className="line-clamp-2 text-[13px] break-words text-muted">{wf.description}</span> : null}
        <StepStrip graph={wf.graph} />
        {wf.agent_ids.length || wf.source === "analyst" ? (
          <div className="flex flex-wrap gap-1.5">
            {wf.agent_ids.length ? <Pill tone="accent">{wf.agent_ids.length} {wf.agent_ids.length === 1 ? "agent follows" : "agents follow"}</Pill> : null}
            {wf.source === "analyst" ? <Pill tone="info">AI-drafted</Pill> : null}
          </div>
        ) : null}
      </button>
    </Card>
  );
}

export function WorkflowsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const { data: workflows = [], isLoading, error } = useQuery(workflowsQuery);
  const { data: runs = [] } = useQuery(runsQuery());
  const search = useSearch({ strict: false }) as { w?: string; run?: string };
  const navigate = useNavigate();
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "active" | "draft">("all");

  const open = (id?: string) => navigate({ to: "/workflows", search: id ? { w: id } : {}, replace: true });
  const openRun = (id: string) => navigate({ to: "/workflows", search: { run: id } });
  const editing = search.w ? workflows.find((w) => w.id === search.w) ?? null : null;

  if (search.run) {
    return <Page wide><RunView key={search.run} id={search.run} /></Page>;
  }
  if (search.w && !editing && isLoading) return <Skeleton className="m-4 h-[70dvh] rounded-[var(--radius-lg)]" />;
  if (draft || editing) {
    return (
      <WorkflowEditor key={editing?.id ?? "new"} existing={editing} initial={draft}
        onClose={() => { setDraft(null); open(); }}
        onSaved={(wf) => { if (!editing) { setDraft(null); open(wf.id); } }}
        onOpenRun={openRun} />
    );
  }

  const needle = q.trim().toLowerCase();
  const shown = workflows.filter((w) => (show === "all" || w.status === show) && (!needle || `${w.name} ${w.description}`.toLowerCase().includes(needle)));
  return (
    <Page>
      <PageHeader title="Workflows"
        description="Hand whole jobs to your agents. Map how a job is done (steps, decisions, approvals, waits), draw it yourself or let AI draft it, then run it, give it with a task, or make it an agent's standard way of working."
        actions={canManage ? <Button onClick={() => setChoosing(true)}><PlusIcon size={16} weight="bold" /> New workflow</Button> : null} />
      {workflows.length ? (
        <StatGrid>
          <Stat label="Workflows" value={workflows.length} icon={FlowArrowIcon} tone="accent" hint={`${TEMPLATES.length} templates to start from`} />
          <Stat label="Active" value={workflows.filter((w) => w.status === "active").length} icon={CheckCircleIcon} tone="ok" hint="Followed by their agents" />
          <Stat label="Recent runs" value={runs.length} icon={RobotIcon} tone="info" hint={runs.some((r) => r.status === "running") ? `${runs.filter((r) => r.status === "running").length} running now` : "None running"} />
          <Stat label="Needs you" value={runs.reduce((n, r) => n + r.needs_you, 0)} icon={HandIcon} tone={runs.some((r) => r.needs_you) ? "warn" : "neutral"} hint="Decisions, answers, reviews" />
        </StatGrid>
      ) : null}
      {workflows.length ? (
        <Toolbar>
          <Segmented label="Show" value={show} onChange={setShow} options={[
            { value: "all", label: "All", count: workflows.length },
            { value: "active", label: "Active", count: workflows.filter((w) => w.status === "active").length },
            { value: "draft", label: "Drafts", count: workflows.filter((w) => w.status === "draft").length },
          ]} />
          <SearchInput value={q} onChange={setQ} placeholder="Search workflows" />
        </Toolbar>
      ) : null}
      {isLoading ? <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-[var(--radius-md)]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !workflows.length ? (
          <EmptyState icon={FlowArrowIcon} title="No workflows yet"
            body="A workflow is a map of how a job gets done: each step, who does it, where it branches and who approves. Start from one of the templates, describe it for AI, or draw it."
            action={canManage ? <Button onClick={() => setChoosing(true)}><PlusIcon size={16} weight="bold" /> Create the first one</Button> : undefined} />
        ) : !shown.length ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">Nothing matches.</p>
        ) : (
          <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3")}>
            {shown.map((wf) => <WorkflowCard key={wf.id} wf={wf} onOpen={() => open(wf.id)} />)}
          </div>
        )}
      <RecentRuns onOpen={openRun} />
      {choosing ? <NewWorkflowDialog onClose={() => setChoosing(false)} onStart={(d) => { setChoosing(false); setDraft(d); }} /> : null}
    </Page>
  );
}
