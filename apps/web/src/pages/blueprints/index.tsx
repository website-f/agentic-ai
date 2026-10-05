import {
  BlueprintIcon, CheckCircleIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, RobotIcon, SparkleIcon, TrashIcon, UserPlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
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

function BlueprintCard({ bp, canManage, toolCount, guideApply }: { bp: Blueprint; canManage: boolean; toolCount: number | null; guideApply?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/blueprints/${bp.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: blueprintKeys.all }); toast.success(t("{name} deleted.", { name: bp.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="flex flex-col">
      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-3 p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: bp.color }}>
            <BlueprintIcon size={20} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] leading-snug font-semibold break-words">{bp.name}</p>
            <p className="text-[12.5px] break-words text-muted">{bp.role || t("No job title")}</p>
          </div>
          {canManage ? (
            <Menu>
              <MenuTrigger asChild><Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 max-sm:size-9" aria-label={t("Options for {name}", { name: bp.name })}><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
              <MenuContent>
                <MenuItem icon={<UserPlusIcon />} onSelect={() => setApplying(true)}>{t("Apply to an agent")}</MenuItem>
                <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>{t("Edit")}</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>{t("Delete")}</MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </div>
        {bp.description ? <p className="line-clamp-3 text-[13px] break-words text-muted">{bp.description}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {toolCount !== null ? <Pill>{toolCount === 1 ? t("1 tool") : t("{n} tools", { n: toolCount })}</Pill> : null}
          {bp.sop_ids.length ? <Pill>{bp.sop_ids.length === 1 ? t("1 SOP") : t("{n} SOPs", { n: bp.sop_ids.length })}</Pill> : null}
          {bp.skill_ids.length ? <Pill>{bp.skill_ids.length === 1 ? t("1 skill") : t("{n} skills", { n: bp.skill_ids.length })}</Pill> : null}
          <Pill tone={bp.autonomy === "auto" ? "warn" : "neutral"}>{bp.autonomy === "auto" ? t("Acts on its own") : t("Asks first")}</Pill>
          {bp.used_by ? <Pill tone="accent">{t("{n} using", { n: bp.used_by })}</Pill> : null}
          {bp.source === "analyst" ? <Pill tone="info">{t("AI-drafted")}</Pill> : null}
        </div>
      </div>
      {canManage ? (
        <div className="border-t border-border px-4 py-3">
          <Button data-guide={guideApply} size="sm" variant="outline" className="w-full max-sm:h-9" onClick={() => setApplying(true)}><UserPlusIcon size={14} /> {t("Apply to an agent")}</Button>
        </div>
      ) : null}
      {editing ? <BlueprintDialog editing={bp} open onOpenChange={setEditing} /> : null}
      {applying ? <ApplyDialog bp={bp} open onOpenChange={setApplying} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Delete {name}?", { name: bp.name })}
        body={t("Agents already created from it keep their settings; you just can't apply it again.")} confirmLabel={t("Delete")} danger
        onConfirm={async () => { await del.mutateAsync(); }} />
    </Card>
  );
}

export function BlueprintsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const { data: blueprints = [], isLoading, error } = useQuery(blueprintsQuery);
  const { data: registry } = useQuery(toolsQuery);
  const [creating, setCreating] = useState(0);
  const [q, setQ] = useState("");
  // Same rule as the scope editor: a tool is allowed unless this blueprint (or the tool's default) says never.
  const toolsFor = (bp: Blueprint) => registry ? registry.filter((tool) => (bp.tools[tool.name] ?? tool.default_mode) !== "deny").length : null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return blueprints.filter((b) => !needle || `${b.name} ${b.role} ${b.description}`.toLowerCase().includes(needle));
  }, [blueprints, q]);
  return (
    <Page>
      <PageHeader title={t("Blueprints")}
        description={t("Reusable role packages — instructions, model, tool scope, SOPs and skills. Define a role once, then stamp it onto any agent so it starts as a trained specialist.")}
        actions={canManage ? <Button data-guide="blueprints.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("New blueprint")}</Button> : null} />
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
            {blueprints.length > 6 ? <SearchInput value={q} onChange={setQ} placeholder={t("Search blueprints")} className="sm:max-w-80" /> : null}
            {shown.length ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((bp, i) => <BlueprintCard key={bp.id} bp={bp} canManage={canManage} toolCount={toolsFor(bp)} guideApply={i === 0 ? "blueprints.apply" : undefined} />)}
              </div>
            ) : <EmptyState icon={BlueprintIcon} title={t("No blueprint matches")} body={t("Try another word.")} />}
          </>
        )}
      {creating ? <BlueprintDialog key={creating} open onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
