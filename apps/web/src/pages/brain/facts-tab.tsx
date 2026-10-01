import { ArrowCounterClockwiseIcon, LightbulbIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, END_REASON, factScope, factsQuery, type Fact } from "@/lib/brain";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

type State = "active" | "ended" | "all";

function Source({ f }: { f: Fact }) {
  if (f.source_kind === "task" && f.source_id) {
    return <Link to="/tasks" search={{ task: f.source_id }} className="text-accent hover:underline">{f.source_label ?? "a task"}</Link>;
  }
  return <span>{f.source_label ?? f.created_by_name}</span>;
}

function FactRow({ f, canWrite }: { f: Fact; canWrite: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["brain", "facts"] });
    qc.invalidateQueries({ queryKey: brainKeys.overview });
    toast.success(msg);
  };
  const edit = useMutation({
    mutationFn: () => api<Fact>(`/api/brain/facts/${f.id}`, "PATCH", { text: editing }),
    onSuccess: () => { setEditing(null); done("Corrected. The old version is kept under Ended."); },
  });
  const act = useMutation({
    mutationFn: (what: "forget" | "restore") => api<Fact>(`/api/brain/facts/${f.id}/${what}`, "POST"),
    onSuccess: (_r, what) => done(what === "forget" ? "Forgotten. Agents no longer recall it." : "Restored."),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ended = f.valid_to !== null;

  return (
    <li className="grid gap-1.5 px-4 py-3">
      {editing !== null ? (
        <div className="grid gap-2">
          <Input value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Fact" autoFocus />
          <div className="flex gap-2">
            <Button size="sm" loading={edit.isPending} disabled={editing.trim().length < 3 || editing === f.text} onClick={() => edit.mutate()}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
          <FormError message={edit.error ? errorMessage(edit.error) : null} />
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <p className={cn("min-w-0 flex-1 text-[13.5px]", ended && "text-muted line-through decoration-muted/60")}>{f.text}</p>
          {canWrite ? (
            <div className="-mt-1 flex shrink-0 gap-1">
              {!ended ? (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label="Correct this fact" onClick={() => setEditing(f.text)}><PencilSimpleIcon size={14} /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Forget this fact" loading={act.isPending} onClick={() => act.mutate("forget")}><XIcon size={14} /></Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate("restore")}><ArrowCounterClockwiseIcon size={14} /> Restore</Button>
              )}
            </div>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <Pill tone={f.agent_id ? "info" : f.branch_id ? "neutral" : "accent"}>{factScope(f)}</Pill>
        <Source f={f} />
        <span aria-hidden>·</span>
        <span>{timeAgo(f.valid_from)}</span>
        {f.hits ? <><span aria-hidden>·</span><span>recalled {f.hits}×</span></> : null}
        {ended && f.end_reason ? <Pill tone="warn">{END_REASON[f.end_reason]} {timeAgo(f.valid_to).toLowerCase()}</Pill> : null}
      </div>
    </li>
  );
}

function AddFact({ branches }: { branches: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const add = useMutation({
    mutationFn: () => api<Fact>("/api/brain/facts", "POST", { text, branch_id: scope === "all" ? null : scope }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["brain", "facts"] });
      qc.invalidateQueries({ queryKey: brainKeys.overview });
      toast.success("Saved. Agents recall it when it is relevant.");
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) add.mutate(); }} className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Teach the office a fact, e.g. Maju Trading invoices on net-30 terms" aria-label="New fact" className="sm:flex-1" />
        <Select value={scope} onValueChange={setScope} label="Who knows it" className="sm:w-56"
          options={[{ value: "all", label: "Every company" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        <Button type="submit" loading={add.isPending} disabled={text.trim().length < 3}><PlusIcon size={15} weight="bold" /> Add</Button>
      </div>
      <FormError message={add.error ? errorMessage(add.error) : null} />
    </form>
  );
}

export function FactsTab({ canWrite }: { canWrite: boolean }) {
  const { data: branches = [] } = useQuery(branchesQuery);
  const [state, setState] = useState<State>("active");
  const [branch, setBranch] = useState("all");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const params: Record<string, string> = { state, limit: "200" };
  if (branch !== "all") params.branch_id = branch;
  if (query.trim()) params.q = query.trim();
  const { data, isLoading, error } = useQuery(factsQuery(params));

  return (
    <div className="grid gap-4">
      {canWrite ? <AddFact branches={branches} /> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <RadioGroup.Root value={state} onValueChange={(v) => setState(v as State)} aria-label="Which facts" className="inline-flex w-fit rounded-sm border border-border p-0.5">
          {(["active", "ended", "all"] as const).map((v) => (
            <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-3 py-1 text-[13px] text-muted capitalize data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{v}</RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <Select value={branch} onValueChange={setBranch} label="Company" size="sm" className="sm:w-52"
          options={[{ value: "all", label: "All companies" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        <label className="relative block sm:ml-auto sm:w-64">
          <span className="sr-only">Filter facts</span>
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="h-8 pl-8 text-[13px]" />
        </label>
      </div>
      {isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" /> : error || !data ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !data.items.length ? (
        <EmptyState icon={LightbulbIcon} title={state === "ended" ? "Nothing has been replaced or forgotten" : "No facts yet"}
          body={state === "ended" ? "When a fact goes out of date, the old version lands here with the reason, so nothing is silently lost."
            : "Agents pick up facts as they finish tasks and chats: names, terms, prices, preferences. You can add them yourself too."} />
      ) : (
        <>
          <p className="text-[12.5px] text-muted">{data.total} {data.total === 1 ? "fact" : "facts"}</p>
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {data.items.map((f) => <FactRow key={f.id} f={f} canWrite={canWrite} />)}
          </ul>
        </>
      )}
    </div>
  );
}
