import {
  ArrowsInIcon,
  BroadcastIcon,
  BuildingsIcon,
  KanbanIcon,
  ListIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MapTrifoldIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { onLiveEvent } from "@/lib/live";
import { branchesQuery, meQuery } from "@/lib/queries";
import { useBranch } from "@/lib/stores";
import { cn, timeAgo } from "@/lib/utils";
import { tasksQuery, workKeys, type Task } from "@/lib/work";
import { createOffice, type Office } from "@/office/engine";
import type { OfficeEvent, OfficeSnapshot } from "@/office/types";

import { AgentSheet, STATE_INFO } from "./agent-sheet";

export interface OfficeSearch {
  agent?: string;
  view?: "map" | "list";
}

const STATE_ORDER = { waiting_approval: 0, error: 1, working: 2, idle: 3, paused: 4 } as const;
const LIVE_TYPES = new Set(["agent.status", "agent.thinking", "task.event", "broadcast.ack"]);

const officeQuery = (branchId: string) => ({
  queryKey: ["office", branchId],
  queryFn: () => api<OfficeSnapshot>(`/api/office/${branchId}`),
  refetchInterval: 60_000, // the snapshot is the truth; events only make it immediate
});

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(document.documentElement.dataset.theme === "dark"));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function TaskTray({ snap, canWrite, onAssign }: { snap: OfficeSnapshot; canWrite: boolean; onAssign: (taskId: string, agentId: string) => void }) {
  const { data: tasks = [] } = useQuery(tasksQuery);
  const open = tasks.filter((t) => (t.status === "triage" || t.status === "ready") && (!t.assignee_agent_id || t.status === "triage")).slice(0, 12);
  const [picking, setPicking] = useState<string | null>(null);
  if (!canWrite) return null;
  return (
    <section aria-label="Tasks to hand out" className="grid content-start gap-2">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><KanbanIcon size={15} /> To hand out <span className="font-normal text-muted">{open.length}</span></h2>
      {open.length ? (
        <>
          <p className="text-[12px] text-muted max-md:hidden">Drag a card onto someone in the office.</p>
          <ul className="grid gap-1.5">
            {open.map((t: Task) => (
              <li key={t.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-agentic-task", t.id); e.dataTransfer.effectAllowed = "move"; }}
                className="grid cursor-grab gap-1 rounded-sm border border-border bg-surface px-3 py-2 active:cursor-grabbing">
                <span className="line-clamp-2 text-[13px] font-medium">{t.title}</span>
                {picking === t.id ? (
                  <Select value="" onValueChange={(v) => { setPicking(null); onAssign(t.id, v); }} label="Assign to" size="sm"
                    options={snap.agents.filter((a) => a.status !== "paused").map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))} />
                ) : (
                  <button onClick={() => setPicking(t.id)} className="w-fit text-[12px] text-accent hover:underline">Assign to…</button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="text-[12.5px] text-muted">Nothing waiting. New tasks without an agent show up here.</p>}
    </section>
  );
}

function ListView({ snap, onOpen }: { snap: OfficeSnapshot; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<"state" | "name">("state");
  const dept = new Map(snap.departments.map((d) => [d.id, d.name]));
  const rows = [...snap.agents].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border text-[12px] text-muted">
          <tr>
            <th className="px-4 py-2 font-medium"><button onClick={() => setSort("name")} className={cn(sort === "name" && "text-fg")}>Agent</button></th>
            <th className="px-4 py-2 font-medium">Department</th>
            <th className="px-4 py-2 font-medium"><button onClick={() => setSort("state")} className={cn(sort === "state" && "text-fg")}>Doing</button></th>
            <th className="px-4 py-2 font-medium">Task</th>
            <th className="px-4 py-2 font-medium max-md:hidden">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-2.5">
                <button onClick={() => onOpen(a.id)} className="flex items-center gap-2 font-medium hover:text-accent">
                  <AgentAvatar name={a.name} color={a.color} size="xs" working={a.state === "working"} /> {a.name}
                </button>
              </td>
              <td className="px-4 py-2.5 text-muted">{a.department_id ? dept.get(a.department_id) ?? "—" : "Hot desks"}</td>
              <td className="px-4 py-2.5"><Pill tone={STATE_INFO[a.state].tone}>{STATE_INFO[a.state].label}</Pill></td>
              <td className="max-w-64 truncate px-4 py-2.5">{a.task ? <Link to="/tasks" search={{ task: a.task.id }} className="text-accent hover:underline">{a.task.title}</Link> : <span className="text-muted">—</span>}</td>
              <td className="max-w-72 truncate px-4 py-2.5 text-muted max-md:hidden">{a.last ? `${a.last.text} · ${timeAgo(a.last.ts).toLowerCase()}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OfficePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canDecide = me.permissions.includes("approvals.decide");
  const { data: branches = [], isLoading: loadingBranches } = useQuery(branchesQuery);
  const { branchId, setBranchId } = useBranch();
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const search = useSearch({ strict: false }) as OfficeSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const view = search.view ?? "map";
  const { data: snap, error } = useQuery({ ...officeQuery(branch?.id ?? ""), enabled: !!branch });
  const canvas = useRef<HTMLCanvasElement>(null);
  const office = useRef<Office | null>(null);
  const dark = useDarkTheme();
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const openAgent = (id: string | undefined) => navigate({ to: "/office", search: { ...search, agent: id }, replace: true });

  const assign = useMutation({
    mutationFn: async ({ taskId, agentId }: { taskId: string; agentId: string }) => {
      await api(`/api/tasks/${taskId}`, "PATCH", { assignee_agent_id: agentId });
      return api(`/api/tasks/${taskId}/start`, "POST");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: ["office"] });
      const who = snap?.agents.find((a) => a.id === v.agentId)?.name ?? "The agent";
      toast.success(`${who} is on it.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const hasSnap = !!snap;
  // Mount the engine once the canvas exists (map view, after the first snapshot renders it).
  useEffect(() => {
    if (view !== "map" || !canvas.current) return;
    const o = createOffice(canvas.current, {
      onAgentTap: (id) => openAgent(id),
      onTaskDrop: (taskId, agentId) => assign.mutate({ taskId, agentId }),
    });
    o.setTheme(document.documentElement.dataset.theme === "dark");
    o.select(search.agent ?? null);
    office.current = o;
    try {
      // Opt-in test hook: localStorage["agentic.debug"] = "1".
      if (localStorage.getItem("agentic.debug") === "1") (window as unknown as { __office?: Office }).__office = o;
    } catch {
      /* storage blocked */
    }
    return () => {
      o.destroy();
      office.current = null;
    };
    // openAgent/assign are stable enough for the engine's lifetime; remounting would reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, branch?.id, hasSnap]);

  useEffect(() => {
    if (snap) office.current?.setData(snap);
  }, [snap, view]);
  useEffect(() => office.current?.setTheme(dark), [dark, view]);
  useEffect(() => office.current?.select(search.agent ?? null), [search.agent]);

  useEffect(
    () =>
      onLiveEvent((ev) => {
        if (LIVE_TYPES.has(ev.type)) office.current?.apply({ type: ev.type, data: ev.data } as OfficeEvent);
        if (ev.type === "broadcast.sent") {
          const label = typeof ev.data.label === "string" ? ev.data.label : "everyone";
          setBanner({ id: ev.seq, text: `Announcement to ${label}` });
        }
      }),
    [],
  );
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(t);
  }, [banner]);

  const selected = snap?.agents.find((a) => a.id === search.agent) ?? null;
  const waiting = snap?.agents.reduce((n, a) => n + a.pending_approvals, 0) ?? 0;
  const deptName = useMemo(() => new Map(snap?.departments.map((d) => [d.id, d.name]) ?? []), [snap]);

  if (loadingBranches) return <div className="p-6"><Skeleton className="h-[70dvh] rounded-[var(--radius-md)]" /></div>;
  if (!branch) {
    return (
      <div className="p-6">
        <EmptyState icon={BuildingsIcon} title="No company yet" body="Each company gets its own office. Add one under Organization, then add agents to its departments."
          action={<Button asChild><Link to="/organization">Add a company</Link></Button>} />
      </div>
    );
  }

  return (
    // Fills the screen below the header (and above the phone tab bar).
    <div className="flex h-[calc(100dvh-3.5rem-4.5rem-env(safe-area-inset-bottom))] min-h-80 flex-col md:h-[calc(100dvh-3.5rem)]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-6 sm:py-2.5">
        <h1 className="mr-2 text-[17px] font-semibold max-sm:sr-only">Office</h1>
        <nav aria-label="Companies" className="flex min-w-0 gap-1 overflow-x-auto">
          {branches.map((b) => (
            <button key={b.id} onClick={() => setBranchId(b.id)} aria-current={b.id === branch.id ? "page" : undefined}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-[13px]", b.id === branch.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <span aria-hidden className="size-2 rounded-full" style={{ background: b.color }} />{b.name}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {waiting ? (
            <Button size="sm" variant="outline" asChild><Link to="/approvals"><SealCheckIcon size={15} className="text-warn" /> {waiting}<span className="max-sm:sr-only"> waiting</span></Link></Button>
          ) : null}
          {canWrite ? <Button size="icon-sm" variant="ghost" aria-label="Send a broadcast" asChild><Link to="/broadcasts"><BroadcastIcon size={17} /></Link></Button> : null}
          <Button size="icon-sm" variant="ghost" aria-label={view === "map" ? "Show as a list" : "Show the office"}
            onClick={() => navigate({ to: "/office", search: { ...search, view: view === "map" ? "list" : undefined }, replace: true })}>
            {view === "map" ? <ListIcon size={17} /> : <MapTrifoldIcon size={17} />}
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="p-6 text-danger">{errorMessage(error)}</p> : !snap ? (
        <div className="p-6"><Skeleton className="h-[70dvh] rounded-[var(--radius-md)]" /></div>
      ) : view === "list" ? (
        <div className="grid gap-6 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          {snap.agents.length ? <ListView snap={snap} onOpen={(id) => openAgent(id)} /> : <p className="text-muted">No agents in {snap.branch.name} yet.</p>}
          <TaskTray snap={snap} canWrite={canWrite} onAssign={(taskId, agentId) => assign.mutate({ taskId, agentId })} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <canvas ref={canvas} className="absolute inset-0 size-full touch-none select-none" aria-label={`Pixel office of ${snap.branch.name}. ${snap.agents.length} agents. The list view shows the same information as a table.`} role="img" />
            {banner ? (
              <div role="status" key={banner.id} className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span className="flex items-center gap-2 rounded-full bg-info px-4 py-1.5 text-[13px] font-medium text-white shadow-[var(--shadow-pop)] motion-safe:animate-[sheet-in_300ms_ease-out]">
                  <BroadcastIcon size={15} weight="fill" /> {banner.text}
                </span>
              </div>
            ) : null}
            <div className="absolute top-3 right-3 flex flex-col gap-1 rounded-sm border border-border bg-surface/95 p-1 shadow-[var(--shadow-soft)]">
              <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => office.current?.zoom(1)}><MagnifyingGlassPlusIcon size={17} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => office.current?.zoom(-1)}><MagnifyingGlassMinusIcon size={17} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Fit the office" onClick={() => office.current?.fit()}><ArrowsInIcon size={17} /></Button>
            </div>
            {!snap.agents.length ? (
              <div className="absolute inset-x-4 bottom-20 mx-auto max-w-sm rounded-[var(--radius-md)] border border-border bg-surface/95 p-4 text-center shadow-[var(--shadow-soft)]">
                <p className="text-[13.5px] font-medium">The office is empty</p>
                <p className="mt-1 text-[12.5px] text-muted">Add agents to {snap.branch.name}'s departments and they take a desk here.</p>
                {canWrite ? <Button size="sm" className="mt-3" asChild><Link to="/agents/new">Add an agent</Link></Button> : null}
              </div>
            ) : null}
            {/* Roster: tap to fly the camera there. */}
            <nav aria-label="People in the office" className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto border-t border-border bg-surface/95 px-3 py-2">
              {snap.agents.map((a) => (
                <button key={a.id} onClick={() => { office.current?.focus(a.id); openAgent(a.id); }}
                  className={cn("flex shrink-0 items-center gap-2 rounded-full border px-1.5 py-1 pr-3 text-[12.5px]", a.id === search.agent ? "border-accent bg-accent-soft/60" : "border-border hover:bg-surface-2")}>
                  <AgentAvatar name={a.name} color={a.color} size="xs" working={a.state === "working"} />
                  <span className="font-medium">{a.name}</span>
                  <span aria-hidden className={cn("size-2 rounded-full", a.state === "working" ? "bg-accent" : a.state === "waiting_approval" ? "bg-warn" : a.state === "error" ? "bg-danger" : a.state === "paused" ? "bg-border" : "bg-info")} />
                  <span className="sr-only">{STATE_INFO[a.state].label}</span>
                </button>
              ))}
            </nav>
          </div>
          <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-border p-4 xl:block">
            <TaskTray snap={snap} canWrite={canWrite} onAssign={(taskId, agentId) => assign.mutate({ taskId, agentId })} />
          </aside>
        </div>
      )}

      {selected ? (
        <AgentSheet key={selected.id} agent={selected} departmentName={selected.department_id ? deptName.get(selected.department_id) ?? null : "Hot desks"}
          canWrite={canWrite} canDecide={canDecide} onClose={() => openAgent(undefined)} />
      ) : null}
    </div>
  );
}
