import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CrownSimpleIcon, DotsSixVerticalIcon, HeartbeatIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Pill } from "@/components/ui/pill";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

const TOP = "__top__";

interface Node {
  agent: Agent;
  kids: Node[];
}

/** Agents nested under whoever they report to. A manager outside this company counts as top. */
export function buildTree(agents: Agent[]): Node[] {
  const here = new Set(agents.map((a) => a.id));
  const byBoss = new Map<string, Agent[]>();
  for (const a of agents) {
    const boss = a.reports_to && here.has(a.reports_to) ? a.reports_to : TOP;
    byBoss.set(boss, [...(byBoss.get(boss) ?? []), a]);
  }
  const seen = new Set<string>();
  const grow = (boss: string): Node[] =>
    (byBoss.get(boss) ?? [])
      .filter((a) => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      })
      .sort((x, y) => Number(y.role_kind === "orchestrator") - Number(x.role_kind === "orchestrator") || x.name.localeCompare(y.name))
      .map((a) => ({ agent: a, kids: grow(a.id) }));
  const roots = grow(TOP);
  // Anything unreachable (an old loop) still shows, at the top.
  return [...roots, ...agents.filter((a) => !seen.has(a.id)).map((a) => ({ agent: a, kids: [] }))];
}

function below(tree: Node[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (ns: Node[], inside: boolean) => {
    for (const n of ns) {
      const now = inside || n.agent.id === id;
      if (now) out.add(n.agent.id);
      walk(n.kids, now);
    }
  };
  walk(tree, false);
  return out;
}

function Card({ a, manage, managers, onMove, dragging }: { a: Agent; manage: boolean; managers: Agent[]; onMove: (to: string | null) => void; dragging?: boolean }) {
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({ id: a.id, disabled: !manage });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: a.id });
  return (
    <div ref={dropRef}
      className={cn("flex items-center gap-2.5 rounded-[var(--radius-md)] border bg-surface px-2.5 py-2 transition-colors",
        isOver && !isDragging ? "border-accent ring-3 ring-accent/20" : "border-border",
        (isDragging || dragging) && "opacity-40")}>
      {manage ? (
        <button ref={dragRef} {...listeners} {...attributes} aria-label={`Drag ${a.name} to a new manager`}
          className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-muted hover:bg-surface-2 active:cursor-grabbing">
          <DotsSixVerticalIcon size={16} weight="bold" />
        </button>
      ) : null}
      <AgentAvatar name={a.name} color={a.color} size="sm" />
      <Link to="/agents/$agentId" params={{ agentId: a.id }} className="min-w-0 flex-1 hover:text-accent">
        <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
        <span className="block truncate text-[12px] text-muted">{a.role}</span>
      </Link>
      {a.role_kind === "orchestrator" ? <Pill tone="accent" title="Can hand out work to others"><CrownSimpleIcon size={12} weight="fill" /> Leads</Pill> : null}
      {a.heartbeat ? <HeartbeatIcon size={15} className="shrink-0 text-ok" aria-label="Heartbeat on" /> : null}
      {manage ? (
        <Menu>
          <MenuTrigger className="shrink-0 rounded-sm px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-fg">Reports to</MenuTrigger>
          <MenuContent className="max-h-80 overflow-y-auto">
            <MenuLabel>{a.name} reports to</MenuLabel>
            <MenuRadioGroup value={a.reports_to ?? TOP} onValueChange={(v) => onMove(v === TOP ? null : v)}>
              <MenuRadioItem value={TOP}>No one (top level)</MenuRadioItem>
              {managers.map((m) => <MenuRadioItem key={m.id} value={m.id}>{m.name}</MenuRadioItem>)}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}

function Branch({ nodes, depth, ...rest }: { nodes: Node[]; depth: number; manage: boolean; tree: Node[]; all: Agent[]; move: (a: Agent, to: string | null) => void; active: string | null }) {
  return (
    <ul className={cn("grid gap-2", depth > 0 && "ml-4 border-l border-border pl-4 sm:ml-6 sm:pl-5")}>
      {nodes.map((n) => {
        const blocked = below(rest.tree, n.agent.id);
        return (
          <li key={n.agent.id} className="grid gap-2">
            <Card a={n.agent} manage={rest.manage} dragging={rest.active === n.agent.id}
              managers={rest.all.filter((m) => !blocked.has(m.id))} onMove={(to) => rest.move(n.agent, to)} />
            {n.kids.length ? <Branch nodes={n.kids} depth={depth + 1} {...rest} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function TopZone() {
  const { setNodeRef, isOver } = useDroppable({ id: TOP });
  return (
    <div ref={setNodeRef} className={cn("rounded-[var(--radius-md)] border border-dashed px-3 py-2 text-[12.5px] text-muted", isOver ? "border-accent bg-accent-soft text-fg" : "border-border")}>
      Drop here to report to no one
    </div>
  );
}

/** Drag a card onto another agent to change who it reports to, or use "Reports to". */
export function OrgChart({ agents, manage }: { agents: Agent[]; manage: boolean }) {
  const qc = useQueryClient();
  const tree = useMemo(() => buildTree(agents), [agents]);
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const save = useMutation({
    mutationFn: ({ a, to }: { a: Agent; to: string | null }) => api<Agent>(`/api/agents/${a.id}`, "PATCH", { reports_to: to }),
    onMutate: async ({ a, to }) => {
      await qc.cancelQueries({ queryKey: workKeys.agents });
      const before = qc.getQueryData<Agent[]>(workKeys.agents);
      qc.setQueryData<Agent[]>(workKeys.agents, (old) => old?.map((x) => (x.id === a.id ? { ...x, reports_to: to } : x)));
      return { before };
    },
    onError: (e, _, ctx) => {
      if (ctx?.before) qc.setQueryData(workKeys.agents, ctx.before);
      toast.error(errorMessage(e));
    },
    onSuccess: (r, { to }) => toast.success(to ? `${r.name} now reports to ${agents.find((x) => x.id === to)?.name}.` : `${r.name} is now top level.`),
    onSettled: () => qc.invalidateQueries({ queryKey: workKeys.agents }),
  });
  const move = (a: Agent, to: string | null) => {
    if ((a.reports_to ?? null) === to) return;
    save.mutate({ a, to });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const a = agents.find((x) => x.id === e.active.id);
    if (!a || !e.over) return;
    const to = e.over.id === TOP ? null : String(e.over.id);
    if (to && below(tree, a.id).has(to)) {
      toast.error(`${a.name} cannot report to someone who reports to them.`);
      return;
    }
    move(a, to);
  };
  const dragged = agents.find((x) => x.id === active);

  if (!agents.length) return null;
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(String(e.active.id))} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div className="grid max-w-3xl gap-3">
        <p className="flex items-center gap-2 text-[12.5px] text-muted">
          <TreeStructureIcon size={15} />
          {manage ? "Drag an agent onto its new manager. Agents marked Leads can hand work to the people below them." : "Who reports to whom. Agents marked Leads can hand work to others."}
        </p>
        {manage && active ? <TopZone /> : null}
        <Branch nodes={tree} depth={0} manage={manage} tree={tree} all={agents} move={move} active={active} />
      </div>
      <DragOverlay>
        {dragged ? (
          <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-accent bg-surface px-3 py-2 shadow-[var(--shadow-pop)]">
            <AgentAvatar name={dragged.name} color={dragged.color} size="sm" />
            <span className="text-[13.5px] font-medium">{dragged.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
