/** P149a: the background storage jobs on the File storage page: file bytes moved from the
 * app's database to the file server (with progress, errors and a pause switch), older files
 * made smaller (quiet hours), what the database can give back, the read cache and the
 * nightly backup to the file server. Owners and admins only, like the rest of the page. */
import { ArchiveIcon, ArrowsInIcon, CloudArrowUpIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface JobState {
  enabled: boolean;
  paused: boolean;
  moved?: number;
  smaller?: number;
  kept?: number;
  bytes_before?: number;
  bytes_after?: number;
  errors?: number;
  busy?: number;
  changed?: number;
  last_error?: string | null;
  auto_paused?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  last_run?: string | null;
  waiting?: string | null;
}

export interface StorageOverview {
  primary: { id: string; name: string; kind: string } | null;
  in_database: { files: number; bytes: number };
  on_primary: { files: number; bytes: number };
  to_compress: number;
  saved_by_compression: number;
  jobs: { move: JobState; compress: JobState };
  quiet_hours: boolean;
  database: { files_table_bytes: number; file_bytes_inside: number; reclaimable_bytes: number; how: string };
  cache: { files: number; bytes: number; cap_bytes: number };
  backup: {
    ok?: boolean;
    date?: string;
    finished_at?: string;
    bytes?: number;
    error?: string;
    last_ok_at?: string | null;
    last_ok_bytes?: number | null;
  } | null;
}

export const jobsKey = ["storage", "jobs"] as const;

export function size(n: number | null | undefined): string {
  const v = Math.max(0, n ?? 0);
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(v / 1024)} KB`;
}

function JobRow({ kind, job, overview }: { kind: "move" | "compress"; job: JobState; overview: StorageOverview }) {
  const t = useT();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (action: "start" | "pause" | "resume") => api<StorageOverview>(`/api/storage/jobs/${kind}/${action}`, "POST", {}),
    onSuccess: (data) => {
      qc.setQueryData(jobsKey, data);
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isMove = kind === "move";
  const done = isMove ? job.moved ?? 0 : job.smaller ?? 0;
  const left = isMove ? overview.in_database.files : overview.to_compress;
  const total = done + left;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const running = job.enabled && !job.paused;
  return (
    <div className="grid gap-2 rounded-sm border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconTile icon={isMove ? CloudArrowUpIcon : ArrowsInIcon} tone={isMove ? "info" : "violet"} size="sm" />
        <p className="min-w-0 flex-1 text-[13.5px] font-semibold">
          {isMove ? t("Move files to the file server") : t("Make older files smaller")}{" "}
          {running ? <Pill tone="ok">{t("Running")}</Pill> : job.paused ? <Pill tone="warn">{t("Paused")}</Pill> : null}
        </p>
        {!job.enabled ? (
          <Button size="sm" variant="outline" loading={act.isPending} disabled={isMove && !overview.primary} onClick={() => act.mutate("start")}>
            <PlayIcon size={14} /> {t("Start")}
          </Button>
        ) : job.paused ? (
          <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate("resume")}><PlayIcon size={14} /> {t("Resume")}</Button>
        ) : (
          <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => act.mutate("pause")}><PauseIcon size={14} /> {t("Pause")}</Button>
        )}
      </div>
      <p className="text-[12.5px] text-muted">
        {isMove
          ? t("Files kept in the app's database are copied to {name}, checked there, then removed from the database. Opening them keeps working the whole time.", { name: overview.primary?.name ?? t("the file server") })
          : t("Files saved before compression was turned on are made smaller in the same format, at night and at weekends only.")}
      </p>
      {job.enabled ? (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={isMove ? t("Move files to the file server") : t("Make older files smaller")} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12.5px] text-muted tabular">
            {isMove
              ? t("{done} of {total} files moved ({before} sent as {after}); {left} left", { done, total, left, before: size(job.bytes_before), after: size(job.bytes_after) })
              : t("{done} files made smaller, {kept} already as small as they go; {left} left", { done, kept: job.kept ?? 0, left })}
            {job.errors ? ` · ${t("{n} errors", { n: job.errors })}` : ""}
            {job.last_run ? ` · ${t("last worked {when}", { when: timeAgo(job.last_run).toLowerCase() })}` : ""}
          </p>
          {job.waiting === "office hours" && !overview.quiet_hours ? <p className="text-[12px] text-muted">{t("Waiting for the evening (after 8 pm) or the weekend.")}</p> : null}
          {job.auto_paused ? <p className="text-[12px] text-danger">{t("Paused by itself after repeated failures: {reason}", { reason: job.auto_paused })}</p> : null}
          {job.last_error && !job.auto_paused ? <p className="text-[12px] text-muted break-words">{t("Last problem: {reason}", { reason: job.last_error })}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function StorageJobsCard() {
  const t = useT();
  const { data } = useQuery({
    queryKey: jobsKey,
    queryFn: () => api<StorageOverview>("/api/storage/jobs"),
    refetchInterval: (q) => (q.state.data?.jobs.move.enabled && !q.state.data.jobs.move.paused ? 15_000 : 60_000),
  });
  if (!data) return null;
  const b = data.backup;
  return (
    <Card>
      <CardHeader title={t("Moving and compressing files")} icon={<IconTile icon={CloudArrowUpIcon} size="sm" />}
        description={t("{db} files ({dbsize}) are still in the app's database; {n} files ({size}) are on {name}. Compression has saved {saved}.", {
          db: data.in_database.files, dbsize: size(data.in_database.bytes), n: data.on_primary.files, size: size(data.on_primary.bytes),
          name: data.primary?.name ?? t("the file server"), saved: size(data.saved_by_compression),
        })} />
      <CardBody className="grid gap-3">
        <JobRow kind="move" job={data.jobs.move} overview={data} />
        <JobRow kind="compress" job={data.jobs.compress} overview={data} />
        <div className="grid gap-1 text-[12.5px] text-muted">
          <p>
            {t("Database: the files table takes {table}; {inside} of file bytes are still inside. About {free} can be given back to the server's disk.", {
              table: size(data.database.files_table_bytes), inside: size(data.database.file_bytes_inside), free: size(data.database.reclaimable_bytes),
            })}
          </p>
          {data.database.reclaimable_bytes > 256 * 1024 * 1024 && data.in_database.files === 0 ? (
            <p>{t("Giving it back locks the files table for a few minutes: the developer runs it once, at a quiet hour.")}</p>
          ) : null}
          <p>{t("Quick-open copy on the server: {n} files, {size} of {cap}.", { n: data.cache.files, size: size(data.cache.bytes), cap: size(data.cache.cap_bytes) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12.5px]">
          <IconTile icon={ArchiveIcon} size="sm" tone={b?.ok ? "ok" : b ? "danger" : "neutral"} />
          {b ? (
            b.ok ? (
              <span>{t("Last backup to the file server {when}: {size}, checked.", { when: timeAgo(b.finished_at ?? "").toLowerCase(), size: size(b.bytes) })}</span>
            ) : (
              <span className="text-danger break-words">
                {t("The last backup failed: {reason}", { reason: b.error ?? "" })}
                {b.last_ok_at ? ` ${t("The last good one was {when}.", { when: timeAgo(b.last_ok_at).toLowerCase() })}` : ""}
              </span>
            )
          ) : (
            <span className="text-muted">{t("No backup to the file server yet. It runs every night at 2:30 am.")}</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
