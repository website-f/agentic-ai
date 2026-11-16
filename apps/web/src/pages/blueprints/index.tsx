import {
  BlueprintIcon, CheckCircleIcon, PlusIcon, RobotIcon, SparkleIcon, UserPlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { DataTable, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { msg, useLang, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { BLUEPRINT_COLORS, blueprintKeys, blueprintsQuery, type Blueprint, type BlueprintInput } from "@/lib/blueprints";
import { meQuery } from "@/lib/queries";
import { skillsQuery } from "@/lib/skills";
import { cn } from "@/lib/utils";
import { agentsQuery, sopsQuery, toolsQuery, workKeys, type ToolMode } from "@/lib/work";
import { chatGroupsQuery } from "@/pages/ai-engine/data";
import { ReviewPolicyCard } from "@/pages/tasks/accountable";

import { RecruitButton } from "./recruit";

const MODES: { value: ToolMode; label: string }[] = [
  { value: "allow", label: msg("Allow") },
  { value: "ask", label: msg("Ask me") },
  { value: "deny", label: msg("Never") },
];
const RISK_TONE = { low: "neutral", medium: "warn", high: "danger" } as const;
const RISK_LABEL: Record<string, string> = { low: msg("low"), medium: msg("medium"), high: msg("high") };

const EMPTY: BlueprintInput = {
  name: "", description: "", role: "", soul: "", model_group: "smart",
  tools: {}, autonomy: "ask", sop_ids: [], skill_ids: [], color: BLUEPRINT_COLORS[0]!,
};

function Chips<T extends { id: string }>({ items, selected, onToggle, label, empty }: {
  items: (T & { label: string; hint?: string })[];
  selected: string[];
  onToggle: (id: string) => void;
  label: string;
  empty: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium">{label}</legend>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const on = selected.includes(it.id);
            return (
              <button type="button" key={it.id} aria-pressed={on} title={it.hint} onClick={() => onToggle(it.id)}
                className={cn("min-h-9 max-w-full rounded-full border px-3 py-1 text-left text-[12.5px] break-words transition-colors sm:min-h-8", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-2")}>
                {it.label}
              </button>
            );
          })}
        </div>
      ) : <p className="text-[12.5px] text-muted">{empty}</p>}
    </fieldset>
  );
}

function ScopeEditor({ tools, onChange }: { tools: Record<string, ToolMode>; onChange: (t: Record<string, ToolMode>) => void }) {
  const t = useT();
  // "Never" is also the time word (Tidak pernah); the tool setting needs its own Malay word.
  const lang = useLang((s) => s.lang);
  const { data: registry = [] } = useQuery(toolsQuery);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium">{t("Tool scope")}</legend>
      <p className="-mt-1 mb-1 text-[12px] text-muted">{t("What this role may do. \"Never\" removes the tool entirely — an agent from this blueprint can never use it.")}</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
        {registry.map((tool) => {
          const mode = tools[tool.name] ?? tool.default_mode;
          return (
            <li key={tool.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="min-w-0 flex-1 basis-40">
                <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                  {tool.label}
                  {tool.risk !== "low" ? <Pill tone={RISK_TONE[tool.risk as keyof typeof RISK_TONE]}>{RISK_LABEL[tool.risk] ? t(RISK_LABEL[tool.risk]!) : tool.risk}</Pill> : null}
                </span>
              </span>
              <span role="radiogroup" aria-label={t("{tool} access", { tool: tool.label })} className="inline-flex overflow-hidden rounded-sm border border-border">
                {MODES.map((m) => (
                  <button type="button" role="radio" aria-checked={mode === m.value} key={m.value} onClick={() => onChange({ ...tools, [tool.name]: m.value })}
                    className={cn("min-h-9 px-3 text-[12px] transition-colors sm:min-h-8 sm:px-2.5", mode === m.value
                      ? m.value === "deny" ? "bg-danger/12 font-medium text-danger" : "bg-accent font-medium text-accent-fg"
                      : "text-muted hover:bg-surface-2")}>
                    {m.value === "deny" && lang === "ms" ? t("Never (tool permission)") : t(m.label)}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function BlueprintDialog({ editing, open, onOpenChange }: { editing?: Blueprint; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: groups = [] } = useQuery(chatGroupsQuery);
  const { data: sops = [] } = useQuery(sopsQuery);
  const { data: skills = [] } = useQuery(skillsQuery());
  const { data: me } = useSuspenseQuery(meQuery);
  const canReview = me.permissions.includes("agents.manage"); // P21: review stages
  const [d, setD] = useState<BlueprintInput>(() => editing ? {
    name: editing.name, description: editing.description, role: editing.role, soul: editing.soul,
    model_group: editing.model_group, tools: editing.tools, autonomy: editing.autonomy,
    sop_ids: editing.sop_ids, skill_ids: editing.skill_ids, color: editing.color,
  } : EMPTY);
  const set = (p: Partial<BlueprintInput>) => setD((s) => ({ ...s, ...p }));
  const toggle = (key: "sop_ids" | "skill_ids", id: string) =>
    set({ [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] } as Partial<BlueprintInput>);

  const save = useMutation({
    mutationFn: () => editing
      ? api<Blueprint>(`/api/blueprints/${editing.id}`, "PATCH", d)
      : api<Blueprint>("/api/blueprints", "POST", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blueprintKeys.all });
      toast.success(editing ? t("Blueprint saved.") : t("Blueprint \"{name}\" created.", { name: d.name }));
      onOpenChange(false);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? t("Edit {name}", { name: editing.name }) : t("New blueprint")}
      description={t("A reusable role: instructions, model, tool scope, SOPs and skills. Apply it to any agent.")}
      className="w-[min(96vw,42rem)]"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        <Button loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>{t("Save blueprint")}</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Name")} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("e.g. Inbox Reader")} autoFocus error={fields.name} />
          <Field label={t("Job title")} value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder={t("e.g. Inbox Analyst")} />
        </div>
        <Field label={t("One-line description")} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("What this role is for")} />
        <TextareaField label={t("Instructions (soul)")} value={d.soul} onChange={(e) => set({ soul: e.target.value })} rows={4}
          placeholder={t("How this role works, what it is careful about, what it must never do.")} hint={t("Markdown. This becomes the agent's standing instructions.")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Model group")}</span>
            <Select value={d.model_group} onValueChange={(v) => set({ model_group: v })} label={t("Model group")}
              options={groups.map((g) => ({ value: g.name, label: g.label ?? g.name }))} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Autonomy")}</span>
            <Select value={d.autonomy} onValueChange={(v) => set({ autonomy: v as "ask" | "auto" })} label={t("Autonomy")}
              options={[{ value: "ask", label: t("Ask before acting") }, { value: "auto", label: t("Act on its own (within scope)") }]} />
          </div>
        </div>
        <ScopeEditor tools={d.tools} onChange={(tools) => set({ tools })} />
        <Chips label={t("SOPs it follows")} empty={t("No library SOPs yet.")} selected={d.sop_ids} onToggle={(id) => toggle("sop_ids", id)}
          items={sops.filter((s) => s.scope === "library").map((s) => ({ id: s.id, label: s.title }))} />
        <Chips label={t("Skills it can use")} empty={t("No skills yet.")} selected={d.skill_ids} onToggle={(id) => toggle("skill_ids", id)}
          items={skills.map((s) => ({ id: s.id, label: s.name, hint: s.description }))} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Colour")}</span>
          <div className="flex flex-wrap gap-2.5">
            {BLUEPRINT_COLORS.map((c) => (
              <button type="button" key={c} aria-label={c} aria-pressed={d.color === c} onClick={() => set({ color: c })}
                className={cn("size-9 rounded-full transition-transform hover:scale-105 sm:size-8", d.color === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} style={{ background: c }} />
            ))}
          </div>
        </div>
        {editing ? <ReviewPolicyCard kind="blueprints" id={editing.id} canEdit={canReview} /> : (
          <p className="text-[12.5px] text-muted">{t("Review stages (a reviewer agent before a person) can be set once the blueprint is saved.")}</p>
        )}
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

function ApplyDialog({ bp, open, onOpenChange }: { bp: Blueprint; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const mine = agents.filter((a) => a.status !== "retired" && !a.clone_of && a.can_manage && !a.view_only);
  const [agentId, setAgentId] = useState("");
  const apply = useMutation({
    mutationFn: () => api(`/api/blueprints/${bp.id}/apply`, "POST", { agent_id: agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: blueprintKeys.all });
      toast.success(t("Applied \"{blueprint}\" to {agent}.", { blueprint: bp.name, agent: agents.find((a) => a.id === agentId)?.name ?? "" }));
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Apply \"{name}\"", { name: bp.name })}
      description={t("This replaces the agent's role, instructions, model, tool scope and SOPs with this blueprint's, and grants its skills.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        <Button disabled={!agentId} loading={apply.isPending} onClick={() => apply.mutate()}>{t("Apply")}</Button></>}>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Agent")}</span>
        <Select value={agentId} onValueChange={setAgentId} label={t("Agent")} placeholder={t("Pick an agent")}
          options={mine.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))} />
        {!mine.length ? <p className="text-[12.5px] text-muted">{t("No agents you can change.")}</p> : null}
      </div>
    </ResponsiveDialog>
  );
}

/** P107: a row's Apply button and ⋯ menu (apply, edit, delete), with their dialogs. */
function ApplyButton({ bp, guideApply }: { bp: Blueprint; guideApply?: string }) {
  const t = useT();
  const [applying, setApplying] = useState(false);
  return (
    <>
      <Button data-guide={guideApply} size="sm" variant="outline" className="max-sm:hidden" onClick={() => setApplying(true)}>
        <UserPlusIcon size={14} /> {t("Apply to an agent")}
      </Button>
      {applying ? <ApplyDialog bp={bp} open onOpenChange={setApplying} /> : null}
    </>
  );
}

export function BlueprintsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const { data: blueprints = [], isLoading, error } = useQuery(blueprintsQuery);
  const { data: registry } = useQuery(toolsQuery);
  const [creating, setCreating] = useState(0);
  // P107: the row menu's Edit and Apply open these; Delete is the table's own confirmation.
  const [editing, setEditing] = useState<Blueprint | null>(null);
  const [applying, setApplying] = useState<Blueprint | null>(null);
  const qc = useQueryClient();
  const remove = async (bp: Blueprint) => {
    await api(`/api/blueprints/${bp.id}`, "DELETE");
    void qc.invalidateQueries({ queryKey: blueprintKeys.all });
  };
  // Same rule as the scope editor: a tool is allowed unless this blueprint (or the tool's default) says never.
  const toolsFor = (bp: Blueprint) => registry ? registry.filter((tool) => (bp.tools[tool.name] ?? tool.default_mode) !== "deny").length : null;
  // P107: a data table; search, filters and page live in the address.
  const control = useTableState({ size: 25 }, { filters: ["use", "model", "autonomy"] });
  const { use, model, autonomy } = control.state.f;
  const models = useMemo(() => [...new Set(blueprints.map((b) => b.model_group))].sort().map((m) => ({ value: m, label: m })), [blueprints]);
  const shown = useMemo(() => blueprints.filter((b) =>
    (!use || (use === "used" ? b.used_by > 0 : !b.used_by))
    && (!model || b.model_group === model)
    && (!autonomy || b.autonomy === autonomy)), [blueprints, use, model, autonomy]);
  const firstId = shown[0]?.id;
  const columns: Column<Blueprint>[] = [
    {
      id: "name", header: t("Blueprint"), card: "title", sortValue: (bp) => bp.name.toLowerCase(), exportValue: (bp) => bp.name,
      cell: (bp) => (
        <span className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: bp.color }}>
            <BlueprintIcon size={16} weight="duotone" />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="text-[13.5px] font-semibold break-words">{bp.name}</span>
            <span className="text-[12.5px] break-words text-muted">{bp.role || t("No job title")}</span>
            {bp.description ? <span className="line-clamp-2 text-[12px] break-words text-muted">{bp.description}</span> : null}
          </span>
        </span>
      ),
    },
    { id: "model", header: t("Model"), sortValue: (bp) => bp.model_group, cell: (bp) => <Pill className="font-mono">{bp.model_group}</Pill> },
    {
      id: "autonomy", header: t("Autonomy"), sortValue: (bp) => bp.autonomy,
      exportValue: (bp) => (bp.autonomy === "auto" ? t("Acts on its own") : t("Asks first")),
      cell: (bp) => <Pill tone={bp.autonomy === "auto" ? "warn" : "neutral"}>{bp.autonomy === "auto" ? t("Acts on its own") : t("Asks first")}</Pill>,
    },
    {
      id: "contents", header: t("Includes"), hideBelow: "xl",
      cell: (bp) => {
        const tools = toolsFor(bp);
        return (
          <span className="flex flex-wrap gap-1 text-[11.5px]">
            {tools !== null ? <Pill>{tools === 1 ? t("1 tool") : t("{n} tools", { n: tools })}</Pill> : null}
            {bp.sop_ids.length ? <Pill>{bp.sop_ids.length === 1 ? t("1 SOP") : t("{n} SOPs", { n: bp.sop_ids.length })}</Pill> : null}
            {bp.skill_ids.length ? <Pill>{bp.skill_ids.length === 1 ? t("1 skill") : t("{n} skills", { n: bp.skill_ids.length })}</Pill> : null}
            {bp.source === "analyst" ? <Pill tone="info">{t("AI-drafted")}</Pill> : null}
          </span>
        );
      },
    },
    {
      id: "used", header: t("Agents using it"), kind: "number", align: "right", sortValue: (bp) => bp.used_by,
      cell: (bp) => (bp.used_by ? <span className="font-medium text-accent">{bp.used_by}</span> : <span className="text-muted">0</span>),
    },
  ];
  return (
    <Page>
      <PageHeader title={t("Blueprints")}
        description={t("Reusable role packages — instructions, model, tool scope, SOPs and skills. Define a role once, then stamp it onto any agent so it starts as a trained specialist.")}
        actions={canManage ? (
          <>
            {me.permissions.includes("agents.manage") ? <RecruitButton /> : null}
            <Button data-guide="blueprints.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("New blueprint")}</Button>
          </>
        ) : null} />
      {isLoading ? <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-[var(--radius-md)]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !blueprints.length ? (
          <EmptyState icon={BlueprintIcon} title={t("No blueprints yet")}
            body={t("A blueprint is a job description an agent can wear: its instructions, which model it uses, exactly which tools it may touch, and the SOPs and skills it follows.")}
            action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Create first blueprint")}</Button> : undefined} />
        ) : (
          <>
            <StatGrid>
              <Stat label={t("Blueprints")} value={blueprints.length} icon={BlueprintIcon} tone="accent" hint={t("Reusable roles")} />
              <Stat label={t("In use")} value={blueprints.filter((b) => b.used_by).length} icon={CheckCircleIcon} tone="ok" hint={t("Applied to at least one agent")} />
              <Stat label={t("Agents using them")} value={blueprints.reduce((n, b) => n + b.used_by, 0)} icon={RobotIcon} tone="info" hint={t("Across all blueprints")} />
              <Stat label={t("AI-drafted")} value={blueprints.filter((b) => b.source === "analyst").length} icon={SparkleIcon} tone="violet" hint={t("Drafted by an analyst agent")} />
            </StatGrid>
            <DataTable
              label={t("Blueprints")}
              columns={columns}
              rows={shown}
              rowId={(bp) => bp.id}
              rowLabel={(bp) => bp.name}
              control={control}
              searchText={(bp) => `${bp.name} ${bp.role} ${bp.description} ${bp.model_group}`}
              searchPlaceholder={t("Search blueprints")}
              filters={
                <>
                  <TableFilter control={control} id="use" label={t("In use")} allLabel={t("In use or not")}
                    options={[{ value: "used", label: t("In use") }, { value: "unused", label: t("Not in use") }]} />
                  {models.length > 1 ? <TableFilter control={control} id="model" label={t("Model")} allLabel={t("All models")} options={models} /> : null}
                  <TableFilter control={control} id="autonomy" label={t("Autonomy")} allLabel={t("Any autonomy")}
                    options={[{ value: "ask", label: t("Asks first") }, { value: "auto", label: t("Acts on its own") }]} />
                </>
              }
              exportName={t("blueprints")}
              actions={canManage ? (bp) => <ApplyButton bp={bp} guideApply={bp.id === firstId ? "blueprints.apply" : undefined} /> : undefined}
              rowActions={canManage ? {
                edit: (bp) => setEditing(bp),
                more: (bp) => <MenuItem icon={<UserPlusIcon />} onSelect={() => setApplying(bp)}>{t("Apply to an agent")}</MenuItem>,
                remove,
                removeBody: () => t("Agents already created from it keep their settings; you just can't apply it again."),
              } : undefined}
            />
          </>
        )}
      {creating ? <BlueprintDialog key={creating} open onOpenChange={(o) => !o && setCreating(0)} /> : null}
      {editing ? <BlueprintDialog key={editing.id} editing={editing} open onOpenChange={(o) => !o && setEditing(null)} /> : null}
      {applying ? <ApplyDialog key={applying.id} bp={applying} open onOpenChange={(o) => !o && setApplying(null)} /> : null}
    </Page>
  );
}
