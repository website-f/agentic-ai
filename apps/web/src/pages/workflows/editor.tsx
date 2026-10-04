/** The workflow editor: a full-screen board with the step library on the left, the canvas in
 * the middle and the selected step's settings on the right (sheets on smaller screens).
 * Undo/redo, keyboard shortcuts, tidy-up, a problems list and AI help to draft or improve. */
import {
  ArrowCounterClockwiseIcon, ArrowClockwiseIcon, ArrowLeftIcon, CaretDownIcon, CheckCircleIcon, CopyIcon, DotsThreeIcon,
  FlowArrowIcon, KeyboardIcon, ListBulletsIcon, PlayIcon, PlusIcon, SidebarSimpleIcon, SlidersHorizontalIcon,
  SparkleIcon, TrashIcon, TreeStructureIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { SwitchField } from "@/components/ui/switch";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { agentsQuery, workKeys } from "@/lib/work";
import { newNodeId, workflowKeys, type Graph, type WaitUnit, type WEdge, type WNode, type Workflow } from "@/lib/workflows";

import { Canvas, NODE_H, NODE_W } from "./canvas";
import { tidy } from "./layout";
import { GROUPS, itemFor, LIBRARY, libItem, type LibItem } from "./library";
import { RecentRuns, StartRunDialog } from "./run";

type Sel = { kind: "node" | "edge"; id: string } | null;
type Pt = { x: number; y: number };
interface Hist { past: Graph[]; future: Graph[] }
export interface Draft { name: string; description: string; graph: Graph }

const NOBODY = "__none";
const QUICK = ["task", "research", "write", "email", "template", "check", "decision", "approval", "input", "wait", "handoff", "end"];

// ---------------------------------------------------------------- problems

interface Issue { id?: string; text: string }

function findIssues(g: Graph): Issue[] {
  const flow = g.nodes.filter((n) => n.type !== "note");
  const ids = new Set(flow.map((n) => n.id));
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const out: Issue[] = [];
  if (!flow.length) return out;
  if (!flow.some((n) => n.type === "start")) out.push({ text: "Add a Start step so a run knows where the job comes in." });
  if (!flow.some((n) => n.type === "end")) out.push({ text: "Add an End step so it's clear when the job is finished." });
  for (const n of flow) {
    const ins = edges.filter((e) => e.to === n.id);
    const outs = edges.filter((e) => e.from === n.id);
    const name = `"${n.title || itemFor(n).label}"`;
    if (n.type !== "start" && !ins.length) out.push({ id: n.id, text: `${name} has nothing leading into it, so a run never reaches it.` });
    if (n.type !== "end" && !outs.length) out.push({ id: n.id, text: `${name} leads nowhere. Connect it to the next step or an End.` });
    if (n.type === "decision" && outs.length < 2) out.push({ id: n.id, text: `${name} needs at least two branches.` });
    if (n.type === "decision" && outs.some((e) => !e.label.trim())) out.push({ id: n.id, text: `Label every branch of ${name} (e.g. yes / no).` });
    if (n.type === "decision" && n.decider === "agent" && !n.agent_id && !n.role) out.push({ id: n.id, text: `Say which agent decides ${name}, or let a person decide.` });
  }
  // A connection back to an earlier step: a run does each step once, so the loop never repeats.
  const color = new Map<string, number>();
  const visit = (id: string): string | null => {
    color.set(id, 1);
    for (const e of edges) {
      if (e.from !== id) continue;
      const c = color.get(e.to) ?? 0;
      if (c === 1) return e.to;
      if (c === 0) { const hit = visit(e.to); if (hit) return hit; }
    }
    color.set(id, 2);
    return null;
  };
  for (const n of flow) {
    if ((color.get(n.id) ?? 0) === 0) {
      const hit = visit(n.id);
      if (hit) { out.push({ id: hit, text: `A connection loops back to "${g.nodes.find((x) => x.id === hit)?.title || "a step"}". A run does each step once; add a new step for the second pass instead.` }); break; }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the library (palette)

function Palette({ onAdd, compact }: { onAdd: (key: string) => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const items = LIBRARY.filter((i) => !needle || `${i.label} ${i.desc} ${i.group}`.toLowerCase().includes(needle));
  return (
    <div className="flex min-h-0 flex-col">
      <div className={cn("shrink-0", compact ? "pb-3" : "p-3 pb-2")}>
        <SearchInput value={q} onChange={setQ} placeholder="Search steps" />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "" : "px-3 pb-3")}>
        {GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="mb-3">
              <p className="mb-1.5 px-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase">{g}</p>
              <div className="grid gap-1">
                {list.map((i) => <PaletteItem key={i.key} item={i} onAdd={() => onAdd(i.key)} />)}
              </div>
            </div>
          );
        })}
        {!items.length ? <p className="px-1 py-6 text-center text-[13px] text-muted">No step matches "{q}".</p> : null}
      </div>
    </div>
  );
}

function PaletteItem({ item, onAdd }: { item: LibItem; onAdd: () => void }) {
  return (
    <button type="button" draggable onClick={onAdd}
      onDragStart={(e) => { e.dataTransfer.setData("application/x-workflow-step", item.key); e.dataTransfer.effectAllowed = "copy"; }}
      title={`${item.label}: ${item.desc}. Drag onto the board, or click to add.`}
      className="group grid min-h-11 w-full cursor-grab grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[var(--radius-sm)] border border-transparent px-1.5 py-1.5 text-left transition-colors hover:border-border hover:bg-surface active:cursor-grabbing">
      <IconTile icon={item.icon} tone={item.tone} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{item.label}</span>
        <span className="block truncate text-[11.5px] text-muted">{item.desc}</span>
      </span>
      <PlusIcon size={14} className="text-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------- quick add (connection dropped on empty space)

function QuickAdd({ at, onPick, onClose }: { at: Pt; onPick: (key: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = needle ? LIBRARY.filter((i) => i.type !== "start" && i.type !== "note" && `${i.label} ${i.desc}`.toLowerCase().includes(needle)) : QUICK.map((k) => libItem(k)!);
  return (
    <div className="absolute z-20 w-64 rounded-[var(--radius-md)] border border-border bg-surface p-2 shadow-[var(--shadow-pop)]"
      style={{ left: Math.max(8, at.x - 128), top: at.y + 8 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <span className="text-[12px] font-semibold">Add the next step</span>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-7 place-items-center rounded-sm text-muted hover:bg-surface-2"><XIcon size={13} /></button>
      </div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search steps"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && list[0]) onPick(list[0].key); }}
        className="mb-1.5 h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent" />
      <div className="grid max-h-64 gap-0.5 overflow-y-auto">
        {list.map((i) => (
          <button key={i.key} type="button" onClick={() => onPick(i.key)} className="flex min-h-9 items-center gap-2 rounded-sm px-1.5 text-left text-[13px] hover:bg-surface-2">
            <IconTile icon={i.icon} tone={i.tone} size="sm" className="size-7" /> <span className="truncate">{i.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector

function NodeInspector({ node, graph, onPatch, onKind, onDelete, onDuplicate, onEdgeLabel, onRemoveEdge, onSelect }: {
  node: WNode; graph: Graph;
  onPatch: (p: Partial<WNode>, field: string) => void;
  onKind: (key: string) => void;
  onDelete: () => void; onDuplicate: () => void;
  onEdgeLabel: (id: string, label: string) => void;
  onRemoveEdge: (id: string) => void;
  onSelect: (s: Sel) => void;
}) {
  const { data: agents = [] } = useQuery(agentsQuery);
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of && !a.view_only);
  const item = itemFor(node);
  const outs = graph.edges.filter((e) => e.from === node.id);
  const ins = graph.edges.filter((e) => e.to === node.id);
  const title = (id: string) => { const n = graph.nodes.find((x) => x.id === id); return n ? n.title || itemFor(n).label : "?"; };
  const work = node.type === "step" || node.type === "handoff";
  const agentPick = (label: string) => (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <Select value={node.agent_id || NOBODY} onValueChange={(v) => onPatch({ agent_id: v === NOBODY ? "" : v }, "agent")} label={label}
        options={[{ value: NOBODY, label: "Choose when the run starts" }, ...usable.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))]} />
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-start gap-3">
        <IconTile icon={item.icon} tone={item.tone} />
        <div className="min-w-0 flex-1">
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded-sm text-[11px] font-semibold tracking-[0.06em] text-muted uppercase hover:text-fg">
                {item.label} <CaretDownIcon size={11} />
              </button>
            </MenuTrigger>
            <MenuContent className="max-h-80 w-60 overflow-y-auto">
              {GROUPS.map((g) => (
                <div key={g}>
                  <MenuLabel>{g}</MenuLabel>
                  {LIBRARY.filter((i) => i.group === g).map((i) => (
                    <MenuItem key={i.key} icon={<i.icon />} onSelect={() => onKind(i.key)}>{i.label}</MenuItem>
                  ))}
                </div>
              ))}
            </MenuContent>
          </Menu>
          <p className="text-[12.5px] text-muted">{item.desc}</p>
        </div>
      </div>

      <Field label={node.type === "note" ? "Heading" : "Name of this step"} value={node.title} onChange={(e) => onPatch({ title: e.target.value }, "title")} />
      <TextareaField label={node.type === "input" ? "What to ask" : node.type === "note" ? "Note" : "What happens here"} rows={3} value={node.body}
        onChange={(e) => onPatch({ body: e.target.value }, "body")}
        placeholder={node.type === "input" ? "e.g. Which purchase order is this invoice for?" : node.type === "note" ? "Anything people should know" : "What this step produces, in a sentence."}
        hint={work ? "The agent gets this as its instructions, plus what the steps before it produced." : undefined} />

      {work ? (
        <>
          <Field label="Who does it (department or job)" value={node.role} onChange={(e) => onPatch({ role: e.target.value }, "role")} placeholder="e.g. Finance" hint="Used to suggest an agent when a run starts." />
          {agentPick("Agent")}
          <SwitchField checked={!!node.review} onCheckedChange={(v) => onPatch({ review: v }, "review")}
            label="I check it before it moves on" hint="The run waits until you accept the result (or send it back)." />
        </>
      ) : null}

      {node.type === "decision" ? (
        <>
          {node.action !== "approval" ? (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Who decides</span>
              <Select value={node.decider ?? "person"} onValueChange={(v) => onPatch({ decider: v as "person" | "agent" }, "decider")} label="Who decides"
                options={[{ value: "person", label: "A person (the run waits for you)" }, { value: "agent", label: "An agent picks a branch" }]} />
            </div>
          ) : <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">A person approves or rejects; the run waits for them.</p>}
          {node.decider === "agent" && node.action !== "approval" ? agentPick("Agent that decides") : null}
        </>
      ) : null}

      {node.type === "wait" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-end gap-2">
          <Field label="Wait for" type="number" min={1} max={999} value={String(node.wait_amount ?? 1)}
            onChange={(e) => onPatch({ wait_amount: Math.max(1, Math.min(999, Number(e.target.value) || 1)) }, "wait")} />
          <Select value={node.wait_unit ?? "hours"} onValueChange={(v) => onPatch({ wait_unit: v as WaitUnit }, "wait_unit")} label="Unit"
            options={[{ value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }, { value: "days", label: "Days" }]} />
        </div>
      ) : null}
      {node.type === "input" ? <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">The run pauses until someone types the answer. Every later step sees it.</p> : null}
      {node.type === "note" ? <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12.5px] text-muted">Notes are for people reading the workflow. Runs skip them.</p> : null}

      {node.type !== "note" && (outs.length || ins.length) ? (
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">{node.type === "decision" ? "Branches" : "Connections"}</span>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {outs.map((e) => (
              <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
                {node.type === "decision" ? (
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
                    <Input value={e.label} onChange={(ev) => onEdgeLabel(e.id, ev.target.value)} placeholder="label" aria-label={`Branch to ${title(e.to)}`} className="h-9" />
                    <button type="button" onClick={() => onSelect({ kind: "node", id: e.to })} className="truncate text-left text-[12.5px] text-muted hover:text-accent">→ {title(e.to)}</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => onSelect({ kind: "node", id: e.to })} className="truncate rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2">Next → {title(e.to)}</button>
                )}
                <button type="button" aria-label={`Remove connection to ${title(e.to)}`} onClick={() => onRemoveEdge(e.id)} className="grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-danger"><XIcon size={13} /></button>
              </li>
            ))}
            {ins.map((e) => (
              <li key={e.id}><button type="button" onClick={() => onSelect({ kind: "node", id: e.from })} className="w-full truncate rounded-sm px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-2">From ← {title(e.from)}{e.label ? ` (${e.label})` : ""}</button></li>
            ))}
          </ul>
          {node.type === "decision" ? <p className="text-[12px] text-muted">Drag from the step's bottom dot to add another branch.</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={onDuplicate}><CopyIcon size={14} /> Duplicate</Button>
        <Button size="sm" variant="ghost" className="hover:text-danger" onClick={onDelete}><TrashIcon size={14} /> Delete</Button>
      </div>
    </div>
  );
}

function EdgeInspector({ edge, graph, onLabel, onRemove, onInsert }: { edge: WEdge; graph: Graph; onLabel: (l: string) => void; onRemove: () => void; onInsert: () => void }) {
  const t = (id: string) => { const n = graph.nodes.find((x) => x.id === id); return n ? n.title || itemFor(n).label : "?"; };
  const fromDecision = graph.nodes.find((n) => n.id === edge.from)?.type === "decision";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-start gap-3">
        <IconTile icon={FlowArrowIcon} tone="neutral" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Connection</p>
          <p className="text-[13px] break-words">{t(edge.from)} → {t(edge.to)}</p>
        </div>
      </div>
      <Field label={fromDecision ? "Branch label" : "Label (optional)"} value={edge.label} onChange={(e) => onLabel(e.target.value)} placeholder={fromDecision ? "e.g. yes" : "e.g. if urgent"}
        hint={fromDecision ? "The choice a person (or agent) picks to go this way." : undefined} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={onInsert}><PlusIcon size={14} /> Insert a step here</Button>
        <Button size="sm" variant="ghost" className="hover:text-danger" onClick={onRemove}><TrashIcon size={14} /> Remove</Button>
      </div>
    </div>
  );
}

function WorkflowSettings({ description, setDescription, active, setActive, agentIds, setAgentIds, graph, procedure }: {
  description: string; setDescription: (v: string) => void;
  active: boolean; setActive: (v: boolean) => void;
  agentIds: string[]; setAgentIds: (f: (s: string[]) => string[]) => void;
  graph: Graph; procedure?: string;
}) {
  const { data: agents = [] } = useQuery(agentsQuery);
  const mine = agents.filter((a) => a.status !== "retired" && !a.clone_of && a.can_manage && !a.view_only);
  const counts = GROUPS.map((g) => [g, graph.nodes.filter((n) => itemFor(n).group === g).length] as const).filter(([, c]) => c);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">This workflow</p>
        <p className="text-[12.5px] text-muted">Select a step or connection to edit it.</p>
      </div>
      <TextareaField label="What it's for" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line: the job this handles" />
      <div className="flex flex-wrap gap-1.5">
        <Pill>{graph.nodes.filter((n) => n.type !== "note").length} steps</Pill>
        {counts.map(([g, c]) => <Pill key={g} tone="neutral">{g} {c}</Pill>)}
      </div>
      <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
        <SwitchField checked={active} onCheckedChange={setActive} label="Agents follow it"
          hint="Active workflows are added to the instructions of the agents below, like an SOP." />
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Agents that follow it</span>
          {mine.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mine.map((a) => {
                const on = agentIds.includes(a.id);
                return (
                  <button key={a.id} type="button" aria-pressed={on} onClick={() => setAgentIds((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                    className={cn("min-h-9 rounded-full border px-3 text-[12.5px] transition-colors", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-2")}>
                    {on ? <CheckCircleIcon size={13} weight="fill" className="mr-1 inline align-[-2px]" /> : null}{a.name}
                  </button>
                );
              })}
            </div>
          ) : <p className="text-[12.5px] text-muted">No agents you can manage yet.</p>}
        </div>
      </div>
      <div className="grid gap-1.5 rounded-[var(--radius-md)] border border-border p-3 text-[12.5px] text-muted">
        <span className="font-medium text-fg">Three ways to use it</span>
        <span><b className="font-medium text-fg">Run it</b>: each step goes to its agent, you take the decisions.</span>
        <span><b className="font-medium text-fg">Give it with a task</b>: pick it in New task; the agent follows the steps.</span>
        <span><b className="font-medium text-fg">Make it standard</b>: switch on "Agents follow it" above.</span>
      </div>
      {procedure ? (
        <details className="rounded-[var(--radius-md)] border border-border p-3 text-[12.5px]">
          <summary className="cursor-pointer font-medium">What agents read (as saved)</summary>
          <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted">{procedure}</pre>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- AI help

const IMPROVE_IDEAS = ["Add approvals wherever money is spent", "Handle the 'no' and 'rejected' cases", "Add a check before anything goes to a client", "Split big steps into smaller ones", "Make it shorter"];

export function AiDialog({ graph, onClose, onResult }: { graph: Graph | null; onClose: () => void; onResult: (g: Graph) => void }) {
  const improving = !!graph?.nodes.length;
  const [text, setText] = useState("");
  const go = useMutation({
    mutationFn: () => api<{ graph: Graph }>("/api/workflows/draft", "POST", improving ? { description: text, graph } : { description: text }),
    onSuccess: (r) => { onResult(r.graph); toast.success(improving ? "Improved. Undo (Ctrl+Z) brings the old one back." : "Drafted. Change anything on the board."); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={improving ? "Improve with AI" : "Draft with AI"} className="w-[min(96vw,36rem)]"
      description={improving ? "Say what to change. The analyst agent rewrites the workflow; agents and reviews you set on steps are kept." : "Describe the job in plain words: who does what, where it branches, who approves. The analyst agent draws it."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={go.isPending} disabled={!improving && text.trim().length < 10} onClick={() => go.mutate()}><SparkleIcon size={15} /> {improving ? "Improve it" : "Draft it"}</Button></>}>
      <div className="grid gap-3">
        <TextareaField label={improving ? "What to change (optional)" : "The job"} rows={improving ? 3 : 6} value={text} onChange={(e) => setText(e.target.value)} autoFocus
          placeholder={improving ? "e.g. After the quote, wait 3 days and follow up if the client hasn't replied." : "e.g. When a supplier invoice arrives: read it, ask finance for the PO number, check it matches, the manager approves, record it in the payables sheet and email the supplier."} />
        {improving ? (
          <div className="flex flex-wrap gap-1.5">
            {IMPROVE_IDEAS.map((i) => <button key={i} type="button" onClick={() => setText(i)} className="min-h-8 rounded-full border border-border px-3 text-[12px] hover:border-accent hover:text-accent">{i}</button>)}
          </div>
        ) : null}
        <FormError message={go.error ? errorMessage(go.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- the editor

export function WorkflowEditor({ existing, initial, onClose, onSaved, onOpenRun }: {
  existing: Workflow | null;
  initial?: Draft | null;
  onClose: () => void;
  onSaved: (wf: Workflow) => void;
  onOpenRun: (id: string) => void;
}) {
  const qc = useQueryClient();
  const wide = useMedia("(min-width: 1024px)");
  const { data: agents = [] } = useQuery(agentsQuery);
  const agentNames = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const start = existing ? { name: existing.name, description: existing.description, graph: existing.graph } : initial ?? { name: "", description: "", graph: { nodes: [], edges: [] } };
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [graph, setGraph] = useState<Graph>(start.graph);
  const [active, setActive] = useState((existing?.status ?? "draft") === "active");
  const [agentIds, setAgentIds] = useState<string[]>(existing?.agent_ids ?? []);
  const [baseline, setBaseline] = useState(() => JSON.stringify({ ...(existing ? start : { name: "", description: "", graph: { nodes: [], edges: [] } }), active: (existing?.status ?? "draft") === "active", agentIds: existing?.agent_ids ?? [] }));
  const [sel, setSel] = useState<Sel>(null);
  const [hist, setHist] = useState<Hist>({ past: [], future: [] });
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [sheet, setSheet] = useState<"palette" | "inspect" | null>(null);
  const [quick, setQuick] = useState<{ from?: string; edge?: WEdge; at: Pt; screen: Pt } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [ai, setAi] = useState(false);
  const [running, setRunning] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const lastEdit = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const board = useRef<HTMLDivElement>(null);

  const snapshot = JSON.stringify({ name, description, graph, active, agentIds });
  const dirty = snapshot !== baseline;
  const issues = useMemo(() => findIssues(graph), [graph]);
  const issueIds = useMemo(() => new Set(issues.map((i) => i.id).filter(Boolean) as string[]), [issues]);

  const remember = useCallback(() => {
    setHist((h) => ({ past: [...h.past.slice(-99), graph], future: [] }));
  }, [graph]);
  /** Typing in a field: one undo step per field per burst, not per key. */
  const rememberBurst = (key: string) => {
    const now = Date.now();
    if (lastEdit.current.key !== key || now - lastEdit.current.t > 1500) remember();
    lastEdit.current = { key, t: now };
  };
  const change = (g: Graph) => { remember(); setGraph(g); };
  const undo = useCallback(() => {
    if (!hist.past.length) return;
    setHist({ past: hist.past.slice(0, -1), future: [graph, ...hist.future] });
    setGraph(hist.past[hist.past.length - 1]!);
  }, [hist, graph]);
  const redo = useCallback(() => {
    if (!hist.future.length) return;
    setHist({ past: [...hist.past, graph], future: hist.future.slice(1) });
    setGraph(hist.future[0]!);
  }, [hist, graph]);

  const nodeFrom = (key: string, at: Pt): WNode => {
    const it = libItem(key) ?? libItem("task")!;
    return { id: newNodeId(), type: it.type, action: it.action, title: it.type === "end" ? "Done" : it.label, body: "", role: "", x: at.x, y: at.y, ...it.init };
  };
  const center = (): Pt => {
    // Below the selected step, else below the last one added.
    const s = sel?.kind === "node" ? graph.nodes.find((n) => n.id === sel.id) : null;
    const last = s ?? graph.nodes[graph.nodes.length - 1];
    return last ? { x: last.x, y: last.y + NODE_H + 90 } : { x: 80, y: 80 };
  };
  /** Add a library item; when a step is selected, the new one follows it. */
  const add = (key: string, at?: Pt, from?: string) => {
    const n = nodeFrom(key, at ?? center());
    const src = from ?? (sel?.kind === "node" && !at ? sel.id : undefined);
    const srcNode = src ? graph.nodes.find((x) => x.id === src) : null;
    const connect = srcNode && srcNode.type !== "end" && srcNode.type !== "note" && n.type !== "start" && n.type !== "note";
    const outs = srcNode ? graph.edges.filter((e) => e.from === srcNode.id).length : 0;
    const label = srcNode?.type === "decision" ? (srcNode.action === "approval" ? (outs ? "rejected" : "approved") : outs === 0 ? "yes" : outs === 1 ? "no" : "") : "";
    change({
      nodes: [...graph.nodes, n],
      edges: connect ? [...graph.edges, { id: `e${Date.now().toString(36)}`, from: srcNode!.id, to: n.id, label }] : graph.edges,
    });
    setSel({ kind: "node", id: n.id });
    setSheet(null);
  };
  const insertOnEdge = (edge: WEdge, key: string) => {
    const a = graph.nodes.find((n) => n.id === edge.from);
    const b = graph.nodes.find((n) => n.id === edge.to);
    if (!a || !b) return;
    const n = nodeFrom(key, { x: Math.round((a.x + b.x) / 2 / 20) * 20, y: Math.round((a.y + b.y) / 2 / 20) * 20 });
    const shift = b.y - a.y < NODE_H * 2 + 60 ? NODE_H + 90 : 0; // make room below if they were close
    change({
      nodes: [...graph.nodes.map((x) => (shift && x.y >= b.y ? { ...x, y: x.y + shift } : x)), n],
      edges: [...graph.edges.filter((e) => e.id !== edge.id), { ...edge, to: n.id }, { id: `e${Date.now().toString(36)}`, from: n.id, to: edge.to, label: "" }],
    });
    setSel({ kind: "node", id: n.id });
  };
  const patchNode = (id: string, p: Partial<WNode>, field: string) => {
    rememberBurst(`${id}:${field}`);
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }));
  };
  const setKind = (id: string, key: string) => {
    const it = libItem(key)!;
    change({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, type: it.type, action: it.action, ...it.init } : n)) });
  };
  const removeSelected = useCallback(() => {
    if (!sel) return;
    remember();
    if (sel.kind === "node") setGraph((g) => ({ nodes: g.nodes.filter((n) => n.id !== sel.id), edges: g.edges.filter((e) => e.from !== sel.id && e.to !== sel.id) }));
    else setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== sel.id) }));
    setSel(null);
  }, [sel, remember]);
  const duplicate = useCallback(() => {
    if (sel?.kind !== "node") return;
    const n = graph.nodes.find((x) => x.id === sel.id);
    if (!n) return;
    const copy = { ...n, id: newNodeId(), x: n.x + 40, y: n.y + 40, title: n.title ? `${n.title} (copy)` : n.title };
    remember();
    setGraph((g) => ({ ...g, nodes: [...g.nodes, copy] }));
    setSel({ kind: "node", id: copy.id });
  }, [sel, graph.nodes, remember]);
  const setEdgeLabel = (id: string, label: string) => {
    rememberBurst(`edge:${id}`);
    setGraph((g) => ({ ...g, edges: g.edges.map((e) => (e.id === id ? { ...e, label } : e)) }));
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description, graph, status: active ? "active" : "draft", agent_ids: agentIds };
      return existing ? api<Workflow>(`/api/workflows/${existing.id}`, "PATCH", payload) : api<Workflow>("/api/workflows", "POST", payload);
    },
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: workflowKeys.all });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      setBaseline(snapshot);
      toast.success(existing ? "Saved." : `"${wf.name}" created.`);
      onSaved(wf);
    },
    onError: (e) => toast.error(e instanceof ApiError && e.fields.name ? e.fields.name : errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/workflows/${existing!.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: workflowKeys.all }); toast.success("Workflow deleted."); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const trySave = useCallback(() => {
    if (!name.trim()) { toast.error("Give the workflow a name first."); document.getElementById("wf-name")?.focus(); return; }
    if (!save.isPending) save.mutate();
  }, [name, save]);

  // Keyboard: delete, undo/redo, duplicate, save, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable=true]");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); trySave(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeSelected(); }
      else if (e.key === "Escape") { setSel(null); setQuick(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, duplicate, removeSelected, sel, trySave]);

  /** Keep the quick-add menu inside the board (it is 16rem wide, ~22rem tall). */
  const fitPopover = (p: Pt): Pt => {
    const r = board.current?.getBoundingClientRect();
    if (!r) return p;
    const x = Math.min(Math.max(136, p.x), r.width - 136);
    const y = p.y + 360 > r.height ? Math.max(8, p.y - 370) : p.y;
    return { x, y };
  };
  const selectedNode = sel?.kind === "node" ? graph.nodes.find((n) => n.id === sel.id) ?? null : null;
  const selectedEdge = sel?.kind === "edge" ? graph.edges.find((e) => e.id === sel.id) ?? null : null;
  const onSelect = (s: Sel) => { setSel(s); setQuick(null); if (s && !wide) setSheet("inspect"); };

  const inspector = selectedNode ? (
    <NodeInspector key={selectedNode.id} node={selectedNode} graph={graph}
      onPatch={(p, f) => patchNode(selectedNode.id, p, f)} onKind={(k) => setKind(selectedNode.id, k)}
      onDelete={removeSelected} onDuplicate={duplicate} onEdgeLabel={setEdgeLabel}
      onRemoveEdge={(id) => change({ ...graph, edges: graph.edges.filter((e) => e.id !== id) })} onSelect={onSelect} />
  ) : selectedEdge ? (
    <EdgeInspector edge={selectedEdge} graph={graph} onLabel={(l) => setEdgeLabel(selectedEdge.id, l)} onRemove={removeSelected}
      onInsert={() => {
        const a = graph.nodes.find((n) => n.id === selectedEdge.from);
        const r = board.current?.getBoundingClientRect();
        setSheet(null);
        setQuick({ edge: selectedEdge, at: { x: a?.x ?? 0, y: a?.y ?? 0 }, screen: { x: (r?.width ?? 400) / 2, y: 80 } });
      }} />
  ) : (
    <WorkflowSettings description={description} setDescription={setDescription} active={active} setActive={setActive}
      agentIds={agentIds} setAgentIds={setAgentIds} graph={graph} procedure={existing?.procedure} />
  );

  const empty = (
    <div className="pointer-events-auto grid max-w-sm justify-items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface/95 p-6 text-center shadow-[var(--shadow-soft)] backdrop-blur">
      <IconTile icon={TreeStructureIcon} size="lg" />
      <div>
        <p className="text-[15px] font-semibold">Start the workflow</p>
        <p className="mt-1 text-[13px] text-muted">Drag steps from the library, or add the basics and build from there.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => { const s = nodeFrom("start", { x: 80, y: 60 }); const e = nodeFrom("end", { x: 80, y: 480 }); change({ nodes: [s, e], edges: [] }); setSel({ kind: "node", id: s.id }); }}>
          <PlusIcon size={14} /> Start and End
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAi(true)}><SparkleIcon size={14} /> Draft with AI</Button>
      </div>
    </div>
  );

  return (
    // Full screen: the editor covers the app's own navigation, like a design tool.
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon-sm" aria-label="All workflows" onClick={() => (dirty ? setLeaving(true) : onClose())}><ArrowLeftIcon size={17} /></Button>
        <IconTile icon={FlowArrowIcon} size="sm" className="hidden sm:grid" />
        <div className="min-w-0 flex-1 basis-40">
          <input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this workflow" aria-label="Workflow name"
            className="w-full min-w-0 truncate rounded-sm bg-transparent px-1 text-[16px] font-semibold outline-none hover:bg-surface-2/60 focus:bg-surface-2/60" />
          <div className="flex items-center gap-2 px-1 text-[11.5px] text-muted">
            <span className={cn("inline-flex items-center gap-1", active ? "text-ok" : "")}><span className={cn("size-1.5 rounded-full", active ? "bg-ok" : "bg-border")} />{active ? "Active" : "Draft"}</span>
            <span>·</span>
            <span className={dirty ? "text-warn" : ""}>{dirty ? "Unsaved changes" : existing ? "All saved" : "Not saved yet"}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="hidden items-center gap-0.5 sm:flex">
            <Button variant="ghost" size="icon-sm" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={undo}><ArrowCounterClockwiseIcon size={16} /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={redo}><ArrowClockwiseIcon size={16} /></Button>
            <Button variant="ghost" size="sm" title="Lay the steps out neatly" disabled={!graph.nodes.length} onClick={() => { change(tidy(graph)); setFitSignal((n) => n + 1); }}>
              <TreeStructureIcon size={15} /> <span className="hidden xl:inline">Tidy up</span>
            </Button>
          </div>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn(issues.length ? "text-warn hover:text-warn" : "text-ok hover:text-ok")} disabled={!graph.nodes.length}>
                {issues.length ? <WarningCircleIcon size={15} weight="fill" /> : <CheckCircleIcon size={15} weight="fill" />}
                <span className="hidden md:inline">{issues.length ? `${issues.length} to fix` : "Looks good"}</span>
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-80">
              <MenuLabel>{issues.length ? "Before running it" : "No problems found"}</MenuLabel>
              {issues.length ? issues.map((i, k) => (
                <MenuItem key={k} icon={<WarningCircleIcon />} onSelect={() => i.id && onSelect({ kind: "node", id: i.id })}>
                  <span className="whitespace-normal">{i.text}</span>
                </MenuItem>
              )) : <p className="px-2.5 pb-2 text-[12.5px] text-muted">Every step is reachable, leads somewhere, and every decision has labelled branches.</p>}
            </MenuContent>
          </Menu>
          <Button variant="outline" size="sm" onClick={() => setAi(true)} className="max-sm:px-2.5"><SparkleIcon size={15} /> <span className="hidden sm:inline">{graph.nodes.length ? "Improve with AI" : "Draft with AI"}</span></Button>
          <Button size="sm" variant={existing ? "outline" : "primary"} loading={save.isPending} disabled={!dirty && !!existing} onClick={trySave}>Save</Button>
          {existing ? (
            <Button data-guide="workflows.run" size="sm" disabled={dirty || !graph.nodes.length} title={dirty ? "Save your changes first" : undefined} onClick={() => setRunning(true)}>
              <PlayIcon size={14} weight="fill" /> <span className="hidden sm:inline">Run</span>
            </Button>
          ) : null}
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><DotsThreeIcon size={18} weight="bold" /></Button></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<ArrowCounterClockwiseIcon />} onSelect={undo}>Undo</MenuItem>
              <MenuItem icon={<ArrowClockwiseIcon />} onSelect={redo}>Redo</MenuItem>
              <MenuItem icon={<TreeStructureIcon />} onSelect={() => { change(tidy(graph)); setFitSignal((n) => n + 1); }}>Tidy up</MenuItem>
              <MenuItem icon={<KeyboardIcon />} onSelect={() => setKeysOpen(true)}>Keyboard shortcuts</MenuItem>
              {existing ? <><MenuSeparator /><MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete workflow</MenuItem></> : null}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {wide && paletteOpen ? (
          <aside className="flex w-[17rem] shrink-0 flex-col border-r border-border bg-surface/60" aria-label="Step library">
            <div className="flex items-center justify-between px-3 pt-3">
              <span className="text-[13px] font-semibold">Steps</span>
              <Button variant="ghost" size="icon-sm" aria-label="Hide the step library" onClick={() => setPaletteOpen(false)}><SidebarSimpleIcon size={16} /></Button>
            </div>
            <Palette onAdd={(k) => add(k)} />
            <p className="border-t border-border px-3 py-2 text-[11.5px] text-muted">Drag onto the board, or click to add {sel?.kind === "node" ? "after the selected step" : "it"}.</p>
          </aside>
        ) : null}

        <div ref={board} className="relative min-w-0 flex-1 p-2 sm:p-3">
          <Canvas graph={graph} onChange={setGraph} selected={sel} onSelect={onSelect} fill className="rounded-[var(--radius-lg)]"
            onBeginChange={remember} issues={issueIds} agentNames={agentNames} fitSignal={fitSignal} empty={empty}
            onDropItem={(key, at) => add(key, at)}
            onQuickAdd={(from, at, screen) => setQuick({ from, at, screen: fitPopover(screen) })}
            onInsertOnEdge={(edge) => {
              const a = graph.nodes.find((n) => n.id === edge.from);
              const r = board.current?.getBoundingClientRect();
              setQuick({ edge, at: { x: a?.x ?? 0, y: a?.y ?? 0 }, screen: fitPopover({ x: (r?.width ?? 400) / 2, y: 80 }) });
            }} />
          {quick ? (
            <QuickAdd at={quick.screen} onClose={() => setQuick(null)}
              onPick={(key) => {
                if (quick.edge) insertOnEdge(quick.edge, key);
                else add(key, { x: Math.round((quick.at.x - NODE_W / 2) / 20) * 20, y: Math.round(quick.at.y / 20) * 20 }, quick.from);
                setQuick(null);
              }} />
          ) : null}
          {wide && !paletteOpen ? (
            <Button size="sm" variant="outline" className="absolute top-5 left-5 shadow-[var(--shadow-soft)]" onClick={() => setPaletteOpen(true)}><ListBulletsIcon size={15} /> Steps</Button>
          ) : null}
          {!wide ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center gap-2 px-4">
              <Button className="pointer-events-auto shadow-[var(--shadow-pop)]" onClick={() => setSheet("palette")}><PlusIcon size={16} weight="bold" /> Add step</Button>
              <Button variant="outline" className="pointer-events-auto bg-surface shadow-[var(--shadow-pop)]" onClick={() => setSheet("inspect")}>
                <SlidersHorizontalIcon size={16} /> {sel ? "Edit" : "Settings"}
              </Button>
            </div>
          ) : null}
        </div>

        {wide ? (
          <aside className="w-[21rem] shrink-0 overflow-y-auto border-l border-border bg-surface p-4 xl:w-[23rem]" aria-label="Details">
            {inspector}
          </aside>
        ) : null}
      </div>

      {!wide ? (
        <SideSheet open={sheet === "palette"} onOpenChange={(o) => !o && setSheet(null)} title="Add a step"
          description={sel?.kind === "node" ? "It goes after the selected step, connected." : "Tap a step to add it to the board."}>
          <Palette onAdd={(k) => add(k)} compact />
        </SideSheet>
      ) : null}
      {!wide ? (
        <SideSheet open={sheet === "inspect"} onOpenChange={(o) => !o && setSheet(null)} title={selectedNode ? "Edit step" : selectedEdge ? "Connection" : "Workflow settings"}>
          {inspector}
        </SideSheet>
      ) : null}

      {existing ? (
        <details className="shrink-0 border-t border-border bg-surface px-4 py-2 text-[13px] max-md:hidden">
          <summary className="cursor-pointer font-medium text-muted hover:text-fg">Runs of this workflow</summary>
          <div className="max-h-72 overflow-y-auto pt-2"><RecentRuns workflowId={existing.id} onOpen={onOpenRun} /></div>
        </details>
      ) : null}

      {ai ? <AiDialog graph={graph.nodes.length ? graph : null} onClose={() => setAi(false)} onResult={(g) => { change(g); setSel(null); setFitSignal((n) => n + 1); }} /> : null}
      {running && existing ? <StartRunDialog wf={existing} onClose={() => setRunning(false)} /> : null}
      <ResponsiveDialog open={keysOpen} onOpenChange={setKeysOpen} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          {[["Ctrl + S", "Save"], ["Ctrl + Z", "Undo"], ["Ctrl + Shift + Z", "Redo"], ["Ctrl + D", "Duplicate the selected step"], ["Delete", "Delete the selection"], ["Esc", "Clear the selection"],
            ["Scroll", "Move around the board"], ["Ctrl + scroll", "Zoom"], ["Drag the board", "Pan"], ["Drag the + dot", "Connect to a step, or drop on empty space to add one"]].map(([k, v]) => (
            <div key={k} className="contents"><dt><kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px]">{k}</kbd></dt><dd className="text-muted">{v}</dd></div>
          ))}
        </dl>
      </ResponsiveDialog>
      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title="Leave without saving?" danger confirmLabel="Discard changes"
        body="Your changes to this workflow will be lost." onConfirm={async () => onClose()} />
      {existing ? <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${existing.name}?`} danger confirmLabel="Delete"
        body="Agents following it stop following it. Its finished runs are deleted; tasks they created stay on the board." onConfirm={async () => { await del.mutateAsync(); }} /> : null}
    </div>
  );
}
