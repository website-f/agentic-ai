import { BlueprintIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api";
import { BLUEPRINT_COLORS, blueprintKeys, blueprintsQuery, type Blueprint, type BlueprintInput } from "@/lib/blueprints";
import { meQuery } from "@/lib/queries";
import { skillsQuery } from "@/lib/skills";
import { cn } from "@/lib/utils";
import { agentsQuery, sopsQuery, toolsQuery, workKeys, type ToolMode } from "@/lib/work";
import { groupsQuery } from "@/pages/ai-engine/data";

const MODES: { value: ToolMode; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask me" },
  { value: "deny", label: "Never" },
];
const RISK_TONE = { low: "neutral", medium: "warn", high: "danger" } as const;

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
                className={cn("rounded-full border px-3 py-1 text-[12.5px]", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-surface-2")}>
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
  const { data: registry = [] } = useQuery(toolsQuery);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[13px] font-medium">Tool scope</legend>
      <p className="-mt-1 mb-1 text-[12px] text-muted">What this role may do. "Never" removes the tool entirely — an agent from this blueprint can never use it.</p>
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {registry.map((t) => {
          const mode = tools[t.name] ?? t.default_mode;
          return (
            <li key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="min-w-0 flex-1 basis-48">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {t.label}
                  {t.risk !== "low" ? <Pill tone={RISK_TONE[t.risk as keyof typeof RISK_TONE]}>{t.risk}</Pill> : null}
                </span>
              </span>
              <span className="inline-flex overflow-hidden rounded-sm border border-border">
                {MODES.map((m) => (
                  <button type="button" key={m.value} onClick={() => onChange({ ...tools, [t.name]: m.value })}
                    className={cn("px-2.5 py-1 text-[12px]", mode === m.value ? "bg-accent text-accent-fg font-medium" : "text-muted hover:bg-surface-2")}>
                    {m.label}
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
  const qc = useQueryClient();
  const { data: groups = [] } = useQuery(groupsQuery);
  const { data: sops = [] } = useQuery(sopsQuery);
  const { data: skills = [] } = useQuery(skillsQuery());
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
      toast.success(editing ? "Blueprint saved." : `Blueprint "${d.name}" created.`);
      onOpenChange(false);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${editing.name}` : "New blueprint"}
      description="A reusable role: instructions, model, tool scope, SOPs and skills. Apply it to any agent."
      className="w-[min(96vw,42rem)]"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>Save blueprint</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) save.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Inbox Reader" autoFocus error={fields.name} />
          <Field label="Job title" value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="e.g. Inbox Analyst" />
        </div>
        <Field label="One-line description" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this role is for" />
        <TextareaField label="Instructions (soul)" value={d.soul} onChange={(e) => set({ soul: e.target.value })} rows={4}
          placeholder="How this role works, what it is careful about, what it must never do." hint="Markdown. This becomes the agent's standing instructions." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Model group</span>
            <Select value={d.model_group} onValueChange={(v) => set({ model_group: v })} label="Model group"
              options={groups.map((g) => ({ value: g.name, label: g.label ?? g.name }))} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Autonomy</span>
            <Select value={d.autonomy} onValueChange={(v) => set({ autonomy: v as "ask" | "auto" })} label="Autonomy"
              options={[{ value: "ask", label: "Ask before acting" }, { value: "auto", label: "Act on its own (within scope)" }]} />
          </div>
        </div>
        <ScopeEditor tools={d.tools} onChange={(tools) => set({ tools })} />
        <Chips label="SOPs it follows" empty="No library SOPs yet." selected={d.sop_ids} onToggle={(id) => toggle("sop_ids", id)}
          items={sops.filter((s) => s.scope === "library").map((s) => ({ id: s.id, label: s.title }))} />
        <Chips label="Skills it can use" empty="No skills yet." selected={d.skill_ids} onToggle={(id) => toggle("skill_ids", id)}
          items={skills.map((s) => ({ id: s.id, label: s.name, hint: s.description }))} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Colour</span>
          <div className="flex gap-2">
            {BLUEPRINT_COLORS.map((c) => (
              <button type="button" key={c} aria-label={c} onClick={() => set({ color: c })}
                className={cn("size-7 rounded-full", d.color === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} style={{ background: c }} />
            ))}
          </div>
        </div>
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

function ApplyDialog({ bp, open, onOpenChange }: { bp: Blueprint; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const mine = agents.filter((a) => a.status !== "retired" && !a.clone_of && a.can_manage);
  const [agentId, setAgentId] = useState("");
  const apply = useMutation({
    mutationFn: () => api(`/api/blueprints/${bp.id}/apply`, "POST", { agent_id: agentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: blueprintKeys.all });
      toast.success(`Applied "${bp.name}" to ${agents.find((a) => a.id === agentId)?.name}.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Apply "${bp.name}"`}
      description="This replaces the agent's role, instructions, model, tool scope and SOPs with this blueprint's, and grants its skills."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!agentId} loading={apply.isPending} onClick={() => apply.mutate()}>Apply</Button></>}>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Agent</span>
        <Select value={agentId} onValueChange={setAgentId} label="Agent" placeholder="Pick an agent"
          options={mine.map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))} />
        {!mine.length ? <p className="text-[12.5px] text-muted">No agents you can change.</p> : null}
      </div>
    </ResponsiveDialog>
  );
}

function Card({ bp, canManage }: { bp: Blueprint; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const toolCount = Object.values(bp.tools).filter((m) => m !== "deny").length;
  const del = useMutation({
    mutationFn: () => api(`/api/blueprints/${bp.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: blueprintKeys.all }); toast.success(`${bp.name} deleted.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 size-8 shrink-0 rounded-[var(--radius-sm)]" style={{ background: bp.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{bp.name}</p>
          <p className="truncate text-[12.5px] text-muted">{bp.role || "No job title"}</p>
        </div>
        {canManage ? (
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Options for ${bp.name}`}><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem icon={<UserPlusIcon />} onSelect={() => setApplying(true)}>Apply to an agent</MenuItem>
              <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>Edit</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      {bp.description ? <p className="line-clamp-2 text-[12.5px] text-muted">{bp.description}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        <Pill>{toolCount} tools</Pill>
        {bp.sop_ids.length ? <Pill>{bp.sop_ids.length} SOPs</Pill> : null}
        {bp.skill_ids.length ? <Pill>{bp.skill_ids.length} skills</Pill> : null}
        {bp.used_by ? <Pill tone="accent">{bp.used_by} using</Pill> : null}
        {bp.source === "analyst" ? <Pill tone="info">AI-drafted</Pill> : null}
      </div>
      {canManage ? <Button size="sm" variant="outline" className="w-fit" onClick={() => setApplying(true)}><UserPlusIcon size={14} /> Apply to an agent</Button> : null}
      {editing ? <BlueprintDialog editing={bp} open onOpenChange={setEditing} /> : null}
      {applying ? <ApplyDialog bp={bp} open onOpenChange={setApplying} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${bp.name}?`}
        body="Agents already created from it keep their settings; you just can't apply it again." confirmLabel="Delete" danger
        onConfirm={async () => { await del.mutateAsync(); }} />
    </div>
  );
}

export function BlueprintsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const { data: blueprints = [], isLoading, error } = useQuery(blueprintsQuery);
  const [creating, setCreating] = useState(0);
  return (
    <Page>
      <PageHeader title="Blueprints"
        description="Reusable role packages — instructions, model, tool scope, SOPs and skills. Define a role once, then stamp it onto any agent so it starts as a trained specialist."
        actions={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New blueprint</Button> : null} />
      {isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-[var(--radius-md)]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !blueprints.length ? (
          <EmptyState icon={BlueprintIcon} title="No blueprints yet"
            body="A blueprint is a job description an agent can wear: its instructions, which model it uses, exactly which tools it may touch, and the SOPs and skills it follows."
            action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> Create first blueprint</Button> : undefined} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {blueprints.map((bp) => <Card key={bp.id} bp={bp} canManage={canManage} />)}
          </div>
        )}
      {creating ? <BlueprintDialog key={creating} open onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
