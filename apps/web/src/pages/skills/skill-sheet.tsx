import { ArrowCounterClockwiseIcon, ArchiveIcon, FlaskIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { DiffView } from "@/components/diff-view";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { compact, pct, skillKeys, skillQuery, TRUST_LABEL, type SkillDetail } from "@/lib/skills";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

import { EvalResults, SuiteBadge } from "./eval-results";

const OUTCOME = { accepted: { label: "Accepted", tone: "ok" }, sent_back: { label: "Sent back", tone: "warn" }, failed: { label: "Failed", tone: "danger" } } as const;
const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-[19px] font-semibold tabular">{value}</dd>
      {hint ? <dd className="text-[11.5px] text-muted">{hint}</dd> : null}
    </div>
  );
}

function Editor({ s, canDecide, onDone }: { s: SkillDetail; canDecide: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState(s.description);
  const [body, setBody] = useState(s.body);
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api<{ proposal: unknown }>(`/api/skills/${s.id}`, "PATCH", { description, body, note: note || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      toast.success(r.proposal ? "Sent for review." : `Saved as version ${s.version + 1}.`);
      onDone();
    },
  });
  return (
    <div className="grid gap-3">
      <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-1.5">
        <label htmlFor="skill-body" className="text-[13px] font-medium">Instructions</label>
        <textarea id="skill-body" value={body} onChange={(e) => setBody(e.target.value)} rows={20}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
      </div>
      <Field label="What changed" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kept in the version history" />
      <div className="flex gap-2">
        <Button size="sm" loading={save.isPending} disabled={body === s.body && description === s.description} onClick={() => save.mutate()}>
          {canDecide ? "Save new version" : "Send for review"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </div>
  );
}

function Audience({ s, canDecide }: { s: SkillDetail; canDecide: boolean }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const [mode, setMode] = useState(s.agent_ids.length ? "some" : "all");
  const [ids, setIds] = useState<string[]>(s.agent_ids);
  const save = useMutation({
    mutationFn: (next: string[]) => api(`/api/skills/${s.id}`, "PATCH", { agent_ids: next }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: skillKeys.all }); toast.success("Saved."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const names = agents.filter((a) => s.agent_ids.includes(a.id)).map((a) => a.name);
  if (!canDecide) return <p className="text-[13px] text-muted">{s.agent_ids.length ? `Only ${names.join(", ")}` : "Every agent"}{s.branch_id ? ", in one company only" : ""}.</p>;
  return (
    <div className="grid gap-2">
      <RadioGroup.Root value={mode} onValueChange={(v) => { setMode(v); if (v === "all") save.mutate([]); }} className="flex flex-wrap gap-2" aria-label="Who can use it">
        {[["all", "Every agent"], ["some", "Chosen agents"]].map(([v, l]) => (
          <RadioGroup.Item key={v} value={v!} className="rounded-sm border border-border px-3 py-1.5 text-[13px] data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">{l}</RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {mode === "some" ? (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {agents.filter((a) => a.status !== "retired").map((a) => (
              <label key={a.id} className="inline-flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={ids.includes(a.id)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id))} />
                {a.name}
              </label>
            ))}
          </div>
          <Button size="sm" variant="outline" className="w-fit" loading={save.isPending} disabled={!ids.length} onClick={() => save.mutate(ids)}>Save</Button>
        </div>
      ) : null}
      {s.branch_id ? <p className="text-[12.5px] text-muted">Learned in an isolated company, so only its agents see it.</p> : null}
    </div>
  );
}

function Cases({ s, canWrite }: { s: SkillDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", input: "", must: "", mustNot: "" });
  const add = useMutation({
    mutationFn: () => api(`/api/skills/${s.id}/cases`, "POST", { title: form.title, input: form.input, must_contain: list(form.must), must_not_contain: list(form.mustNot) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: skillKeys.detail(s.id) }); setAdding(false); setForm({ title: "", input: "", must: "", mustNot: "" }); },
  });
  const run = useMutation({
    mutationFn: () => api(`/api/skills/${s.id}/evals/run`, "POST"),
    onSuccess: () => toast("Running the tests. Results appear here in a minute."),
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
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><FlaskIcon size={15} /> Tests <span className="font-normal text-muted">{s.eval_cases.length}</span></h3>
        <span className="flex flex-wrap items-center gap-2">
          {s.last_eval ? <SuiteBadge suite={s.last_eval} label={fresh ? "Last run" : `Version ${s.last_eval.version}`} /> : null}
          {canWrite && s.eval_cases.length ? <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>Run tests</Button> : null}
          {canWrite ? <Button size="sm" variant="ghost" onClick={() => setAdding(!adding)}><PlusIcon size={14} /> Add</Button> : null}
        </span>
      </div>
      <p className="text-[12.5px] text-muted">A request plus words a correct answer must (or must not) contain. Proposed changes are tested against these before review.</p>
      {adding ? (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
          <Field label="Name" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Two quotes, one cheaper" />
          <div className="grid gap-1.5">
            <label htmlFor="case-input" className="text-[13px] font-medium">Request</label>
            <textarea id="case-input" value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })} rows={3}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          </div>
          <Field label="Must contain (comma separated)" value={form.must} onChange={(e) => setForm({ ...form, must: e.target.value })} placeholder="recommend, total" />
          <Field label="Must not contain" value={form.mustNot} onChange={(e) => setForm({ ...form, mustNot: e.target.value })} />
          <Button type="submit" size="sm" className="w-fit" loading={add.isPending} disabled={!form.title || !form.input || !(form.must || form.mustNot)}>Add test</Button>
          <FormError message={add.error ? errorMessage(add.error) : null} />
        </form>
      ) : null}
      {s.eval_cases.length ? (
        <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
          {s.eval_cases.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{c.title}</p>
                <p className="truncate text-[12.5px] text-muted">{c.input}</p>
                {c.checks.must_contain?.length ? <p className="text-[12px] text-muted">Must contain: {c.checks.must_contain.join(", ")}</p> : null}
              </div>
              {canWrite ? <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.title}`} onClick={() => remove(c.id)}><TrashIcon size={14} /></Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {s.last_eval ? <EvalResults suite={s.last_eval} /> : null}
    </section>
  );
}

export function SkillSheet({ id, canDecide, canWrite, onClose }: { id: string; canDecide: boolean; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery(skillQuery(id));
  const [editing, setEditing] = useState(false);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const setStatus = useMutation({
    mutationFn: (status: "active" | "retired") => api(`/api/skills/${id}`, "PATCH", { status }),
    onSuccess: (_r, st) => { qc.invalidateQueries({ queryKey: skillKeys.all }); toast.success(st === "retired" ? "Retired. Agents no longer see it." : "Restored."); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={s ? <span className="font-mono">{s.name}</span> : "Skill"}
      description={s ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={s.trust === "trusted" ? "info" : s.trust === "official" ? "accent" : "neutral"}>{TRUST_LABEL[s.trust]}</Pill>
          <span>version {s.version}</span>
          {s.status === "retired" ? <Pill tone="warn">Retired</Pill> : null}
          {s.pending ? <Pill tone="warn">{s.pending} waiting for review</Pill> : null}
        </span>
      ) : null}
      actions={s && !editing ? (
        <>
          {canWrite ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PencilSimpleIcon size={14} /> {canDecide ? "Edit" : "Suggest a change"}</Button> : null}
          {canDecide ? (s.status === "active"
            ? <Button size="sm" variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate("retired")}><ArchiveIcon size={14} /> Retire</Button>
            : <Button size="sm" variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate("active")}><ArrowCounterClockwiseIcon size={14} /> Restore</Button>) : null}
        </>
      ) : null}
    >
      {isLoading ? <Skeleton className="h-96 rounded-[var(--radius-md)]" /> : error || !s ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : editing ? (
        <Editor s={s} canDecide={canDecide} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          <p className="text-[13.5px]">{s.description}</p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Uses" value={String(s.stats.uses)} hint={s.last_used_at ? `last ${timeAgo(s.last_used_at).toLowerCase()}` : "not used yet"} />
            <Stat label="Accepted" value={pct(s.stats.success_rate)} hint={`${s.stats.accepted} of ${s.stats.accepted + s.stats.sent_back + s.stats.failed} judged`} />
            <Stat label="Tokens per task" value={compact(s.stats.avg_tokens)} hint={s.baseline_tokens ? `${compact(s.baseline_tokens)} before the skill` : undefined} />
            <Stat label="Saved" value={s.saved_pct !== null ? pct(s.saved_pct) : "–"} hint={s.saved_pct !== null ? "fewer tokens than the task it came from" : "measured after first use"} />
          </dl>

          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Instructions</h3>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4"><Markdown>{s.body}</Markdown></div>
          </section>

          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Who can use it</h3>
            <Audience key={s.agent_ids.join(",")} s={s} canDecide={canDecide} />
          </section>

          <Cases s={s} canWrite={canWrite} />

          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Versions</h3>
            <ol className="grid gap-1">
              {s.versions.map((v, i) => {
                const prev = s.versions[i + 1];
                const open = openVersion === v.version;
                return (
                  <li key={v.version} className="rounded-sm border border-border bg-surface">
                    <button onClick={() => setOpenVersion(open ? null : v.version)} disabled={!prev} className={cn("flex w-full items-start gap-3 px-3 py-2 text-left", prev && "hover:bg-surface-2/60")}>
                      <span className="font-mono text-[12.5px] font-medium">v{v.version}</span>
                      <span className="min-w-0 flex-1 text-[12.5px]">
                        <span className="block truncate">{v.note ?? "—"}</span>
                        <span className="block text-muted">{v.created_by_name}{v.approved_by_name ? `, approved by ${v.approved_by_name}` : ""} · {timeAgo(v.created_at).toLowerCase()}</span>
                      </span>
                      {prev ? <span className="text-[12px] text-accent">{open ? "Hide" : "Diff"}</span> : null}
                    </button>
                    {open && prev ? <div className="border-t border-border p-3"><DiffView before={prev.body} after={v.body} labels={[`v${prev.version}`, `v${v.version}`]} /></div> : null}
                  </li>
                );
              })}
            </ol>
          </section>

          {s.uses.length ? (
            <section className="grid gap-2">
              <h3 className="text-[13.5px] font-semibold">Recent uses</h3>
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
                {s.uses.map((u, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12.5px]">
                    <span className="font-medium">{u.agent_name}</span>
                    {u.task_id ? <Link to="/tasks" search={{ task: u.task_id }} className="min-w-0 truncate text-accent hover:underline">{u.task_title ?? "a task"}</Link> : <span className="text-muted">chat</span>}
                    <span className="ml-auto flex items-center gap-2 text-muted">
                      {u.outcome ? <Pill tone={OUTCOME[u.outcome as keyof typeof OUTCOME].tone}>{OUTCOME[u.outcome as keyof typeof OUTCOME].label}</Pill> : <Pill>Open</Pill>}
                      {u.tokens ? <span className="tabular">{compact(u.tokens)} tokens</span> : null}
                      <span>v{u.version}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}
