/**
 * P109: the filters every task view shares (board, list, due dates, calendar, timeline): work
 * for people or AI, one label, the states (all views but the board, whose columns are the
 * states) and a due date range. Whose cards (mine, for me, created by me, watching...) and the
 * person strip stay in the toolbar.
 */
import { FunnelSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/i18n";
import { PERSON_STATUS } from "@/lib/people";
import { STATUS_INFO, type TaskStatus } from "@/lib/work";

export interface ExtraFilters {
  kind: "" | "people" | "ai";
  label: string;
  status: string;
  dueFrom: string | null;
  dueTo: string | null;
}

export const NO_EXTRA: ExtraFilters = { kind: "", label: "", status: "", dueFrom: null, dueTo: null };

const STATES: TaskStatus[] = ["triage", "ready", "running", "blocked", "review", "done", "failed", "cancelled"];

export const extraCount = (f: ExtraFilters, withStatus: boolean) =>
  [f.kind, f.label, withStatus ? f.status : "", f.dueFrom || f.dueTo ? "due" : ""].filter(Boolean).length;

export function TaskFilters({ value, onChange, showStatus }: { value: ExtraFilters; onChange: (f: ExtraFilters) => void; showStatus: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const n = extraCount(value, showStatus);
  const set = (patch: Partial<ExtraFilters>) => onChange({ ...value, ...patch });
  return (
    <>
      <Button variant="outline" size="sm" className="h-10 shrink-0 pointer-coarse:h-11" onClick={() => setOpen(true)} aria-label={n ? t("Filters: {n} on", { n }) : t("Filters")}>
        <FunnelSimpleIcon size={15} weight={n ? "fill" : "regular"} className={n ? "text-accent" : undefined} />
        <span className="max-sm:sr-only">{t("Filters")}</span>
        {n ? <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent tabular">{n}</span> : null}
      </Button>
      {n ? (
        <Button variant="ghost" size="sm" className="h-10 shrink-0 text-muted pointer-coarse:h-11" onClick={() => onChange(NO_EXTRA)}>
          <XIcon size={13} /> <span className="max-sm:sr-only">{t("Clear filters")}</span>
        </Button>
      ) : null}
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={t("Filter tasks")} description={t("The same filters apply to the board, list, calendar and timeline.")}
        footer={<Button onClick={() => setOpen(false)}>{t("Done")}</Button>}>
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Work for")}</span>
            <Segmented label={t("Work for")} value={value.kind || "all"} onChange={(v) => set({ kind: v === "all" ? "" : (v as "people" | "ai") })} className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[{ value: "all", label: t("Everyone") }, { value: "people", label: t("People") }, { value: "ai", label: t("AI agents") }]} />
          </div>
          {showStatus ? (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Status")}</span>
              <MultiSelect value={value.status ? value.status.split(",") : []} onValueChange={(v) => set({ status: v.join(",") })} label={t("Status")} placeholder={t("Any status")}
                options={STATES.map((s) => ({ value: s, label: t(PERSON_STATUS[s] ?? STATUS_INFO[s].label) }))} />
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <label htmlFor="task-filter-label" className="text-[13px] font-medium">{t("Label")}</label>
            <Input id="task-filter-label" value={value.label} onChange={(e) => set({ label: e.target.value })} placeholder={t("e.g. audit")} />
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("Due from")}</span>
              <DatePicker value={value.dueFrom} max={value.dueTo ?? undefined} onChange={(d) => set({ dueFrom: d })} label={t("Due from")} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("Due by")}</span>
              <DatePicker value={value.dueTo} min={value.dueFrom ?? undefined} onChange={(d) => set({ dueTo: d })} label={t("Due by")} />
            </div>
          </div>
          {n ? <Button variant="ghost" className="justify-self-start" onClick={() => onChange(NO_EXTRA)}><XIcon size={14} /> {t("Clear filters")}</Button> : null}
        </div>
      </ResponsiveDialog>
    </>
  );
}
