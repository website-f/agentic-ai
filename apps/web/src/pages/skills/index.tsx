import { LightningIcon, PlusIcon, SealQuestionIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup, Tabs } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { compact, KIND_LABEL, pct, proposalsQuery, skillKeys, skillsQuery, TRUST_LABEL, type Proposal, type Skill } from "@/lib/skills";
import { cn, timeAgo } from "@/lib/utils";

import { SuiteBadge } from "./eval-results";
import { ProposalSheet } from "./proposal-sheet";
import { SkillSheet } from "./skill-sheet";

export const SKILL_TABS = ["library", "proposals", "history"] as const;
export type SkillTab = (typeof SKILL_TABS)[number];
export interface SkillsSearch {
  tab?: SkillTab;
  skill?: string;
  proposal?: string;
}

const STARTER = `## When to use
The situation this procedure is for.

## Steps
1. First step (name the tool to use, e.g. calc)
2. Second step

## Output format
What the finished answer looks like.

## Pitfalls
- What usually goes wrong.
`;

function NewSkill({ open, onOpenChange, canDecide }: { open: boolean; onOpenChange: (o: boolean) => void; canDecide: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(STARTER);
  const create = useMutation({
    mutationFn: () => api<{ skill: unknown; proposal: unknown }>("/api/skills", "POST", { name, description, body }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(r.skill ? "Published. Agents see it from their next step." : "Sent for review.");
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="New skill" className="sm:max-w-2xl"
      description="A procedure agents load when a task matches. Keep it general: no client names, amounts or dates."
      footer={<Button loading={create.isPending} disabled={name.trim().length < 2 || description.trim().length < 10} onClick={() => create.mutate()}>{canDecide ? "Publish" : "Send for review"}</Button>}>
      <div className="grid gap-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. reconcile-bank-statement" autoFocus />
        <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} hint="One sentence: what it does and when to use it. Agents choose by this." />
        <div className="grid gap-1.5">
          <label htmlFor="new-skill-body" className="text-[13px] font-medium">Instructions</label>
          <textarea id="new-skill-body" value={body} onChange={(e) => setBody(e.target.value)} rows={14}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        </div>
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function SkillRow({ s, onOpen }: { s: Skill; onOpen: () => void }) {
  const judged = s.stats.accepted + s.stats.sent_back + s.stats.failed;
  const low = s.stats.success_rate !== null && judged >= 5 && s.stats.success_rate < 0.7;
  return (
    <li>
      <button onClick={onOpen} className="grid w-full gap-2 px-4 py-3 text-left hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-medium">{s.name}</span>
            <Pill tone={s.trust === "trusted" ? "info" : s.trust === "official" ? "accent" : "neutral"}>{TRUST_LABEL[s.trust]}</Pill>
            <span className="text-[12px] text-muted">v{s.version}</span>
            {s.pending ? <Pill tone="warn">{s.pending} to review</Pill> : null}
            {low ? <Pill tone="danger">Often sent back</Pill> : null}
          </span>
          <span className="mt-0.5 block text-[13px] text-muted">{s.description}</span>
        </span>
        <span className="grid grid-cols-3 gap-4 text-[12px] text-muted md:w-80">
          <span><span className="block text-[15px] font-semibold text-fg tabular">{s.stats.uses}</span>uses</span>
          <span><span className="block text-[15px] font-semibold text-fg tabular">{pct(s.stats.success_rate)}</span>accepted</span>
          <span>
            <span className={cn("block text-[15px] font-semibold tabular", s.saved_pct && s.saved_pct > 0 ? "text-ok" : "text-fg")}>
              {s.saved_pct !== null ? `−${pct(s.saved_pct)}` : compact(s.stats.avg_tokens)}
            </span>
            {s.saved_pct !== null ? "tokens" : "tokens/task"}
          </span>
        </span>
      </button>
    </li>
  );
}

function ProposalRow({ p, onOpen }: { p: Proposal; onOpen: () => void }) {
  const blocks = p.scan.filter((f) => f.level === "block").length;
  const warns = p.scan.length - blocks;
  return (
    <li>
      <button onClick={onOpen} className="grid w-full gap-1.5 px-4 py-3 text-left hover:bg-surface-2/60">
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{KIND_LABEL[p.kind]}</Pill>
          <span className="font-mono text-[13.5px] font-medium">{p.name}</span>
          {p.status !== "pending" ? <Pill tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "danger" : "neutral"}>{p.status}</Pill> : null}
          {blocks ? <Pill tone="danger"><ShieldWarningIcon size={12} weight="fill" /> Must fix</Pill> : warns ? <Pill tone="warn">{warns} to check</Pill> : null}
          {p.eval?.new ? <SuiteBadge suite={p.eval.new} label="Tests" /> : null}
          {p.stale ? <Pill tone="warn">Outdated draft</Pill> : null}
        </span>
        <span className="line-clamp-2 text-[13px] text-muted">{p.reason}</span>
        <span className="text-[12px] text-muted">
          {p.proposed_by_name}{p.source_task ? ` · from “${p.source_task.title}”` : ""} · {timeAgo(p.created_at).toLowerCase()}
          {p.decided_by_name ? ` · ${p.status} by ${p.decided_by_name}` : ""}
        </span>
      </button>
    </li>
  );
}

export function SkillsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canDecide = me.permissions.includes("approvals.decide");
  const search = useSearch({ strict: false }) as SkillsSearch;
  const navigate = useNavigate();
  const tab: SkillTab = search.tab && SKILL_TABS.includes(search.tab) ? search.tab : "library";
  const [state, setState] = useState<"active" | "retired">("active");
  const [creating, setCreating] = useState(0);
  const { data: skills, isLoading, error } = useQuery(skillsQuery(state));
  const { data: pending = [] } = useQuery(proposalsQuery("pending"));
  const { data: decided = [] } = useQuery({ ...proposalsQuery("decided"), enabled: tab === "history" });
  const go = (next: SkillsSearch) => navigate({ to: "/skills", search: { tab, ...next }, replace: true });

  return (
    <Page>
      <PageHeader
        title="Skills"
        description="Procedures your agents load when a task matches, so the second time is faster and cheaper. Agents propose new ones from their work; nothing is used until a person approves it."
        actions={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New skill</Button> : null}
      />
      <Tabs.Root value={tab} onValueChange={(v) => navigate({ to: "/skills", search: { tab: v as SkillTab }, replace: true })}>
        <Tabs.List aria-label="Skills sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {SKILL_TABS.map((t) => (
            <Tabs.Trigger key={t} value={t} className="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted capitalize hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
              {t}
              {t === "proposals" && pending.length ? <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-semibold text-white tabular">{pending.length}</span> : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="library" className="grid gap-4 outline-none">
          <RadioGroup.Root value={state} onValueChange={(v) => setState(v as "active" | "retired")} aria-label="Which skills" className="inline-flex w-fit rounded-sm border border-border p-0.5">
            {(["active", "retired"] as const).map((v) => (
              <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-3 py-1 text-[13px] text-muted capitalize data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{v}</RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          {isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" /> : error || !skills ? (
            <p role="alert" className="text-danger">{errorMessage(error)}</p>
          ) : !skills.length ? (
            <EmptyState icon={LightningIcon} title={state === "retired" ? "Nothing retired" : "No skills yet"}
              body={state === "retired" ? "Retired skills land here and can be restored." : "When an agent finishes long or repeated work, it proposes a skill. You can also write one yourself."} />
          ) : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
              {skills.map((s) => <SkillRow key={s.id} s={s} onOpen={() => go({ skill: s.id })} />)}
            </ul>
          )}
        </Tabs.Content>

        <Tabs.Content value="proposals" className="outline-none">
          {pending.length ? (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
              {pending.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
            </ul>
          ) : (
            <EmptyState icon={SealQuestionIcon} title="Nothing to review"
              body="Agents propose a skill after work that took many steps or several rounds of corrections, and the nightly curator proposes merges and retirements. They wait here for you." />
          )}
        </Tabs.Content>

        <Tabs.Content value="history" className="outline-none">
          {decided.length ? (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
              {decided.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
            </ul>
          ) : <p className="text-[13.5px] text-muted">Decisions on proposals appear here.</p>}
        </Tabs.Content>
      </Tabs.Root>

      {search.skill ? <SkillSheet key={search.skill} id={search.skill} canDecide={canDecide} canWrite={canWrite} onClose={() => go({ skill: undefined })} /> : null}
      {search.proposal ? <ProposalSheet key={search.proposal} id={search.proposal} canDecide={canDecide} canWrite={canWrite} onClose={() => go({ proposal: undefined })} /> : null}
      {creating ? <NewSkill key={creating} open canDecide={canDecide} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
