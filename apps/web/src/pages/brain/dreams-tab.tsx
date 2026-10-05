import { ArrowCounterClockwiseIcon, ArrowsMergeIcon, BookOpenTextIcon, DownloadSimpleIcon, LightbulbIcon, MoonStarsIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ListCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, dreamQuery, dreamsQuery, type Dream, type DreamChange } from "@/lib/brain";
import { cn } from "@/lib/utils";

import { stripFrontmatter } from "./wiki-markdown";

const STATUS_TONE = { running: "info", done: "ok", failed: "danger" } as const;
const STATUS_LABEL = { running: msg("running"), done: msg("done"), failed: msg("failed") } as const;

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function counts(d: Dream) {
  const by = (k: DreamChange["kind"]) => d.changes.filter((c) => c.kind === k).length;
  return { merged: by("merge"), settled: by("contradiction"), imported: by("import"), conflicts: by("conflict") };
}

function ChangeRow({ dream, change, index, canManage }: { dream: Dream; change: DreamChange; index: number; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const undo = useMutation({
    mutationFn: () => api<Dream>(`/api/brain/dreams/${dream.id}/undo/${index}`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainKeys.dreams });
      qc.invalidateQueries({ queryKey: ["brain", "facts"] });
      toast.success(tr("Undone. The fact is active again."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fact = change.kind === "merge" || change.kind === "contradiction";
  if (change.kind === "skill") {
    const text = {
      merge: t("Proposed merging {other} into {name}", { other: change.other ?? "", name: change.name ?? "" }),
      retire: t("Proposed retiring {name} (unused for {days} days)", { name: change.name ?? "", days: change.days ?? 0 }),
      flag: t("{name} was accepted only {pct}% of the last {uses} times", { name: change.name ?? "", pct: Math.round((change.success_rate ?? 0) * 100), uses: change.uses ?? 0 }),
      vault_edit: t("{name} was edited in the vault; waiting for review", { name: change.name ?? "" }),
    }[change.action ?? "merge"];
    return (
      <li className="grid min-w-0 gap-1 px-4 py-3">
        <p className="text-[13px] break-words">{text}</p>
        <p className="text-[12px] text-muted">{t("Skill curator · review in")} <a href="/skills?tab=proposals" className="text-accent hover:underline">{t("Skills > Proposals")}</a></p>
      </li>
    );
  }
  return (
    <li className="grid min-w-0 gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-56 gap-0.5 text-[13px] break-words">
          {fact ? (
            <>
              <p className={cn("text-muted", !change.undone && "line-through decoration-muted/60")}>{change.ended_text}</p>
              <p>{change.kind === "merge" ? t("Kept:") : t("Now:")} {change.kept_text}</p>
            </>
          ) : (
            <p className="font-mono text-[12.5px] break-all">{change.path}</p>
          )}
        </div>
        {fact && canManage ? (
          change.undone ? <Pill>{t("Undone")}</Pill> : (
            <Button size="sm" variant="ghost" loading={undo.isPending} onClick={() => undo.mutate()}><ArrowCounterClockwiseIcon size={14} /> {t("Undo")}</Button>
          )
        ) : null}
      </div>
      <p className="text-[12px] text-muted">
        {change.kind === "merge" ? t("Duplicate merged") : change.kind === "contradiction" ? t("Contradiction settled (newer fact wins)") : change.kind === "import" ? t("Edited in the vault, imported") : t("Edited in two places; the dashboard copy was kept")}
        {change.similarity ? ` · ${t("{pct}% similar", { pct: Math.round(change.similarity * 100) })}` : ""}
      </p>
    </li>
  );
}

function DreamDetail({ id, canManage }: { id: string; canManage: boolean }) {
  const t = useT();
  const { data: d, isLoading, error } = useQuery(dreamQuery(id));
  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-7 w-56" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
        <Skeleton className="h-48 rounded-[var(--radius-md)]" />
      </div>
    );
  }
  if (error || !d) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const c = counts(d);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-semibold tracking-tight">{dayLabel(d.day)}</h2>
        <Pill tone={STATUS_TONE[d.status]} live={d.status === "running"}>{t(STATUS_LABEL[d.status])}</Pill>
      </div>
      {d.error ? <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[13px] break-words text-danger">{d.error}</p> : null}
      <StatGrid>
        <Stat label={t("Facts learned")} value={d.stats.facts_learned ?? 0} icon={LightbulbIcon} tone="warn" />
        <Stat label={t("Duplicates merged")} value={c.merged} icon={ArrowsMergeIcon} tone="info" />
        <Stat label={t("Contradictions settled")} value={c.settled} icon={ScalesIcon} tone="violet" />
        <Stat label={t("Vault edits imported")} value={c.imported} icon={DownloadSimpleIcon} tone="ok" />
      </StatGrid>
      {d.changes.length ? (
        <section className="grid min-w-0 gap-2">
          <h3 className="text-[14px] font-semibold">{t("What changed")} <span className="font-normal text-muted tabular">{d.changes.length}</span></h3>
          <ListCard>
            {d.changes.map((ch, i) => <ChangeRow key={i} dream={d} change={ch} index={i} canManage={canManage} />)}
          </ListCard>
        </section>
      ) : null}
      {d.diary ? (
        <Card>
          <CardHeader icon={<IconTile icon={BookOpenTextIcon} size="sm" tone="violet" />} title={t("Diary")}
            description={d.diary_path ? <span className="font-mono break-all">{d.diary_path}</span> : undefined} />
          <div className="min-w-0 overflow-x-auto px-4 py-4 sm:px-5"><Markdown>{stripFrontmatter(d.diary).replace(/^#\s+Dream diary[^\n]*\n+/, "")}</Markdown></div>
        </Card>
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
  const t = useT();
  const { data: dreams, isLoading, error } = useQuery(dreamsQuery);
  if (isLoading) return <Skeleton className="h-64 rounded-[var(--radius-md)]" />;
  if (error || !dreams) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const when = `${String(hour).padStart(2, "0")}:00 (${timezone})`;
  if (!dreams.length) {
    return <EmptyState icon={MoonStarsIcon} title={t("No dreams yet")}
      body={t("Every night at {when} the brain tidies itself: it merges duplicate facts, settles contradictions, imports vault edits and writes a diary you can review here.", { when })} />;
  }
  const current = selected ?? dreams[0]?.id ?? "";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label={t("Dreams")} className="grid min-w-0 content-start gap-2">
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><MoonStarsIcon size={14} /> {t("Runs nightly at {when}.", { when })}</p>
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:overflow-visible lg:pb-0 [&::-webkit-scrollbar]:hidden">
          {dreams.map((d) => {
            const c = counts(d);
            const on = d.id === current;
            return (
              <li key={d.id} className="shrink-0 lg:shrink">
                <button type="button" onClick={() => onSelect(d.id)} aria-current={on ? "page" : undefined}
                  className={cn("grid w-full min-w-0 gap-0.5 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors max-lg:w-52",
                    on ? "border-accent/50 bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2/70")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{dayLabel(d.day)}</span>
                    {d.status !== "done" ? <Pill tone={STATUS_TONE[d.status]} className="px-2 text-[11px]">{t(STATUS_LABEL[d.status])}</Pill> : null}
                  </span>
                  <span className="truncate text-[12px] text-muted tabular">{t("{merged} merged · {settled} settled · {imported} imported", { merged: c.merged, settled: c.settled, imported: c.imported })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <DreamDetail key={current} id={current} canManage={canManage} />
    </div>
  );
}
