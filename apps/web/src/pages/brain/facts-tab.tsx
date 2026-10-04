import { ArrowCounterClockwiseIcon, LightbulbIcon, PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta, Toolbar } from "@/components/ui/card";
import { FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, END_REASON, factScope, type Fact } from "@/lib/brain";
import { useDebounced, usePagedList } from "@/lib/paged";
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
    <li className="grid min-w-0 gap-2 px-4 py-3">
      {editing !== null ? (
        <div className="grid gap-2">
          <Input value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Fact" autoFocus />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={edit.isPending} disabled={editing.trim().length < 3 || editing === f.text} onClick={() => edit.mutate()}>Save correction</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
          <FormError message={edit.error ? errorMessage(edit.error) : null} />
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <IconTile icon={LightbulbIcon} size="sm" tone={ended ? "neutral" : "warn"} className="max-sm:hidden" />
          <p className={cn("min-w-0 flex-1 pt-1 text-[13.5px] break-words sm:pt-1.5", ended && "text-muted line-through decoration-muted/60")}>{f.text}</p>
          {canWrite ? (
            <div className="flex shrink-0 gap-1">
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted sm:pl-11">
        <Pill tone={f.agent_id ? "info" : f.branch_id ? "neutral" : "accent"}>{factScope(f)}</Pill>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <Meta items={[<Source key="s" f={f} />, timeAgo(f.valid_from), f.hits ? `recalled ${f.hits}×` : null]} />
        </span>
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
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) add.mutate(); }} className="grid gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] sm:p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium"><PlusIcon size={14} weight="bold" className="text-accent" /> Teach the office a fact</p>
      <div className="flex flex-col gap-2 md:flex-row">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Maju Trading invoices on net-30 terms" aria-label="New fact" className="min-w-0 md:flex-1" />
        <Select value={scope} onValueChange={setScope} label="Who knows it" className="md:w-56"
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
  const query = useDebounced(q.trim());
  // Filters and search run on the server; facts load 50 at a time as you scroll.
  const list = usePagedList<Fact>(["brain", "facts"], "/api/brain/facts",
    { state, branch_id: branch !== "all" ? branch : undefined, q: query || undefined },
    { pick: (b) => (b as { items: Fact[] }).items });
  const { isLoading, error } = list;
  const data = list.query.data ? { total: list.total ?? list.items.length, items: list.items } : undefined;

  return (
    <div className="grid gap-4">
      {canWrite ? <AddFact branches={branches} /> : null}
      <Toolbar>
        <Segmented<State> label="Which facts" value={state} onChange={setState}
          options={[{ value: "active", label: "Active" }, { value: "ended", label: "Ended" }, { value: "all", label: "All" }]} />
        <Select value={branch} onValueChange={setBranch} label="Company" className="sm:w-52"
          options={[{ value: "all", label: "All companies" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        <SearchInput value={q} onChange={setQ} placeholder="Filter facts" className="sm:ml-auto sm:max-w-72" />
      </Toolbar>
      {isLoading ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-none" />)}
        </div>
      ) : error || !data ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !data.items.length ? (
        <EmptyState icon={LightbulbIcon} title={state === "ended" ? "Nothing has been replaced or forgotten" : "No facts yet"}
          body={state === "ended" ? "When a fact goes out of date, the old version lands here with the reason, so nothing is silently lost."
            : "Agents pick up facts as they finish tasks and chats: names, terms, prices, preferences. You can add them yourself too."} />
      ) : (
        <>
          <p className="-mb-1 text-[12.5px] text-muted tabular">{data.total} {data.total === 1 ? "fact" : "facts"}</p>
          <ListCard>
            {data.items.map((f) => <FactRow key={f.id} f={f} canWrite={canWrite} />)}
          </ListCard>
          <LoadMore noun="facts" shown={data.items.length} total={data.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} />
        </>
      )}
    </div>
  );
}
