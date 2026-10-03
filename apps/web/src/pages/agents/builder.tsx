import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FileTextIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { api, ApiError, errorMessage } from "@/lib/api";
import { branchesQuery, keys, meQuery } from "@/lib/queries";
import { useBranch } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { sopsQuery, templatesQuery, workKeys, type Agent, type Template, type ToolMode } from "@/lib/work";
import { groupsQuery } from "@/pages/ai-engine/data";

import { ToolMatrix } from "./tool-matrix";

const STEPS = ["Template", "Placement", "Identity", "SOPs", "Permissions", "Review"] as const;
const COLORS = ["#2f6db5", "#b7791f", "#7a5af5", "#0f8ba0", "#5b6b2f", "#c2412d", "#b04a87", "#13895f"];

interface Draft {
  template: string | null;
  branch_id: string;
  department_id: string | null;
  name: string;
  role: string;
  soul: string;
  color: string;
  model_group: string;
  tools: Record<string, ToolMode>;
  autonomy: "ask" | "auto";
  sop_ids: string[];
  personal?: boolean;
}

function TemplateCard({ t, selected, onPick }: { t: Template | null; selected: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-[var(--radius-md)] border p-3.5 text-left transition-[border-color,background-color,box-shadow]",
        selected ? "border-accent bg-accent-soft/50 ring-2 ring-accent/15" : "border-border bg-surface hover:border-accent/40 hover:shadow-[var(--shadow-soft)]",
      )}
    >
      {t ? <AgentAvatar name={t.role} color={t.color} size="sm" /> : <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted"><SparkleIcon size={16} /></span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{t ? t.role : "Blank agent"}</span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{t ? t.soul.split(". ")[0] + "." : "Start from nothing and write the personality yourself."}</span>
      </span>
      {selected ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
          <CheckIcon size={12} weight="bold" />
        </span>
      ) : null}
    </button>
  );
}

export function AgentBuilderPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: templates = [] } = useQuery(templatesQuery);
  const { data: sops = [] } = useQuery(sopsQuery);
  const { data: groups = [] } = useQuery(groupsQuery);
  const { data: me } = useSuspenseQuery(meQuery);
  // Staff (agents.own) make personal agents; managers may make one for themselves too.
  const ownOnly = !me.permissions.includes("agents.manage");
  const scope = me.scope && me.scope.kind !== "all" ? me.scope : null;
  const branchId = useBranch((s) => s.branchId);
  const startBranch = branches.find((b) => b.id === (scope?.branch_id ?? branchId)) ?? branches[0];

  const [step, setStep] = useState(0);
  // undefined = nothing picked yet; null = blank agent; string = template id
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [d, setD] = useState<Draft>(() => ({
    template: null, branch_id: startBranch?.id ?? "", department_id: scope?.department_id ?? null, name: "", role: "", soul: "",
    color: COLORS[0]!, model_group: "smart", tools: {}, autonomy: "ask", sop_ids: [], personal: ownOnly,
  }));
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const branch = branches.find((b) => b.id === (d.branch_id || startBranch?.id)) ?? startBranch;

  const pickTemplate = (t: Template | null) => {
    setPicked(t?.id ?? null);
    const dept = t && branch ? branch.departments.find((x) => x.name.toLowerCase() === t.department.toLowerCase()) : undefined;
    set({
      template: t?.id ?? null, role: t?.role ?? "", soul: t?.soul ?? "", color: t?.color ?? COLORS[0]!,
      model_group: t?.model_group ?? "smart", tools: t?.tools ?? {}, branch_id: branch?.id ?? "",
      department_id: dept?.id ?? d.department_id,
    });
  };

  const autoSops = useMemo(() => sops.filter((s) =>
    s.scope === "workspace" || (s.scope === "branch" && s.scope_id === d.branch_id) ||
    (s.scope === "department" && s.scope_id === d.department_id)), [sops, d.branch_id, d.department_id]);
  const library = sops.filter((s) => s.scope === "library");

  const preview = useQuery({
    queryKey: ["agents", "preview", d],
    queryFn: () => api<{ prompt: string; tokens_estimate: number; parts: { title: string; chars: number }[] }>("/api/agents/preview-prompt", "POST", {
      ...d, name: d.name || "New agent", role: d.role || "Agent",
    }),
    enabled: step === STEPS.length - 1 && !!d.branch_id,
  });

  const create = useMutation({
    mutationFn: () => api<Agent>("/api/agents", "POST", d),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(`${a.name} joined ${a.department_name ?? a.branch_name}.`);
      navigate({ to: "/agents/$agentId", params: { agentId: a.id } });
    },
  });
  const fieldErrors = create.error instanceof ApiError ? create.error.fields : {};

  const canNext = [
    picked !== undefined,
    !!d.branch_id,
    d.name.trim().length > 0 && d.role.trim().length > 0,
    true,
    true,
    true,
  ][step];

  return (
    <Page className="max-w-3xl">
      <Link to="/agents" className="-my-1 inline-flex h-9 w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <ArrowLeftIcon size={14} /> Agents
      </Link>
      <PageHeader title="New agent" description="Six short steps: a starting point, where it sits, who it is, its SOPs and what it may do." />

      <nav aria-label="Steps" className="rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4">
        <ol className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className="min-w-0 flex-1">
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn("grid w-full gap-1.5 text-left", i < step && "cursor-pointer")}
                aria-current={i === step ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s}${i < step ? " (done)" : ""}`}
              >
                <span className={cn("block h-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-border")} />
                <span className={cn("hidden items-center gap-1 truncate text-[12px] sm:flex", i === step ? "font-medium text-fg" : i < step ? "text-accent" : "text-muted")}>
                  {i < step ? <CheckIcon size={12} weight="bold" className="shrink-0" /> : <span className="tabular">{i + 1}.</span>}
                  <span className="truncate">{s}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12.5px] text-muted sm:hidden">
          Step {step + 1} of {STEPS.length}: <span className="font-medium text-fg">{STEPS[step]}</span>
        </p>
      </nav>

      <motion.div key={step} initial={reduce ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
        {step === 0 ? (
          <section className="grid gap-3">
            <p className="text-[13.5px] text-muted">Pick a starting point. You can change everything afterwards.</p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              {templates.map((t) => <TemplateCard key={t.id} t={t} selected={picked === t.id} onPick={() => pickTemplate(t)} />)}
              <TemplateCard t={null} selected={picked === null} onPick={() => pickTemplate(null)} />
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="grid gap-5">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Company (branch)</span>
              <Select value={d.branch_id} onValueChange={(v) => set({ branch_id: v, department_id: null })} label="Branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-[13px] font-medium">Department</legend>
              <div className="flex flex-wrap gap-2">
                {branch?.departments.map((dep) => (
                  <button key={dep.id} onClick={() => set({ department_id: dep.id })} aria-pressed={d.department_id === dep.id}
                    className={cn("min-h-9 rounded-full border px-3.5 py-1.5 text-[13px]", d.department_id === dep.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:bg-surface-2")}>
                    {dep.name}
                  </button>
                ))}
                <button onClick={() => set({ department_id: null })} aria-pressed={d.department_id === null}
                  className={cn("min-h-9 rounded-full border px-3.5 py-1.5 text-[13px]", d.department_id === null ? "border-accent bg-accent-soft font-medium text-accent" : "border-dashed border-border text-muted")}>
                  No department
                </button>
              </div>
              <p className="text-[12.5px] text-muted">The department decides which SOPs apply automatically and where the agent sits in the office.</p>
            </fieldset>
            {ownOnly ? (
              <p className="rounded-sm bg-accent-soft px-3 py-2 text-[13px] text-accent">This will be your personal agent: you give it work and answer its questions, and your managers can see it.</p>
            ) : (
              <label className="flex items-start gap-2.5 text-[13.5px]">
                <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={!!d.personal} onChange={(e) => set({ personal: e.target.checked })} />
                <span>My personal agent<span className="block text-[12.5px] text-muted">It works for you: only you and your managers manage it.</span></span>
              </label>
            )}
          </section>
        ) : null}

        {step === 2 ? (
          <section className="grid gap-4">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <Field label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Aina" autoFocus error={fieldErrors.name} />
              <Field label="Job title" value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="e.g. Senior Accountant" error={fieldErrors.role} />
            </div>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">Color</legend>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} aria-label={`Color ${c}`} aria-pressed={d.color === c} onClick={() => set({ color: c })}
                    className={cn("size-8 rounded-full ring-offset-2 ring-offset-bg", d.color === c ? "ring-2 ring-fg" : "hover:ring-2 hover:ring-border")} style={{ background: c }} />
                ))}
                {d.name ? <span className="ml-2 flex items-center gap-2 text-[13px] text-muted"><AgentAvatar name={d.name} color={d.color} size="sm" /> Preview</span> : null}
              </div>
            </fieldset>
            <TextareaField label="Personality and way of working" value={d.soul} onChange={(e) => set({ soul: e.target.value })} rows={7}
              hint={`How this agent thinks, writes and reports. ${d.soul.length} characters.`} placeholder="You are a careful accountant who shows workings for every total..." />
          </section>
        ) : null}

        {step === 3 ? (
          <section className="grid gap-5">
            <div className="grid gap-2">
              <h2 className="text-[14px] font-semibold">Applied automatically</h2>
              {autoSops.length ? (
                <ul className="grid gap-1.5">
                  {autoSops.map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5 rounded-sm border border-border bg-surface px-3 py-2 text-[13px]">
                      <CheckIcon size={15} weight="bold" className="text-ok" />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                      <span className="shrink-0 text-[12px] text-muted">{s.scope_label}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-muted">No company or department SOPs yet.</p>}
            </div>
            <div className="grid gap-2">
              <h2 className="text-[14px] font-semibold">From the library</h2>
              {library.length ? (
                <ul className="grid gap-1.5">
                  {library.map((s) => {
                    const on = d.sop_ids.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2 text-[13px]", on ? "border-accent bg-accent-soft/40" : "border-border bg-surface")}>
                          <input type="checkbox" checked={on} onChange={() => set({ sop_ids: on ? d.sop_ids.filter((x) => x !== s.id) : [...d.sop_ids, s.id] })} className="size-4 shrink-0 accent-[var(--accent)]" />
                          <FileTextIcon size={15} className="shrink-0 text-muted" />
                          <span className="min-w-0 flex-1 font-medium break-words">{s.title}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[13px] text-muted">No library SOPs yet.</p>}
              <Link to="/sops" className="w-fit text-[13px] font-medium text-accent hover:underline">Write or edit SOPs</Link>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="grid gap-5">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Model group</span>
              <Select value={d.model_group} onValueChange={(v) => set({ model_group: v })} label="Model group"
                options={groups.map((g) => ({ value: g.name, label: g.label, hint: g.members.length ? `${g.members.length} models` : "No models yet, add some in AI Engine" }))} />
            </div>
            <ToolMatrix tools={d.tools} onChange={(tools) => set({ tools })} autonomy={d.autonomy} onAutonomy={(autonomy) => set({ autonomy })} />
          </section>
        ) : null}

        {step === 5 ? (
          <section className="grid gap-5">
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
              <AgentAvatar name={d.name || "?"} color={d.color} size="lg" />
              <div className="min-w-0">
                <p className="text-[16px] font-semibold break-words">{d.name}</p>
                <p className="text-[13px] text-muted">{d.role} · {branch?.departments.find((x) => x.id === d.department_id)?.name ?? "No department"}, {branch?.name}</p>
                <p className="mt-1 text-[12.5px] text-muted">Model group <span className="font-mono">{d.model_group}</span> · {autoSops.length + d.sop_ids.length} SOPs · {d.autonomy === "auto" ? "works on auto" : "asks before risky tools"}</p>
              </div>
            </div>
            <details className="group rounded-[var(--radius-md)] border border-border bg-surface" open>
              <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium">
                What the agent will be told {preview.data ? <span className="font-normal text-muted">· about {preview.data.tokens_estimate.toLocaleString()} tokens</span> : null}
              </summary>
              <pre className="max-h-80 overflow-auto border-t border-border px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
                {preview.isLoading ? "Building preview..." : preview.data?.prompt ?? (preview.error ? errorMessage(preview.error) : "")}
              </pre>
            </details>
            <FormError message={create.error && !Object.keys(fieldErrors).length ? errorMessage(create.error) : null} />
          </section>
        ) : null}
      </motion.div>

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex justify-between gap-3 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:px-0 md:bottom-0">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeftIcon size={15} /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Next <ArrowRightIcon size={15} />
          </Button>
        ) : (
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            <CheckIcon size={15} weight="bold" /> Create agent
          </Button>
        )}
      </div>
    </Page>
  );
}
