/** P57: Settings > Data and privacy (owner only): export everything this workspace holds,
 * and erase the workspace for good (request, optional export, erase now; cancellable until
 * the erase starts). The erase signs everyone out, so its progress and the certificate of
 * deletion are on /erased, read with the access token the start answers with. */
import { DownloadSimpleIcon, FileZipIcon, ShieldWarningIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { GoLiveCard } from "@/components/go-live";
import { ConfirmForm } from "@/components/owner-confirm";
import { IconTile, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { type DataOverview, dataKey, type ErasureOut, erasedUrl, ERASE_STEPS, EXPORT_STEPS, type ExportOut, fileSize, shortDate } from "@/lib/erase";
import { timeAgo } from "@/lib/utils";

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

function ExportCard({ data }: { data: DataOverview }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ex: ExportOut | null = data.export;
  const busy = ex?.status === "queued" || ex?.status === "running";
  const discard = useMutation({
    mutationFn: (id: string) => api(`/api/workspace/data/exports/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataKey }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader icon={<IconTile icon={FileZipIcon} size="sm" tone="info" />} title={t("Export all data")}
        description={t("One ZIP with every record, every file in its folder, and the memory and documents as markdown. Passwords and keys are never included.")} />
      <CardBody className="grid gap-3">
        {busy && ex ? (
          <Progress value={ex.progress} label={t("Making the export: {step}", { step: t(EXPORT_STEPS[ex.step] ?? ex.step) })} />
        ) : null}
        {ex?.status === "ready" && ex.download_url ? (
          <div className="grid gap-2">
            <p className="text-[13px]">
              {t("Ready: {size}. It can be downloaded once, until {date}.", { size: fileSize(ex.size), date: shortDate(ex.expires_at) })}
            </p>
            {ex.sha256 ? <p className="font-mono text-[11.5px] break-all text-muted">SHA-256 {ex.sha256}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={ex.download_url} onClick={() => window.setTimeout(() => qc.invalidateQueries({ queryKey: dataKey }), 2000)}>
                  <DownloadSimpleIcon size={16} /> {t("Download the ZIP")}
                </a>
              </Button>
              <Button variant="outline" loading={discard.isPending} onClick={() => discard.mutate(ex.id)}>{t("Throw it away")}</Button>
            </div>
          </div>
        ) : null}
        {ex?.status === "downloaded" ? (
          <p className="text-[13px] text-muted">{t("Downloaded {when}. The copy on the server was deleted.", { when: timeAgo(ex.downloaded_at) })}</p>
        ) : null}
        {ex?.status === "failed" ? <FormError message={ex.error || t("The export failed.")} /> : null}
        {!busy && ex?.status !== "ready" ? (
          <div>
            <Button onClick={() => setOpen(true)}><FileZipIcon size={16} /> {t("Export all data")}</Button>
          </div>
        ) : null}
      </CardBody>
      <ConfirmForm open={open} onOpenChange={setOpen} title={t("Export all data")} needsCode={data.needs_code}
        description={t("Large workspaces take a while. You can leave this page; the download waits here.")}
        submit={t("Start the export")}
        onConfirm={async (v) => {
          await api("/api/workspace/data/exports", "POST", { password: v.password, code: v.code });
          await qc.invalidateQueries({ queryKey: dataKey });
        }} />
    </Card>
  );
}

function Consequences({ data }: { data: DataOverview }) {
  const t = useT();
  const cats = Object.entries(data.summary);
  return (
    <div className="grid gap-3 text-[13px]">
      <ul className="grid list-disc gap-1.5 pl-5">
        <li>{t("Everything in {name} is deleted: every record, file, memory page, document, conversation, prompt, AI answer, search index and log.", { name: data.workspace.name })}</li>
        <li>{t("Every connection is cut first: Microsoft 365 and Google sign-ins, Telegram and WhatsApp, linked computers, AI provider keys, tool servers and saved logins.")}</li>
        <li>{t("{n} people belong only to this workspace: their accounts are deleted. People who also belong to another workspace keep their account there.", { n: data.members.only_here })}</li>
        <li>{t("Copies in the server's encrypted backups are overwritten by the backup cycle within {days} days.", { days: data.backup_days })}</li>
        <li className="font-medium text-danger">{t("This cannot be undone. Export first if you need a copy.")}</li>
      </ul>
      {cats.length ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-[var(--radius-sm)] border border-border bg-surface-2/40 px-3 py-2">
          {cats.map(([k, n]) => (
            <div key={k} className="contents">
              <dt className="min-w-0 text-muted">{t(k)}</dt>
              <dd className="text-right tabular-nums">{n.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {data.providers.length ? (
        <div className="grid gap-1.5">
          <p className="text-muted">{t("These outside services received data while you used them. They keep it under their own terms: ask them to delete it under your agreement with them.")}</p>
          <ul className="grid gap-1">
            {data.providers.map((p, i) => (
              <li key={`${p.kind}-${p.name}-${i}`} className="flex flex-wrap items-center gap-2">
                <Pill>{t(p.kind)}</Pill>
                <span className="min-w-0 break-words">{p.name}</span>
                {p.where ? <span className="text-muted break-all">{p.where}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function rememberErase(id: string, token: string): void {
  try {
    localStorage.setItem("agentic.erasure", JSON.stringify({ id, token }));
  } catch {
    /* storage blocked: the page URL carries the token anyway */
  }
}

function EraseCard({ data }: { data: DataOverview }) {
  const t = useT();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<"request" | "start" | null>(null);
  const r: ErasureOut | null = data.erasure;
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/workspace/data/erasure/${id}`, "DELETE"),
    onSuccess: () => { toast.success(t("Erase request cancelled. Nothing was deleted.")); qc.invalidateQueries({ queryKey: dataKey }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="border-danger/40">
      <CardHeader icon={<IconTile icon={ShieldWarningIcon} size="sm" tone="danger" />} title={t("Erase this workspace")}
        description={t("For the end of a contract: everything this workspace holds is deleted here and a certificate of deletion is made for your client.")} />
      <CardBody className="grid gap-4">
        <Consequences data={data} />
        {r?.status === "requested" ? (
          <div className="grid gap-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/8 px-3 py-2.5 text-[13px]">
            <p className="flex items-center gap-2 font-medium"><WarningIcon size={16} className="text-warn" />
              {t("Erase requested {when}. To finish within {days} days, erase by {due}.", { when: timeAgo(r.requested_at), days: data.due_days, due: shortDate(r.due_by) })}</p>
            <p className="text-muted">{t("Export the data first if your client wants it back. You can cancel until the erase starts.")}</p>
          </div>
        ) : null}
        {r?.status === "erasing" ? <Progress value={r.progress} label={t("Erasing: {step}", { step: t(ERASE_STEPS.find((s) => s.key === r.step)?.label ?? r.step) })} /> : null}
        {r?.status === "failed" ? <FormError message={t("The erase stopped part-way: {why}", { why: r.error ?? "" })} /> : null}
        <div className="flex flex-wrap gap-2">
          {!r ? (
            <Button variant="danger" onClick={() => setAsking("request")}><TrashIcon size={16} /> {t("Request erase")}</Button>
          ) : null}
          {r && (r.status === "requested" || r.status === "failed") ? (
            <Button variant="danger" onClick={() => setAsking("start")}><TrashIcon size={16} /> {r.status === "failed" ? t("Try the erase again") : t("Erase now")}</Button>
          ) : null}
          {r?.status === "requested" ? (
            <Button variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{t("Cancel the request")}</Button>
          ) : null}
        </div>
      </CardBody>
      <ConfirmForm open={asking === "request"} onOpenChange={(o) => setAsking(o ? "request" : null)} danger needsCode={data.needs_code}
        workspaceName={data.workspace.name} title={t("Request erase")} submit={t("Request erase")}
        description={t("Nothing is deleted yet. Next, export the data if you need it, then erase. You can cancel until then.")}
        onConfirm={async (v) => {
          await api("/api/workspace/data/erasure", "POST", v);
          await qc.invalidateQueries({ queryKey: dataKey });
        }} />
      {r ? (
        <ConfirmForm open={asking === "start"} onOpenChange={(o) => setAsking(o ? "start" : null)} danger needsCode={data.needs_code}
          workspaceName={data.workspace.name} title={t("Erase {name} now", { name: data.workspace.name })} submit={t("Erase everything")}
          description={t("Everyone is signed out at once, you too. The next page shows the progress and gives you the certificate of deletion: keep it.")}
          onConfirm={async (v) => {
            const out = await api<ErasureOut>(`/api/workspace/data/erasure/${r.id}/start`, "POST", v);
            const token = out.access_token ?? "";
            rememberErase(out.id, token);
            window.location.assign(erasedUrl(out.id, token));
          }} />
      ) : null}
    </Card>
  );
}

/** The whole section; render it for owners only. */
export function DataPrivacySection() {
  const t = useT();
  const q = useQuery({
    queryKey: dataKey,
    queryFn: () => api<DataOverview>("/api/workspace/data"),
    refetchInterval: (query) => {
      const d = query.state.data;
      const exporting = d?.export?.status === "queued" || d?.export?.status === "running";
      return exporting || d?.erasure?.status === "erasing" ? 2000 : false;
    },
  });
  return (
    <Section title={t("Data and privacy")} description={t("Only owners see this. Take everything with you, or erase this workspace when a contract ends.")}>
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <FormError message={errorMessage(q.error)} /> : null}
      {q.data ? (
        <div className="grid gap-4">
          <ExportCard data={q.data} />
          {/* P81: a practice office becomes the real one (members, sample companies). */}
          <GoLiveCard />
          <EraseCard data={q.data} />
        </div>
      ) : null}
    </Section>
  );
}
