import {
  ArrowCounterClockwiseIcon, ArchiveIcon, ChartLineUpIcon, CheckCircleIcon, ClockCounterClockwiseIcon, CoinsIcon, FlaskIcon,
  GitCommitIcon, ListChecksIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TrashIcon, TrendDownIcon, UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { DiffView } from "@/components/diff-view";
import { Markdown } from "@/components/markdown";
import { IconTile, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { msg, t as tr, useLang, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { learningKeys, revertSkill } from "@/lib/learning";
import { compact, pct, skillKeys, skillQuery, TRUST_LABEL, type SkillDetail } from "@/lib/skills";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

import { EvalResults, SuiteBadge } from "./eval-results";

const OUTCOME = { accepted: { label: msg("Accepted"), tone: "ok" }, sent_back: { label: msg("Sent back"), tone: "warn" }, failed: { label: msg("Failed"), tone: "danger" } } as const;
const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** A titled block inside the sheet, with a small icon tile so sections scan quickly. */
function Block({ icon, tone = "neutral", title, count, actions, children }: {
  icon: typeof FlaskIcon;
  tone?: Tone;
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <IconTile icon={icon} tone={tone} size="sm" /> {title}
          {count !== undefined ? <span className="font-normal text-muted tabular">{count}</span> : null}
        </h3>
        {actions ? <span className="flex flex-wrap items-center gap-2">{actions}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Editor({ s, canDecide, onDone }: { s: SkillDetail; canDecide: boolean; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [description, setDescription] = useState(s.description);
  const [body, setBody] = useState(s.body);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api<{ proposal: unknown }>(`/api/skills/${s.id}`, "PATCH", { description, body, note: note || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success(r.proposal ? tr("Sent for review.") : tr("Saved as version {n}.", { n: s.version + 1 }));
      onDone();
    },
  });
  return (
    <div className="grid gap-3">
      <Field label={t("Description")} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-1.5">
        <label htmlFor="skill-body" className="text-[13px] font-medium">{t("Instructions")}</label>
        <textarea id="skill-body" value={body} onChange={(e) => setBody(e.target.value)} rows={20}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
      </div>
      <Field label={t("What changed")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Kept in the version history")} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={save.isPending} disabled={body === s.body && description === s.description} onClick={() => save.mutate()}>
          {canDecide ? t("Save new version") : t("Send for review")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
      </div>
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </div>
  );
}

function Audience({ s, canDecide }: { s: SkillDetail; canDecide: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const [mode, setMode] = useState(s.agent_ids.length ? "some" : "all");
  const [ids, setIds] = useState<string[]>(s.agent_ids);
  const save = useMutation({
    mutationFn: (next: string[]) => api(`/api/skills/${s.id}`, "PATCH", { agent_ids: next }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: skillKeys.all }); toast.success(tr("Saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const names = agents.filter((a) => s.agent_ids.includes(a.id)).map((a) => a.name);
  if (!canDecide) {
    const who = s.agent_ids.length
      ? (s.branch_id ? t("Only {names}, in one company only.", { names: names.join(", ") }) : t("Only {names}.", { names: names.join(", ") }))
      : (s.branch_id ? t("Every agent, in one company only.") : t("Every agent."));
    return <p className="text-[13px] text-muted">{who}</p>;
  }
  return (
    <div className="grid gap-2">
      <RadioGroup.Root value={mode} onValueChange={(v) => { setMode(v); if (v === "all") save.mutate([]); }} className="flex flex-wrap gap-2" aria-label={t("Who can use it")}>
        {[["all", t("Every agent")], ["some", t("Chosen agents")]].map(([v, l]) => (
          <RadioGroup.Item key={v} value={v!} className="min-h-9 rounded-sm border border-border px-3 py-1.5 text-[13px] transition-colors hover:bg-surface-2/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50 data-[state=checked]:font-medium">{l}</RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {mode === "some" ? (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {agents.filter((a) => a.status !== "retired" && !a.view_only).map((a) => (
              <label key={a.id} className="inline-flex min-h-9 items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={ids.includes(a.id)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id))} />
                {a.name}
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" className="w-fit" loading={save.isPending} disabled={!ids.length} onClick={() => save.mutate(ids)}>{t("Save")}</Button>
        </div>
      ) : null}
      {s.branch_id ? <p className="text-[12.5px] text-muted">{t("Learned in an isolated company, so only its agents see it.")}</p> : null}
    </div>
  );
}

function Cases({ s, canWrite }: { s: SkillDetail; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", input: "", must: "", mustNot: "" });
  const add = useMutation({
    mutationFn: () => api(`/api/skills/${s.id}/cases`, "POST", { title: form.title, input: form.input, must_contain: list(form.must), must_not_contain: list(form.mustNot) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: skillKeys.detail(s.id) }); setAdding(false); setForm({ title: "", input: "", must: "", mustNot: "" }); },
  });
  const run = useMutation({
    mutationFn: () => api(`/api/skills/${s.id}/evals/run`, "POST"),
    onSuccess: () => toast(tr("Running the tests. Results appear here in a minute.")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const improve = useMutation({
    mutationFn: () => api(`/api/skills/${s.id}/optimize`, "POST"),
    onSuccess: () => toast(tr("Improving this skill: rewriting it from its tests and testing each try. If a better version passes more tests, it shows up under Proposals (or goes live, per your autopilot setting).")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async (id: string) => {
    try {
      await api(`/api/skills/${s.id}/cases/${id}`, "DELETE");
      qc.invalidateQueries({ queryKey: skillKeys.detail(s.id) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const fresh = s.last_eval && s.last_eval.version === s.version;
  return (
    <Block icon={FlaskIcon} tone="info" title={t("Tests")} count={s.eval_cases.length} actions={(
      <>
        {s.last_eval ? <SuiteBadge suite={s.last_eval} label={fresh ? t("Last run") : t("Version {n}", { n: s.last_eval.version ?? "" })} /> : null}
        {canWrite && s.eval_cases.length ? <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>{t("Run tests")}</Button> : null}
        {canWrite && s.status === "active" ? <Button size="sm" variant="outline" loading={improve.isPending} onClick={() => improve.mutate()} title={t("Rewrite from failing tests, test each version, keep the best")}><SparkleIcon size={14} /> {t("Improve with AI")}</Button> : null}
        {canWrite ? <Button size="sm" variant="ghost" onClick={() => setAdding(!adding)}><PlusIcon size={14} /> {t("Add")}</Button> : null}
      </>
    )}>
      <p className="text-[12.5px] text-muted">{t("A request plus words a correct answer must (or must not) contain. Proposed changes are tested against these before review.")}</p>
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
          <Field label={t("Name")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("e.g. Two quotes, one cheaper")} />
          <div className="grid gap-1.5">
            <label htmlFor="case-input" className="text-[13px] font-medium">{t("Request")}</label>
            <textarea id="case-input" value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })} rows={3}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          </div>
          <Field label={t("Must contain (comma separated)")} value={form.must} onChange={(e) => setForm({ ...form, must: e.target.value })} placeholder={t("recommend, total")} />
          <Field label={t("Must not contain")} value={form.mustNot} onChange={(e) => setForm({ ...form, mustNot: e.target.value })} />
          <Button type="submit" size="sm" className="w-fit" loading={add.isPending} disabled={!form.title || !form.input || !(form.must || form.mustNot)}>{t("Add test")}</Button>
          <FormError message={add.error ? errorMessage(add.error) : null} />
        </form>
      ) : null}
      {s.eval_cases.length ? (
        <ListCard>
          {s.eval_cases.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium break-words">{c.title}</p>
                <p className="line-clamp-2 text-[12.5px] break-words text-muted">{c.input}</p>
                {c.checks.must_contain?.length ? <p className="text-[12px] text-muted">{t("Must contain: {list}", { list: c.checks.must_contain.join(", ") })}</p> : null}
              </div>
              {canWrite ? <Button size="icon-sm" variant="ghost" aria-label={t("Delete {name}", { name: c.title })} onClick={() => remove(c.id)}><TrashIcon size={14} /></Button> : null}
            </li>
          ))}
        </ListCard>
      ) : null}
      {s.last_eval ? <EvalResults suite={s.last_eval} /> : null}
    </Block>
  );
}

export function SkillSheet({ id, canDecide, canWrite, onClose }: { id: string; canDecide: boolean; canWrite: boolean; onClose: () => void }) {
  const t = useT();
  // "Open" and "Saved" have other meanings elsewhere (Buka, Disimpan); here they need their own Malay words.
  const lang = useLang((st) => st.lang);
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery(skillQuery(id));
  const [editing, setEditing] = useState(false);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const restore = async (version: number) => {
    try {
      const r = await revertSkill(id, version);
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.invalidateQueries({ queryKey: learningKeys.all });
      toast.success(tr("Version {n} is live again (saved as version {saved}). Agents use it from their next step.", { n: version, saved: r.version }));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const setStatus = useMutation({
    mutationFn: (status: "active" | "retired") => api(`/api/skills/${id}`, "PATCH", { status }),
    onSuccess: (_r, st) => { qc.invalidateQueries({ queryKey: skillKeys.all }); toast.success(st === "retired" ? tr("Retired. Agents no longer see it.") : tr("Restored.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={s ? <span className="font-mono break-all">{s.name}</span> : t("Skill")}
      description={s ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={s.trust === "trusted" ? "info" : s.trust === "official" ? "accent" : "neutral"}>{t(TRUST_LABEL[s.trust])}</Pill>
          <span>{t("version {n}", { n: s.version })}</span>
          {s.status === "retired" ? <Pill tone="warn">{t("Retired")}</Pill> : null}
          {s.pending ? <Pill tone="warn">{t("{n} waiting for review", { n: s.pending })}</Pill> : null}
        </span>
      ) : null}
      actions={s && !editing ? (
        <>
          {canWrite ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PencilSimpleIcon size={14} /> {canDecide ? t("Edit") : t("Suggest a change")}</Button> : null}
          {canDecide ? (s.status === "active"
            ? <Button size="sm" variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate("retired")}><ArchiveIcon size={14} /> {t("Retire")}</Button>
            : <Button size="sm" variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate("active")}><ArrowCounterClockwiseIcon size={14} /> {t("Restore")}</Button>) : null}
        </>
      ) : null}
    >
      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-5 w-3/4" />
          <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
          <Skeleton className="h-56 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !s ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : editing ? (
        <Editor s={s} canDecide={canDecide} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <p className="text-[13.5px] break-words">{s.description}</p>
          <StatGrid className="lg:grid-cols-2">
            <Stat label={t("Uses")} value={String(s.stats.uses)} icon={ChartLineUpIcon} tone="info" hint={s.last_used_at ? t("last {when}", { when: timeAgo(s.last_used_at).toLowerCase() }) : t("not used yet")} />
            <Stat label={t("Accepted")} value={pct(s.stats.success_rate)} icon={CheckCircleIcon} tone="ok" hint={t("{n} of {total} judged", { n: s.stats.accepted, total: s.stats.accepted + s.stats.sent_back + s.stats.failed })} />
            <Stat label={t("Tokens per task")} value={compact(s.stats.avg_tokens)} icon={CoinsIcon} tone="orange" hint={s.baseline_tokens ? t("{n} before the skill", { n: compact(s.baseline_tokens) }) : undefined} />
            <Stat label={lang === "ms" ? t("Saved (tokens saved)") : "Saved"} value={s.saved_pct !== null ? pct(s.saved_pct) : "–"} icon={TrendDownIcon} tone="accent" hint={s.saved_pct !== null ? t("fewer tokens than the task it came from") : t("measured after first use")} />
          </StatGrid>

          <Block icon={ListChecksIcon} tone="accent" title={t("Instructions")}>
            <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5 sm:px-5"><Markdown>{s.body}</Markdown></div>
          </Block>

          <Block icon={UsersThreeIcon} tone="violet" title={t("Who can use it")}>
            <Audience key={s.agent_ids.join(",")} s={s} canDecide={canDecide} />
          </Block>

          <Cases s={s} canWrite={canWrite} />

          <Block icon={GitCommitIcon} title={t("Versions")} count={s.versions.length}>
            <ol className="grid gap-1.5">
              {s.versions.map((v, i) => {
                const prev = s.versions[i + 1];
                const open = openVersion === v.version;
                return (
                  <li key={v.version} className="min-w-0 overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface">
                    <div className="flex items-start">
                      <button type="button" onClick={() => setOpenVersion(open ? null : v.version)} disabled={!prev} aria-expanded={prev ? open : undefined}
                        className={cn("flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left", prev && "hover:bg-surface-2/60")}>
                        <span className="rounded-full bg-surface-2 px-2 font-mono text-[12px] font-medium">v{v.version}</span>
                        <span className="min-w-0 flex-1 text-[12.5px]">
                          <span className="block break-words">{v.note ?? "—"}</span>
                          <span className="block text-muted">{v.approved_by_name ? t("{name}, approved by {approver}", { name: v.created_by_name, approver: v.approved_by_name }) : v.created_by_name} · {timeAgo(v.created_at).toLowerCase()}</span>
                        </span>
                        {v.version === s.version ? <Pill tone="ok" className="shrink-0 px-2 text-[11px] leading-[18px]">{t("Live")}</Pill>
                          : prev ? <span className="shrink-0 text-[12px] font-medium text-accent">{open ? t("Hide") : t("Diff")}</span> : null}
                      </button>
                      {canDecide && v.version !== s.version ? (
                        <Button size="sm" variant="ghost" className="my-1.5 mr-1.5 shrink-0 px-2.5" aria-label={t("Restore version {n}", { n: v.version })} onClick={() => setRestoring(v.version)}>
                          <ArrowCounterClockwiseIcon size={14} /> {t("Restore")}<span className="max-sm:hidden">&nbsp;{t("this version")}</span>
                        </Button>
                      ) : null}
                    </div>
                    {open && prev ? <div className="min-w-0 border-t border-border p-3"><DiffView before={prev.body} after={v.body} labels={[`v${prev.version}`, `v${v.version}`]} /></div> : null}
                  </li>
                );
              })}
            </ol>
          </Block>

          {s.uses.length ? (
            <Block icon={ClockCounterClockwiseIcon} title={t("Recent uses")} count={s.uses.length}>
              <ListCard>
                {s.uses.map((u, i) => (
                  <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[12.5px]">
                    <span className="font-medium">{u.agent_name}</span>
                    {u.task_id ? <Link to="/tasks" search={{ task: u.task_id }} className="min-w-0 flex-1 basis-32 truncate text-accent hover:underline">{u.task_title ?? t("a task")}</Link> : <span className="flex-1 text-muted">{t("chat")}</span>}
                    <span className="flex items-center gap-2 text-muted">
                      {u.outcome ? <Pill tone={OUTCOME[u.outcome as keyof typeof OUTCOME].tone}>{t(OUTCOME[u.outcome as keyof typeof OUTCOME].label)}</Pill> : <Pill>{lang === "ms" ? t("Open (no outcome yet)") : "Open"}</Pill>}
                      {u.tokens ? <span className="tabular">{t("{n} tokens", { n: compact(u.tokens) })}</span> : null}
                      <span>v{u.version}</span>
                    </span>
                  </li>
                ))}
              </ListCard>
            </Block>
          ) : null}
        </div>
      )}
      {restoring !== null && s ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRestoring(null)}
          title={t("Restore version {n}?", { n: restoring })}
          body={t("Its text goes live again as version {next}, and agents use it from their next step. Version {current} stays in the history, so you can switch back at any time.", { next: s.version + 1, current: s.version })}
          confirmLabel={t("Restore this version")}
          onConfirm={() => restore(restoring)}
        />
      ) : null}
    </SideSheet>
  );
}
