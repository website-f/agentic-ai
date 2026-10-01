import { ArrowCounterClockwiseIcon, MoonStarsIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, dreamQuery, dreamsQuery, type Dream, type DreamChange } from "@/lib/brain";
import { cn } from "@/lib/utils";

import { stripFrontmatter } from "./wiki-markdown";

const STATUS_TONE = { running: "info", done: "ok", failed: "danger" } as const;

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function counts(d: Dream) {
  const by = (k: DreamChange["kind"]) => d.changes.filter((c) => c.kind === k).length;
  return { merged: by("merge"), settled: by("contradiction"), imported: by("import"), conflicts: by("conflict") };
}

function ChangeRow({ dream, change, index, canManage }: { dream: Dream; change: DreamChange; index: number; canManage: boolean }) {
  const qc = useQueryClient();
  const undo = useMutation({
    mutationFn: () => api<Dream>(`/api/brain/dreams/${dream.id}/undo/${index}`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainKeys.dreams });
      qc.invalidateQueries({ queryKey: ["brain", "facts"] });
      toast.success("Undone. The fact is active again.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fact = change.kind === "merge" || change.kind === "contradiction";
  if (change.kind === "skill") {
    const text = {
      merge: `Proposed merging ${change.other} into ${change.name}`,
      retire: `Proposed retiring ${change.name} (unused for ${change.days} days)`,
      flag: `${change.name} was accepted only ${Math.round((change.success_rate ?? 0) * 100)}% of the last ${change.uses} times`,
      vault_edit: `${change.name} was edited in the vault; waiting for review`,
    }[change.action ?? "merge"];
    return (
      <li className="grid gap-1 px-4 py-3">
        <p className="text-[13px]">{text}</p>
        <p className="text-[12px] text-muted">Skill curator · review in <a href="/skills?tab=proposals" className="text-accent hover:underline">Skills &gt; Proposals</a></p>
      </li>
    );
  }
  return (
    <li className="grid gap-1 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 text-[13px]">
          {fact ? (
            <>
              <p className={cn("text-muted", !change.undone && "line-through decoration-muted/60")}>{change.ended_text}</p>
              <p>{change.kind === "merge" ? "Kept: " : "Now: "}{change.kept_text}</p>
            </>
          ) : (
            <p className="font-mono text-[12.5px]">{change.path}</p>
          )}
        </div>
        {fact && canManage ? (
          change.undone ? <Pill>Undone</Pill> : (
            <Button size="sm" variant="ghost" loading={undo.isPending} onClick={() => undo.mutate()}><ArrowCounterClockwiseIcon size={14} /> Undo</Button>
          )
        ) : null}
      </div>
      <p className="text-[12px] text-muted">
        {change.kind === "merge" ? "Duplicate merged" : change.kind === "contradiction" ? "Contradiction settled (newer fact wins)" : change.kind === "import" ? "Edited in the vault, imported" : "Edited in two places; the dashboard copy was kept"}
        {change.similarity ? ` · ${Math.round(change.similarity * 100)}% similar` : ""}
      </p>
    </li>
  );
}

function DreamDetail({ id, canManage }: { id: string; canManage: boolean }) {
  const { data: d, isLoading, error } = useQuery(dreamQuery(id));
  if (isLoading) return <Skeleton className="h-72 rounded-[var(--radius-md)]" />;
  if (error || !d) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const c = counts(d);
  const stats = [
    { label: "Facts learned", value: d.stats.facts_learned ?? 0 },
    { label: "Duplicates merged", value: c.merged },
    { label: "Contradictions settled", value: c.settled },
    { label: "Vault edits imported", value: c.imported },
  ];
  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold">{dayLabel(d.day)}</h2>
        <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill>
      </div>
      {d.error ? <p role="alert" className="text-[13px] text-danger">{d.error}</p> : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
            <dt className="text-[12px] text-muted">{s.label}</dt>
            <dd className="text-[22px] font-semibold tabular">{s.value}</dd>
          </div>
        ))}
      </dl>
      {d.changes.length ? (
        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">What changed</h3>
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {d.changes.map((ch, i) => <ChangeRow key={i} dream={d} change={ch} index={i} canManage={canManage} />)}
          </ul>
        </section>
      ) : null}
      {d.diary ? (
        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">Diary <span className="font-mono text-[12px] font-normal text-muted">{d.diary_path}</span></h3>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4"><Markdown>{stripFrontmatter(d.diary).replace(/^#\s+Dream diary[^\n]*\n+/, "")}</Markdown></div>
        </section>
      ) : null}
    </div>
  );
}

export function DreamsTab({ selected, onSelect, canManage, hour, timezone }: {
  selected: string | null;
  onSelect: (id: string) => void;
  canManage: boolean;
  hour: number;
  timezone: string;
}) {
  const { data: dreams, isLoading, error } = useQuery(dreamsQuery);
  if (isLoading) return <Skeleton className="h-64 rounded-[var(--radius-md)]" />;
  if (error || !dreams) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const when = `${String(hour).padStart(2, "0")}:00 (${timezone})`;
  if (!dreams.length) {
    return <EmptyState icon={MoonStarsIcon} title="No dreams yet"
      body={`Every night at ${when} the brain tidies itself: it merges duplicate facts, settles contradictions, imports vault edits and writes a diary you can review here.`} />;
  }
  const current = selected ?? dreams[0]?.id ?? "";
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Dreams" className="grid content-start gap-1">
        <p className="mb-1 text-[12.5px] text-muted">Runs nightly at {when}.</p>
        {dreams.map((d) => {
          const c = counts(d);
          return (
            <button key={d.id} onClick={() => onSelect(d.id)} aria-current={d.id === current ? "page" : undefined}
              className={cn("grid rounded-sm px-3 py-2 text-left hover:bg-surface-2/70", d.id === current && "bg-accent-soft/70")}>
              <span className="text-[13px] font-medium">{dayLabel(d.day)}</span>
              <span className="text-[12px] text-muted">{d.status === "done" ? `${c.merged} merged · ${c.settled} settled · ${c.imported} imported` : d.status}</span>
            </button>
          );
        })}
      </nav>
      <DreamDetail key={current} id={current} canManage={canManage} />
    </div>
  );
}
