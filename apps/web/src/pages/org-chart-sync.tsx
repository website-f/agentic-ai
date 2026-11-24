/**
 * P127 (Fitri, 23 Nov 2026: "make sure the organization and hierarchy things sync with agentic
 * side, because agentic and prima is one so all things must be sync. and then give me the
 * pdf/excel for this hierarchy so I can view").
 *
 * - OrgChartDownload: the chart as Excel (one row per person) or PDF (black on white, an indented
 *   tree). The server sends only what this reader may see on the chart.
 * - PrimaSyncLine (members.manage): the last sync with Prima's org chart, how many are in step,
 *   waiting for Prima or different, the differences with which side won and why, and "Sync with
 *   Prima" (api/routers/org_chart_files.py, prima/org_sync.py).
 */
import { ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, DownloadSimpleIcon, FilePdfIcon, FileXlsIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { hierarchyKey } from "@/lib/hierarchy";
import { startDownload } from "@/lib/native";
import type { Me } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export function OrgChartDownload() {
  const t = useT();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label={t("Download the organization chart")}>
          <DownloadSimpleIcon size={15} /> <span className="max-sm:sr-only">{t("Download")}</span>
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<FileXlsIcon />} onSelect={() => startDownload("/api/org-chart/export.xlsx")}>{t("Excel (.xlsx)")}</MenuItem>
        <MenuItem icon={<FilePdfIcon />} onSelect={() => startDownload("/api/org-chart/export.pdf")}>{t("PDF (printable tree)")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}

interface SyncPerson {
  user_id: string;
  name: string;
  office_line: string | null;
  prima_line: string | null;
  prima_how: string | null;
  state: "waiting" | "differs";
  winner: string | null;
  why: string | null;
  message: string | null;
}

interface SyncStatus {
  enabled: boolean;
  last_run: { at: string; ok: boolean; problem: string | null; installed: boolean; counts: Record<string, number> } | null;
  people: SyncPerson[];
  running?: boolean;
}

const syncKey = ["org-chart", "prima-sync"] as const;

export function PrimaSyncLine({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const allowed = me.permissions.includes("members.manage");
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: syncKey, queryFn: () => api<SyncStatus>("/api/org-chart/prima-sync"), enabled: allowed });
  const run = useMutation({
    mutationFn: () => api<SyncStatus>("/api/org-chart/prima-sync", "POST", {}),
    onSuccess: (d) => {
      qc.setQueryData(syncKey, d);
      void qc.invalidateQueries({ queryKey: hierarchyKey });
      toast.success(d.running ? t("A sync with Prima is already running. Showing the last result.") : t("Synced with Prima."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!allowed || !data?.enabled) return null;

  const last = data.last_run;
  const c = last?.counts ?? {};
  const how = (h: string | null) =>
    h === "set" ? t("set by a head") : h === "standard" ? t("from the job") : h === "assumed" ? t("assumed (Chief of Staff)") : h === "top" ? t("top of the group") : "";
  const why = (p: SyncPerson): string => {
    switch (p.why) {
      case "filled_to_prima": return t("Prima had no real line for them: the office line was sent there.");
      case "prima_kept": return t("Prima's line is the hierarchy: the office follows it. Change it in Prima's org chart.");
      case "unsure_office_keeps": return t("Both already had a line: the office keeps its own. Set it again here to send it to Prima, or change it in Prima.");
      case "both_changed_office_keeps": return t("Both changed and it is not clear which was last: the office keeps its own.");
      case "prima_manager_not_linked": return t("Prima's manager is not linked to anyone in the office.");
      case "office_manager_not_linked": return t("The office's manager is not linked to Prima yet: it goes once they are.");
      case "would_loop": return t("Prima's line would make a loop here, so it was not copied.");
      case "prima_no_line": return t("Prima has no line of its own for them now: the office keeps its own.");
      case "prima_job_line": return t("Prima's line comes from their job and cannot be removed there.");
      case "prima_top": return t("Top of the group in Prima: reports to nobody there.");
      case "not_installed": return t("Waiting for Prima: its org chart settings are not installed yet.");
      case "refused": return p.message ? t("Prima refused: {why}", { why: p.message }) : t("Prima refused it. It is tried again on the next sync.");
      case "prima_down": return t("Prima did not answer. It is tried again on the next sync.");
      default: return "";
    }
  };
  const problem = last && !last.ok
    ? last.problem === "no_top" ? t("Prima has no CEO record to sync as.") : t("Prima did not answer at the last sync.")
    : null;

  return (
    <div className="grid min-w-0 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[12.5px] text-muted">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-fg">{t("Prima sync")}</span>
        {last ? (
          <>
            <span>· {t("last {when}", { when: timeAgo(last.at) })}</span>
            {problem ? <span className="text-danger">· {problem}</span> : (
              <>
                <span>· {t("{n} in step", { n: c.in_step ?? 0 })}</span>
                <span>· {t("{n} waiting for Prima", { n: c.waiting ?? 0 })}</span>
                <span>· {t("{n} differences", { n: c.differs ?? 0 })}</span>
                {c.unlinked ? <span>· {t("{n} not linked to Prima", { n: c.unlinked })}</span> : null}
              </>
            )}
            {!last.installed && last.ok ? <span>· {t("Prima's org chart settings are not installed yet, so office changes wait.")}</span> : null}
          </>
        ) : <span>· {t("Not synced with Prima yet.")}</span>}
        <span className="ml-auto flex items-center gap-1">
          {data.people.length ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <CaretDownIcon size={13} /> : <CaretRightIcon size={13} />} {t("Show {n}", { n: data.people.length })}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>
            <ArrowsClockwiseIcon size={14} /> {t("Sync with Prima")}
          </Button>
        </span>
      </div>
      {open && data.people.length ? (
        <div className="max-h-72 min-w-0 overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-1 pr-3 font-medium">{t("Person")}</th>
                <th className="py-1 pr-3 font-medium">{t("Office line")}</th>
                <th className="py-1 pr-3 font-medium">{t("Prima line")}</th>
                <th className="py-1 font-medium">{t("What happened")}</th>
              </tr>
            </thead>
            <tbody className="text-fg">
              {data.people.map((p) => (
                <tr key={p.user_id} className="border-b border-border/60 align-top">
                  <td className="py-1 pr-3 font-medium">{p.name}</td>
                  <td className="py-1 pr-3">{p.office_line ?? t("No one")}</td>
                  <td className="py-1 pr-3">{p.prima_line ?? t("No one")}{how(p.prima_how) ? <span className="text-muted"> ({how(p.prima_how)})</span> : null}</td>
                  <td className="py-1 text-muted">{why(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5">{t("Heads of department are not synced: Prima names one head and one deputy for each central department and company, set in Prima's org chart.")}</p>
        </div>
      ) : null}
    </div>
  );
}
