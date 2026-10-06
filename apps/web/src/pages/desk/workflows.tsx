/** My workspace → Workflows & SOPs: pick a workflow, read its steps, see which AI workers
 * follow it and when they work, switch an agent on or off, and run it again. */
import {
  ArrowSquareOutIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  FlowArrowIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Switch } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { IconTile } from "@/components/page";
import { PinButton } from "@/components/pin-button";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { deskKeys, followWorkflow, type Desk, type DeskPerson, type DeskWorkflow } from "@/lib/desk";
import { describeHours } from "@/lib/staff";
import { cn } from "@/lib/utils";
import { NODE_COLOR, NODE_TYPES, type NodeType, type Workflow } from "@/lib/workflows";
import { StartRunDialog } from "@/pages/workflows/run";

export function hoursOf(t: (s: string) => string, p: Pick<DeskPerson, "work_hours">): string {
  return p.work_hours ? describeHours(p.work_hours) : t("Any time");
}

export function WorkflowsTab({ desk }: { desk: Desk }) {
  const t = useT();
  const [view, setView] = useState<"workflows" | "sops">("workflows");
  return (
    <div data-guide="desk.procedures" className="grid min-w-0 gap-4">
      <Segmented
        label={t("Show")}
        value={view}
        onChange={setView}
        options={[
          { value: "workflows", label: t("Workflows"), count: desk.procedures.workflow_total },
          { value: "sops", label: "SOP", count: desk.procedures.sop_total },
        ]}
      />
      {view === "workflows" ? <Workflows desk={desk} /> : <Sops desk={desk} />}
    </div>
  );
}

function Workflows({ desk }: { desk: Desk }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "mine">(desk.procedures.workflows.some((w) => w.followed) ? "mine" : "all");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return desk.procedures.workflows.filter(
      (w) => (only === "all" || w.followed) && (!needle || `${w.name} ${w.description}`.toLowerCase().includes(needle)),
    );
  }, [desk.procedures.workflows, q, only]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = list.find((w) => w.id === picked) ?? list[0] ?? null;
  if (!desk.procedures.workflows.length) {
    return (
      <Card>
        <CardBody className="text-[13px] text-muted">{t("No active workflows for your company yet.")}</CardBody>
      </Card>
    );
  }
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="flex min-w-0 flex-col lg:max-h-[calc(100dvh-14rem)]">
        <div className="grid gap-2.5 border-b border-border p-3">
          <SearchInput value={q} onChange={setQ} placeholder={t("Search workflows")} />
          <Segmented size="sm" label={t("Show")} value={only} onChange={setOnly}
            options={[
              { value: "mine", label: t("My AI follows"), count: desk.procedures.workflows.filter((w) => w.followed).length },
              { value: "all", label: t("All"), count: desk.procedures.workflows.length },
            ]} />
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain" role="listbox" aria-label={t("Workflows")}>
          {list.length ? (
            list.map((w) => {
              const active = current?.id === w.id;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setPicked(w.id);
                      if (window.matchMedia("(max-width: 1023px)").matches) {
                        requestAnimationFrame(() => document.getElementById("desk-workflow")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                      }
                    }}
                    className={cn(
                      "grid w-full gap-1 px-4 py-3 text-left transition-colors",
                      active ? "bg-accent-soft/60" : "hover:bg-surface-2/70",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FlowArrowIcon size={16} className={active ? "shrink-0 text-accent" : "shrink-0 text-muted"} />
                      <span className="min-w-0 truncate text-[14px] font-medium">{w.name}</span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-[12px] text-muted">
                      <span>{t("{n} steps", { n: w.steps })}</span>
                      {w.followers.length ? (
                        <span className="flex items-center -space-x-1.5">
                          {w.followers.slice(0, 4).map((f) => (
                            <AgentAvatar key={f.id} name={f.name} color={f.color} size="xs" className="ring-2 ring-surface" />
                          ))}
                        </span>
                      ) : (
                        <span>{t("Nobody follows it yet")}</span>
                      )}
                      {w.followed ? <Pill tone="accent" className="px-1.5 py-0 text-[11px]">{t("Your AI")}</Pill> : null}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-4 py-6 text-center text-[13px] text-muted">{t("Nothing matches.")}</li>
          )}
        </ul>
      </Card>
      {current ? <WorkflowDetail key={current.id} wf={current} desk={desk} /> : null}
    </div>
  );
}

function WorkflowDetail({ wf, desk }: { wf: DeskWorkflow; desk: Desk }) {
  const t = useT();
  const qc = useQueryClient();
  const [running, setRunning] = useState<Workflow | null>(null);
  const run = useMutation({
    mutationFn: () => api<Workflow>(`/api/workflows/${wf.id}`),
    onSuccess: setRunning,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const follow = useMutation({
    mutationFn: ({ agent, on }: { agent: DeskPerson; on: boolean }) => followWorkflow(wf.id, agent.id, on),
    onSuccess: (_r, { agent, on }) => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(on ? t("{name} now follows {workflow}.", { name: agent.name, workflow: wf.name }) : t("{name} no longer follows {workflow}.", { name: agent.name, workflow: wf.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const followers = new Set(wf.followers.map((f) => f.id));
  const others = wf.followers.filter((f) => !desk.assignable.some((a) => a.id === f.id));
  // Your own AI and the agents already on it stay listed; the rest are found by name, so a
  // company with dozens of agents does not get a page of switches.
  const listed = desk.assignable.filter((a) => a.mine || followers.has(a.id));
  const more = desk.assignable.filter((a) => !a.mine && !followers.has(a.id));
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const found = more.filter((a) => !needle || `${a.name} ${a.role}`.toLowerCase().includes(needle));
  const toggleRow = (a: DeskPerson) => {
    const on = followers.has(a.id);
    return (
      <li key={a.id} className={cn("flex min-w-0 items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 transition-colors", on ? "border-accent/40 bg-accent-soft/30" : "border-border")}>
        <AgentAvatar name={a.name} color={a.color} size="sm" />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium">{a.name}</span>
            {a.mine ? <Pill tone="accent" className="px-1.5 py-0 text-[11px]">{t("Yours")}</Pill> : null}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted">
            <ClockIcon size={12} className="shrink-0" /> <span className="truncate">{hoursOf(t, a)}</span>
          </span>
        </span>
        <Switch.Root
          checked={on}
          disabled={follow.isPending}
          onCheckedChange={(v) => follow.mutate({ agent: a, on: v })}
          aria-label={on ? t("{name} follows this workflow", { name: a.name }) : t("Let {name} follow this workflow", { name: a.name })}
          className="relative h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
        >
          <Switch.Thumb className="grid size-5 translate-x-0.5 place-items-center rounded-full bg-white text-accent shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]">
            {on ? <CheckIcon size={11} weight="bold" /> : null}
          </Switch.Thumb>
        </Switch.Root>
      </li>
    );
  };
  return (
    <Card id="desk-workflow" className="min-w-0 scroll-mt-20">
      <CardHeader
        title={wf.name}
        description={wf.description || t("{n} steps", { n: wf.steps })}
        icon={<IconTile icon={FlowArrowIcon} size="sm" tone="violet" />}
        actions={
          <>
            <PinButton kind="workflow" refId={wf.id} title={wf.name} />
            <Button size="sm" variant="ghost" asChild>
              <Link to="/workflows" search={{ w: wf.id }}><ArrowSquareOutIcon size={14} /> {t("Open the map")}</Link>
            </Button>
            <Button size="sm" loading={run.isPending} onClick={() => run.mutate()}>
              <PlayIcon size={14} weight="fill" /> {t("Run it now")}
            </Button>
          </>
        }
      />
      <CardBody className="grid gap-6">
        <section className="grid gap-2.5">
          <h3 className="text-[13px] font-semibold">{t("The steps")}</h3>
          {wf.step_list.length ? (
            <ol className="grid gap-0">
              {wf.step_list.map((s, i) => {
                const type = (NODE_TYPES.some((n) => n.type === s.type) ? s.type : "step") as NodeType;
                const label = NODE_TYPES.find((n) => n.type === type)?.label ?? "Step";
                return (
                  <li key={i} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
                    {i < wf.step_list.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-[0.8rem] w-px bg-border" /> : null}
                    <span className="grid size-7 place-items-center rounded-full text-[12px] font-semibold text-white tabular" style={{ background: NODE_COLOR[type] }}>
                      {i + 1}
                    </span>
                    <span className="grid min-w-0 gap-0.5 pt-0.5">
                      <span className="text-[13.5px] break-words">{s.title || t(label)}</span>
                      <span className="text-[11.5px] text-muted">{t(label)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">{t("Open the map to see its steps.")}</p>
          )}
        </section>

        <section className="grid gap-2.5">
          <div>
            <h3 className="text-[13px] font-semibold">{t("Who follows it, and when they work")}</h3>
            <p className="text-[12.5px] text-muted">
              {t("An agent that follows this workflow does that job this way. Work given outside its hours waits for its next shift.")}
            </p>
          </div>
          {listed.length ? (
            <ul className="grid gap-2">{listed.map(toggleRow)}</ul>
          ) : !more.length ? (
            <p className="text-[13px] text-muted">{t("You have no AI worker of your own yet.")}</p>
          ) : (
            <p className="text-[13px] text-muted">{t("Nobody follows it yet")}</p>
          )}
          {more.length ? (
            <div className="grid gap-2 rounded-[var(--radius-sm)] border border-dashed border-border p-3">
              <p className="text-[12.5px] font-medium">{t("Add another agent ({n})", { n: more.length })}</p>
              <SearchInput value={find} onChange={setFind} placeholder={t("Find an agent by name or role")} />
              <ul className="grid max-h-72 gap-2 overflow-y-auto overscroll-contain pr-1">
                {found.length ? found.map(toggleRow) : <li className="px-1 py-2 text-[12.5px] text-muted">{t("Nothing matches.")}</li>}
              </ul>
            </div>
          ) : null}

          {others.length ? (
            <div className="grid gap-1.5 pt-1">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted"><UsersThreeIcon size={14} /> {t("Also followed by")}</p>
              <div className="flex flex-wrap gap-1.5">
                {others.map((f) => (
                  <span key={f.id} className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[12px]">
                    <AgentAvatar name={f.name} color={f.color} size="xs" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-muted">· {hoursOf(t, f)}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </CardBody>
      {running ? <StartRunDialog wf={running} onClose={() => setRunning(null)} /> : null}
    </Card>
  );
}

function Sops({ desk }: { desk: Desk }) {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = desk.procedures.sops.filter((s) => !needle || s.title.toLowerCase().includes(needle));
  return (
    <Card>
      <CardHeader
        title={t("SOPs for your job")}
        description={t("Your department's first, then your company's, then everyone's.")}
        icon={<IconTile icon={FileTextIcon} size="sm" tone="info" />}
        actions={<Button size="sm" variant="ghost" asChild><Link to="/sops">{t("All SOPs")}</Link></Button>}
      />
      <div className="border-b border-border px-4 py-2.5 sm:px-5">
        <SearchInput value={q} onChange={setQ} placeholder={t("Search SOPs")} />
      </div>
      {list.length ? (
        <ListCard className="rounded-none border-0">
          {list.map((s) => (
            <ListRow key={s.id} onClick={() => void navigate({ href: s.url })}
              leading={<IconTile icon={FileTextIcon} size="sm" tone="neutral" />}
              title={s.title}
              meta={s.scope === "department" ? t("Your department") : s.scope === "branch" ? t("Your company") : s.scope === "library" ? t("Library") : t("Everyone")}
              trailing={<PinButton kind="sop" refId={s.id} title={s.title} />} />
          ))}
        </ListCard>
      ) : (
        <CardBody className="flex items-center gap-2 text-[13px] text-muted"><MagnifyingGlassIcon size={15} /> {q ? t("Nothing matches.") : t("No SOPs for your job yet.")}</CardBody>
      )}
    </Card>
  );
}
