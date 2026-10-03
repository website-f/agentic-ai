import {
  ArchiveIcon, ArrowsMergeIcon, ChartLineUpIcon, CheckCircleIcon, ClockCounterClockwiseIcon, LightningIcon, PencilSimpleIcon, PlusIcon,
  SealQuestionIcon, ShieldWarningIcon, SparkleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta, Toolbar } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { compact, KIND_LABEL, pct, proposalsQuery, skillKeys, skillsQuery, TRUST_LABEL, type Proposal, type ProposalKind, type Skill } from "@/lib/skills";
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

const TAB_LABEL: Record<SkillTab, string> = { library: "Library", proposals: "Proposals", history: "History" };
const TRUST_TONE = { trusted: "info", official: "accent", builtin: "neutral" } as const;
const KIND_LOOK: Record<ProposalKind, { icon: typeof LightningIcon; tone: Tone }> = {
  new: { icon: SparkleIcon, tone: "accent" },
  patch: { icon: PencilSimpleIcon, tone: "info" },
  merge: { icon: ArrowsMergeIcon, tone: "violet" },
  retire: { icon: ArchiveIcon, tone: "neutral" },
};

function ListSkeleton() {
  return (
    <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-none" />)}
    </div>
  );
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
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-x-6">
        <IconTile icon={LightningIcon} tone={s.status === "retired" ? "neutral" : low ? "danger" : "accent"} size="sm" className="md:size-10" />
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-mono text-[13.5px] font-medium break-all">{s.name}</span>
            <Pill tone={TRUST_TONE[s.trust]}>{TRUST_LABEL[s.trust]}</Pill>
            <span className="text-[12px] text-muted tabular">v{s.version}</span>
            {s.pending ? <Pill tone="warn">{s.pending} to review</Pill> : null}
            {low ? <Pill tone="danger">Often sent back</Pill> : null}
          </span>
          <span className="line-clamp-2 text-[13px] break-words text-muted">{s.description}</span>
        </span>
        <span className="col-span-2 grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] bg-surface-2/60 px-3 py-2 text-[11.5px] text-muted md:col-span-1 md:w-72 md:bg-transparent md:p-0">
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
  const look = KIND_LOOK[p.kind];
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60">
        <IconTile icon={look.icon} tone={look.tone} size="sm" />
        <span className="grid min-w-0 gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-mono text-[13.5px] font-medium break-all">{p.name}</span>
            <Pill tone="accent">{KIND_LABEL[p.kind]}</Pill>
            {p.status !== "pending" ? <Pill tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "danger" : "neutral"}>{p.status}</Pill> : null}
            {blocks ? <Pill tone="danger"><ShieldWarningIcon size={12} weight="fill" /> Must fix</Pill> : warns ? <Pill tone="warn">{warns} to check</Pill> : null}
            {p.eval?.new ? <SuiteBadge suite={p.eval.new} label="Tests" /> : null}
            {p.stale ? <Pill tone="warn">Outdated draft</Pill> : null}
          </span>
          {p.reason ? <span className="line-clamp-2 text-[13px] break-words text-muted">{p.reason}</span> : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
            <Meta items={[
              p.proposed_by_name,
              p.source_task ? <span key="t" className="break-words">from “{p.source_task.title}”</span> : null,
              timeAgo(p.created_at).toLowerCase(),
              p.decided_by_name ? `${p.status} by ${p.decided_by_name}` : null,
            ]} />
          </span>
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
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (skills ?? []).filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle));
  }, [skills, q]);
  const totals = useMemo(() => {
    const list = skills ?? [];
    const accepted = list.reduce((n, s) => n + s.stats.accepted, 0);
    const judged = list.reduce((n, s) => n + s.stats.accepted + s.stats.sent_back + s.stats.failed, 0);
    return { uses: list.reduce((n, s) => n + s.stats.uses, 0), rate: judged ? accepted / judged : null, judged };
  }, [skills]);

  return (
    <Page>
      <PageHeader
        title="Skills"
        description="Procedures your agents load when a task matches, so the second time is faster and cheaper. Agents propose new ones from their work; nothing is used until a person approves it."
        actions={canWrite ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> New skill</Button> : null}
      />
      {skills && state === "active" ? (
        <StatGrid>
          <Stat label="Active skills" value={skills.length} icon={LightningIcon} tone="accent" hint="Agents load these when a task matches" onClick={() => go({ tab: "library" })} active={tab === "library"} />
          <Stat label="To review" value={pending.length} icon={SealQuestionIcon} tone={pending.length ? "warn" : "neutral"}
            hint={pending.length ? "Waiting for a person" : "All caught up"} onClick={() => go({ tab: "proposals" })} active={tab === "proposals"} />
          <Stat label="Uses" value={totals.uses} icon={ChartLineUpIcon} tone="info" hint="Across all active skills" />
          <Stat label="Accepted" value={pct(totals.rate)} icon={CheckCircleIcon} tone="ok" hint={totals.judged ? `${totals.judged} results judged` : "Nothing judged yet"} />
        </StatGrid>
      ) : null}

      <Segmented<SkillTab> label="Skills sections" value={tab} onChange={(v) => navigate({ to: "/skills", search: { tab: v }, replace: true })} className="w-fit"
        options={SKILL_TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: t === "proposals" ? pending.length : t === "library" ? skills?.length : undefined }))} />

      <div role="tabpanel" aria-label={TAB_LABEL[tab]} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {tab === "library" ? (
          <>
            <Toolbar>
              <Segmented<"active" | "retired"> label="Which skills" size="sm" value={state} onChange={setState}
                options={[{ value: "active", label: "Active" }, { value: "retired", label: "Retired" }]} />
              <SearchInput value={q} onChange={setQ} placeholder="Search skills" className="sm:ml-auto sm:max-w-72" />
            </Toolbar>
            {isLoading ? <ListSkeleton /> : error || !skills ? (
              <p role="alert" className="text-danger">{errorMessage(error)}</p>
            ) : !skills.length ? (
              <EmptyState icon={LightningIcon} title={state === "retired" ? "Nothing retired" : "No skills yet"}
                body={state === "retired" ? "Retired skills land here and can be restored." : "When an agent finishes long or repeated work, it proposes a skill. You can also write one yourself."} />
            ) : !shown.length ? (
              <EmptyState icon={LightningIcon} title="No skill matches" body="Try another word." />
            ) : (
              <ListCard>
                {shown.map((s) => <SkillRow key={s.id} s={s} onOpen={() => go({ skill: s.id })} />)}
              </ListCard>
            )}
          </>
        ) : tab === "proposals" ? (
          pending.length ? (
            <ListCard>
              {pending.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
            </ListCard>
          ) : (
            <EmptyState icon={SealQuestionIcon} title="Nothing to review"
              body="Agents propose a skill after work that took many steps or several rounds of corrections, and the nightly curator proposes merges and retirements. They wait here for you." />
          )
        ) : decided.length ? (
          <ListCard>
            {decided.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
          </ListCard>
        ) : (
          <EmptyState icon={ClockCounterClockwiseIcon} title="No decisions yet" body="Decisions on proposals appear here." />
        )}
      </div>

      {search.skill ? <SkillSheet key={search.skill} id={search.skill} canDecide={canDecide} canWrite={canWrite} onClose={() => go({ skill: undefined })} /> : null}
      {search.proposal ? <ProposalSheet key={search.proposal} id={search.proposal} canDecide={canDecide} canWrite={canWrite} onClose={() => go({ proposal: undefined })} /> : null}
      {creating ? <NewSkill key={creating} open canDecide={canDecide} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
