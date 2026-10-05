import {
  BroadcastIcon,
  BuildingsIcon,
  CornersOutIcon,
  CrosshairSimpleIcon,
  KanbanIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tNow, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { onLiveEvent } from "@/lib/live";
import { useCompanies } from "@/lib/company";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, tasksQuery, workKeys, type Task } from "@/lib/work";
import { createOffice, type Office } from "@/office/engine";
import type { OfficeEvent, OfficeSnapshot } from "@/office/types";

import { AgentSheet, STATE_INFO } from "./agent-sheet";

export interface OfficeSearch {
  agent?: string;
  view?: "map" | "list";
}

const STATE_ORDER = { waiting_approval: 0, error: 1, in_meeting: 2, working: 3, idle: 4, paused: 5 } as const;
const LIVE_TYPES = new Set(["agent.status", "agent.thinking", "task.event", "broadcast.ack", "meeting.turn"]);

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

function TaskTray({ snap, canWrite, watchOnly, onAssign }: { snap: OfficeSnapshot; canWrite: boolean; watchOnly: Set<string>; onAssign: (taskId: string, agentId: string) => void }) {
  const t = useT();
  const { data: tasks = [] } = useQuery(tasksQuery);
  const open = tasks.filter((x) => (x.status === "triage" || x.status === "ready") && (!x.assignee_agent_id || x.status === "triage")).slice(0, 12);
  const [picking, setPicking] = useState<string | null>(null);
  if (!canWrite) return null;
  return (
    <section aria-label={t("Tasks to hand out")} className="grid min-w-0 content-start gap-2.5">
      <h2 className="flex items-center gap-2 text-[13.5px] font-semibold">
        <IconTile icon={KanbanIcon} tone="info" size="sm" className="size-7" /> {t("To hand out")}
        <span className="ml-auto rounded-full bg-surface-2 px-2 text-[12px] font-medium text-muted tabular">{open.length}</span>
      </h2>
      {open.length ? (
        <>
          <p className="text-[12px] text-muted max-md:hidden">{t("Drag a card onto someone in the office.")}</p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {open.map((task: Task) => (
              <li key={task.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("application/x-agentic-task", task.id); e.dataTransfer.effectAllowed = "move"; }}
                className="grid cursor-grab gap-1.5 rounded-sm border border-border bg-surface px-3 py-2.5 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] active:cursor-grabbing">
                <span className="line-clamp-2 text-[13px] font-medium break-words">{task.title}</span>
                {picking === task.id ? (
                  <Select value="" onValueChange={(v) => { setPicking(null); onAssign(task.id, v); }} label={t("Assign to")} size="sm"
                    options={snap.agents.filter((a) => a.status !== "paused" && !watchOnly.has(a.id)).map((a) => ({ value: a.id, label: `${a.name} (${a.role})` }))} />
                ) : (
                  <button onClick={() => setPicking(task.id)} className="-mx-1 h-7 w-fit rounded-sm px-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft">{t("Assign to…")}</button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="rounded-sm border border-dashed border-border px-3 py-3 text-[12.5px] text-muted">{t("Nothing waiting. New tasks without an agent show up here.")}</p>}
    </section>
  );
}

function ListView({ snap, watchOnly, onOpen }: { snap: OfficeSnapshot; watchOnly: Set<string>; onOpen: (id: string) => void }) {
  const t = useT();
  const [sort, setSort] = useState<"state" | "name">("state");
  const dept = new Map(snap.departments.map((d) => [d.id, d.name]));
  const rows = [...snap.agents].sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
  const deptOf = (a: OfficeSnapshot["agents"][number]) => (a.department_id ? dept.get(a.department_id) ?? "—" : t("Hot desks"));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
      <Segmented label={t("Sort agents")} size="sm" value={sort} onChange={setSort} className="w-fit"
        options={[{ value: "state", label: t("By what they are doing") }, { value: "name", label: t("By name") }]} />
      {/* Phones: one card per agent. */}
      <ListCard className="md:hidden">
        {rows.map((a) => (
          <ListRow key={a.id} onClick={() => onOpen(a.id)}
            leading={<AgentAvatar name={a.name} color={a.color} size="sm" working={a.state === "working"} />}
            title={a.name}
            meta={<Meta items={[deptOf(a), a.last ? timeAgo(a.last.ts) : null]} />}
            trailing={<Pill tone={STATE_INFO[a.state].tone}>{t(STATE_INFO[a.state].label)}</Pill>}>
            {a.task ? <span className="line-clamp-2 text-[12.5px] break-words">{t("On: {title}", { title: a.task.title })}</span> : null}
          </ListRow>
        ))}
      </ListCard>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface max-md:hidden">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border bg-surface-2/50 text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">{t("Agent")}</th>
              <th className="px-4 py-2 font-medium">{t("Department")}</th>
              <th className="px-4 py-2 font-medium">{t("Doing")}</th>
              <th className="px-4 py-2 font-medium">{t("Task")}</th>
              <th className="px-4 py-2 font-medium">{t("Last activity")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2/40">
                <td className="px-4 py-2.5">
                  <button onClick={() => onOpen(a.id)} className="flex items-center gap-2 font-medium whitespace-nowrap hover:text-accent">
                    <AgentAvatar name={a.name} color={a.color} size="xs" working={a.state === "working"} /> {a.name}
                  </button>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">{deptOf(a)}</td>
                <td className="px-4 py-2.5"><Pill tone={STATE_INFO[a.state].tone}>{t(STATE_INFO[a.state].label)}</Pill></td>
                <td className="w-[30%] max-w-0 px-4 py-2.5">{a.task ? (watchOnly.has(a.id)
                  ? <span className="block truncate" title={a.task.title}>{a.task.title}</span>
                  : <Link to="/tasks" search={{ task: a.task.id }} className="block truncate text-accent hover:underline" title={a.task.title}>{a.task.title}</Link>) : <span className="text-muted">—</span>}</td>
                <td className="w-[30%] max-w-0 px-4 py-2.5 text-muted"><span className="block truncate" title={a.last?.text}>{a.last ? `${a.last.text} · ${timeAgo(a.last.ts).toLowerCase()}` : "—"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OfficePage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canDecide = me.permissions.includes("approvals.decide");
  // One office at a time: under "All companies" the floor opens the last company picked here
  // (or the first) and the tabs switch it without leaving "All" for the rest of the app.
  const { branches, isLoading: loadingBranches, isAll, one: branch, pickOne } = useCompanies();
  const search = useSearch({ strict: false }) as OfficeSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const view = search.view ?? "map";
  const { data: snap, error } = useQuery({ ...officeQuery(branch?.id ?? ""), enabled: !!branch });
  // Staff watch colleagues' agents here too (view_only): they can't be handed tasks.
  const { data: roster } = useQuery(agentsQuery);
  const watchOnly = useMemo(() => new Set((roster ?? []).filter((a) => a.view_only).map((a) => a.id)), [roster]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const office = useRef<Office | null>(null);
  const dark = useDarkTheme();
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  // The follow button keeps working after the agent's panel is closed: it follows the last one opened.
  const [lastAgent, setLastAgent] = useState<string | null>(search.agent ?? null);
  const openAgent = (id: string | undefined) => {
    if (id) setLastAgent(id);
    return navigate({ to: "/office", search: { ...search, agent: id }, replace: true });
  };

  const assign = useMutation({
    mutationFn: async ({ taskId, agentId }: { taskId: string; agentId: string }) => {
      if (watchOnly.has(agentId)) {
        const who = snap?.agents.find((a) => a.id === agentId)?.name ?? t("That agent");
        throw new Error(t("{name} isn't yours to instruct. You can only watch it.", { name: who }));
      }
      await api(`/api/tasks/${taskId}`, "PATCH", { assignee_agent_id: agentId });
      return api(`/api/tasks/${taskId}/start`, "POST");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: ["office"] });
      const who = snap?.agents.find((a) => a.id === v.agentId)?.name ?? t("The agent");
      toast.success(t("{name} is on it.", { name: who }));
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
      onFollowChange: setFollowing,
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
      setFollowing(null);
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
          // Read the language when the event arrives (this subscription is set up once).
          const label = typeof ev.data.label === "string" ? ev.data.label : tNow(msg("everyone"));
          setBanner({ id: ev.seq, text: tNow(msg("Announcement to {label}"), { label }) });
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
  const followTarget = search.agent ?? (lastAgent && snap?.agents.some((a) => a.id === lastAgent) ? lastAgent : null);
  const followName = snap?.agents.find((a) => a.id === followTarget)?.name ?? null;
  const waiting = snap?.agents.reduce((n, a) => n + a.pending_approvals, 0) ?? 0;
  const deptName = useMemo(() => new Map(snap?.departments.map((d) => [d.id, d.name]) ?? []), [snap]);

  if (loadingBranches) return <div className="p-6"><Skeleton className="h-[70dvh] rounded-[var(--radius-md)]" /></div>;
  if (!branch) {
    return (
      <div className="p-6">
        <EmptyState icon={BuildingsIcon} title={t("No company yet")} body={t("Each company gets its own office. Add one under Organization, then add agents to its departments.")}
          action={<Button asChild><Link to="/organization">{t("Add a company")}</Link></Button>} />
      </div>
    );
  }

  return (
    // Fills the screen below the header (and above the phone tab bar).
    <div className="flex h-[calc(100dvh-3.5rem-4.5rem-env(safe-area-inset-bottom))] min-h-80 flex-col md:h-[calc(100dvh-3.5rem)]">
      <div className="flex items-center gap-2 border-b border-border bg-surface/60 px-3 py-2 sm:px-6 sm:py-2.5">
        <h1 className="mr-2 text-[17px] font-semibold max-sm:sr-only">{t("Office")}</h1>
        <nav data-guide="office.branch" aria-label={t("Companies")} className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {branches.map((b) => (
            <button key={b.id} onClick={() => pickOne(b.id)} title={isAll ? t("Open {name}'s office (the rest of the app stays on All companies)", { name: b.name }) : undefined} aria-current={b.id === branch.id ? "page" : undefined}
              className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px] transition-colors", b.id === branch.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <span aria-hidden className="size-2 rounded-full" style={{ background: b.color }} />{b.name}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {waiting ? (
            <Button size="sm" variant="outline" asChild><Link to="/approvals"><SealCheckIcon size={15} className="text-warn" /> {waiting}<span className="max-sm:sr-only"> {t("waiting")}</span></Link></Button>
          ) : null}
          {canWrite ? <Button size="icon-sm" variant="ghost" aria-label={t("Send a broadcast")} title={t("Send a broadcast")} asChild><Link to="/broadcasts"><BroadcastIcon size={17} /></Link></Button> : null}
          <Segmented label={t("Office view")} size="sm" value={view}
            onChange={(v) => navigate({ to: "/office", search: { ...search, view: v === "list" ? "list" : undefined }, replace: true })}
            options={[{ value: "map", label: t("Map") }, { value: "list", label: t("List") }]} />
        </div>
      </div>

      {error ? <p role="alert" className="p-6 text-danger">{errorMessage(error)}</p> : !snap ? (
        <div className="p-6"><Skeleton className="h-[70dvh] rounded-[var(--radius-md)]" /></div>
      ) : view === "list" ? (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          {snap.agents.length ? <ListView snap={snap} watchOnly={watchOnly} onOpen={(id) => openAgent(id)} /> : (
            <EmptyState icon={BuildingsIcon} title={t("No agents in {name} yet", { name: snap.branch.name })} body={t("Add agents to its departments and they take a desk here.")}
              action={canWrite ? <Button size="sm" asChild>{staffOnly(me.permissions) ? <Link to="/twin">{t("Meet your AI twin")}</Link> : <Link to="/agents/new">{t("Add an agent")}</Link>}</Button> : undefined} />
          )}
          <TaskTray snap={snap} canWrite={canWrite} watchOnly={watchOnly} onAssign={(taskId, agentId) => assign.mutate({ taskId, agentId })} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div data-guide="office.floor" className="relative min-h-0 min-w-0 flex-1">
            {/* Pan: drag, one finger, middle mouse or Space + drag. Zoom: wheel, pinch, double tap, + / - / 0, Shift+1 fits. */}
            <canvas ref={canvas} tabIndex={0} role="application" aria-roledescription={t("pixel office")}
              className="absolute inset-0 block size-full cursor-grab touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset [-webkit-touch-callout:none]"
              aria-label={t("Pixel office of {name}. {n} agents. Drag to move around, scroll or pinch to zoom. The list view shows the same information as a table.", { name: snap.branch.name, n: snap.agents.length })} />
            {banner ? (
              <div role="status" key={banner.id} className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span className="flex items-center gap-2 rounded-full bg-info px-4 py-1.5 text-[13px] font-medium text-white shadow-[var(--shadow-pop)] motion-safe:animate-[sheet-in_300ms_ease-out]">
                  <BroadcastIcon size={15} weight="fill" /> {banner.text}
                </span>
              </div>
            ) : null}
            <div className="absolute top-3 right-3 flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface/95 p-1 shadow-[var(--shadow-soft)] backdrop-blur-sm">
              <Button size="icon-sm" variant="ghost" aria-label={t("Zoom in")} title={t("Zoom in (+)")} onClick={() => office.current?.zoom(1)}><MagnifyingGlassPlusIcon size={17} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("Zoom out")} title={t("Zoom out (-)")} onClick={() => office.current?.zoom(-1)}><MagnifyingGlassMinusIcon size={17} /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={t("Fit the office")} title={t("Fit the office (Shift+1)")} onClick={() => { office.current?.follow(null); setFollowing(null); office.current?.fit(); }}><CornersOutIcon size={17} /></Button>
              <Button size="icon-sm" variant="ghost" aria-pressed={!!following} disabled={!followTarget}
                aria-label={following ? t("Stop following") : t("Follow the selected agent")}
                title={following ? t("Stop following") : followName ? t("Follow {name}", { name: followName }) : t("Pick an agent to follow")}
                className={cn(following && "bg-accent-soft text-accent hover:text-accent")}
                onClick={() => {
                  const next = following ? null : followTarget;
                  office.current?.follow(next);
                  setFollowing(next);
                }}><CrosshairSimpleIcon size={17} weight={following ? "bold" : "regular"} /></Button>
            </div>
            {!snap.agents.length ? (
              <div className="absolute inset-x-4 bottom-20 mx-auto max-w-sm rounded-[var(--radius-md)] border border-border bg-surface/95 p-4 text-center shadow-[var(--shadow-soft)]">
                <p className="text-[13.5px] font-medium">{t("The office is empty")}</p>
                <p className="mt-1 text-[12.5px] text-muted">{t("Add agents to {name}'s departments and they take a desk here.", { name: snap.branch.name })}</p>
                {canWrite ? <Button size="sm" className="mt-3" asChild>{staffOnly(me.permissions) ? <Link to="/twin">{t("Meet your AI twin")}</Link> : <Link to="/agents/new">{t("Add an agent")}</Link>}</Button> : null}
              </div>
            ) : null}
            {/* Roster: tap to fly the camera there. */}
            <nav aria-label={t("People in the office")} className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto border-t border-border bg-surface/95 px-3 py-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {snap.agents.map((a) => (
                <button key={a.id} onClick={() => { if (following) { office.current?.follow(a.id); setFollowing(a.id); } else office.current?.focus(a.id); openAgent(a.id); }}
                  className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full border bg-surface pr-3 pl-1.5 text-[12.5px] transition-colors", a.id === search.agent ? "border-accent bg-accent-soft/60" : "border-border hover:bg-surface-2")}>
                  <AgentAvatar name={a.name} color={a.color} size="xs" working={a.state === "working"} />
                  <span className="font-medium">{a.name}</span>
                  <span aria-hidden className={cn("size-2 rounded-full", a.state === "working" || a.state === "in_meeting" ? "bg-accent" : a.state === "waiting_approval" ? "bg-warn" : a.state === "error" ? "bg-danger" : a.state === "paused" ? "bg-border" : "bg-info")} />
                  <span className="sr-only">{t(STATE_INFO[a.state].label)}</span>
                </button>
              ))}
            </nav>
          </div>
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-surface/50 p-4 xl:block">
            <TaskTray snap={snap} canWrite={canWrite} watchOnly={watchOnly} onAssign={(taskId, agentId) => assign.mutate({ taskId, agentId })} />
          </aside>
        </div>
      )}

      {selected ? (
        <AgentSheet key={selected.id} agent={selected} departmentName={selected.department_id ? deptName.get(selected.department_id) ?? null : t("Hot desks")}
          canWrite={canWrite} canDecide={canDecide} onClose={() => openAgent(undefined)} />
      ) : null}
    </div>
  );
}
