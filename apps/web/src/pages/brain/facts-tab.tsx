import { ArrowCounterClockwiseIcon, LightbulbIcon, PencilSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { CompanyPicker } from "@/components/ui/company-picker";
import { DataTable, filterOf, RowMenu, TableFilter, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError, Input } from "@/components/ui/field";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, END_REASON, factScope, type Fact } from "@/lib/brain";
import { branchesQuery } from "@/lib/queries";
import { everyRow } from "@/lib/table-export";
import { cn, timeAgo } from "@/lib/utils";

type State = "active" | "ended" | "all";

function Source({ f }: { f: Fact }) {
  const t = useT();
  if (f.source_kind === "task" && f.source_id) {
    return <Link to="/tasks" search={{ task: f.source_id }} className="text-accent hover:underline">{f.source_label ?? t("a task")}</Link>;
  }
  return <span>{f.source_label ?? f.created_by_name}</span>;
}

/** P107: one fact's ⋯ menu: correct it (in a dialog), forget it, or bring an ended one back. */
function FactActions({ f }: { f: Fact }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const done = (note: string) => {
    qc.invalidateQueries({ queryKey: ["brain", "facts"] });
    qc.invalidateQueries({ queryKey: brainKeys.overview });
    toast.success(note);
  };
  const edit = useMutation({
    mutationFn: () => api<Fact>(`/api/brain/facts/${f.id}`, "PATCH", { text: editing }),
    onSuccess: () => { setEditing(null); done(tr("Corrected. The old version is kept under Ended.")); },
  });
  const act = useMutation({
    mutationFn: (what: "forget" | "restore") => api<Fact>(`/api/brain/facts/${f.id}/${what}`, "POST"),
    onSuccess: (_r, what) => done(what === "forget" ? tr("Forgotten. Agents no longer recall it.") : tr("Restored.")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ended = f.valid_to !== null;
  return (
    <>
      <RowMenu label={t("Options for this fact")}>
        {!ended ? (
          <>
            <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(f.text)}>{t("Correct this fact")}</MenuItem>
            <MenuItem icon={<XIcon />} danger disabled={act.isPending} onSelect={() => act.mutate("forget")}>{t("Forget this fact")}</MenuItem>
          </>
        ) : (
          <MenuItem icon={<ArrowCounterClockwiseIcon />} disabled={act.isPending} onSelect={() => act.mutate("restore")}>{t("Restore")}</MenuItem>
        )}
      </RowMenu>
      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} title={t("Correct this fact")}
        description={t("The old version is kept under Ended, so nothing is lost.")}
        footer={<>
          <Button variant="outline" onClick={() => setEditing(null)}>{t("Cancel")}</Button>
          <Button loading={edit.isPending} disabled={!editing || editing.trim().length < 3 || editing === f.text} onClick={() => edit.mutate()}>{t("Save correction")}</Button>
        </>}>
        <div className="grid gap-2">
          <Input value={editing ?? ""} onChange={(e) => setEditing(e.target.value)} aria-label={t("Fact")} autoFocus />
          <FormError message={edit.error ? errorMessage(edit.error) : null} />
        </div>
      </ResponsiveDialog>
    </>
  );
}

function AddFact({ branches }: { branches: { id: string; name: string }[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const add = useMutation({
    mutationFn: () => api<Fact>("/api/brain/facts", "POST", { text, branch_id: scope === "all" ? null : scope }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["brain", "facts"] });
      qc.invalidateQueries({ queryKey: brainKeys.overview });
      toast.success(tr("Saved. Agents recall it when it is relevant."));
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) add.mutate(); }} className="grid gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] sm:p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium"><PlusIcon size={14} weight="bold" className="text-accent" /> {t("Teach the office a fact")}</p>
      <div className="flex flex-col gap-2 md:flex-row">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("e.g. Maju Trading invoices on net-30 terms")} aria-label={t("New fact")} className="min-w-0 md:flex-1" />
        <CompanyPicker value={scope} onValueChange={setScope} label={t("Who knows it")} className="md:w-56"
          before={[{ value: "all", label: t("Every company") }]} companies={branches} />
        <Button type="submit" loading={add.isPending} disabled={text.trim().length < 3}><PlusIcon size={15} weight="bold" /> {t("Add")}</Button>
      </div>
      <FormError message={add.error ? errorMessage(add.error) : null} />
    </form>
  );
}

export function FactsTab({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const { data: branches = [] } = useQuery(branchesQuery);
  // P107: a data table. Which facts, company and search filter on the server, which sorts and
  // sends one numbered page; "f_" keeps the table's place apart from the Search tab's `q`.
  const control = useTableState({ size: 25, f: { state: "active" } }, { prefix: "f_", filters: ["state", "branch_id"] });
  const [stateRaw, setState] = filterOf(control, "state");
  const state = (["active", "ended", "all"].includes(stateRaw) ? stateRaw : "active") as State;
  const table = useServerTable<Fact, { total: number; items: Fact[] }>(["brain", "facts"], "/api/brain/facts", control.state, {}, { pick: (b) => b.items });

  const columns: Column<Fact>[] = [
    {
      id: "text", header: t("Fact"), sortable: true, card: "title", exportValue: (f) => f.text,
      cell: (f) => {
        const ended = f.valid_to !== null;
        return (
          <span className="flex min-w-0 items-start gap-2.5">
            <IconTile icon={LightbulbIcon} size="sm" tone={ended ? "neutral" : "warn"} className="shrink-0 max-sm:hidden" />
            <span className={cn("min-w-0 pt-1 text-[13.5px] break-words", ended && "text-muted line-through decoration-muted/60")}>{f.text}</span>
          </span>
        );
      },
    },
    { id: "scope", header: t("Who knows it"), exportValue: (f) => factScope(f), cell: (f) => <Pill tone={f.agent_id ? "info" : f.branch_id ? "neutral" : "accent"}>{factScope(f)}</Pill> },
    { id: "source", header: t("Learned from"), hideBelow: "lg", exportValue: (f) => f.source_label ?? f.created_by_name, cell: (f) => <span className="break-words text-muted"><Source f={f} /></span> },
    {
      id: "used", header: t("Recalled"), sortable: true, kind: "number", align: "right", hideBelow: "xl", exportValue: (f) => f.hits,
      cell: (f) => (f.hits ? t("{n}×", { n: f.hits }) : <span className="text-muted">-</span>),
    },
    {
      id: "learned", header: t("Learned"), sortable: true, kind: "date", className: "whitespace-nowrap", exportValue: (f) => f.valid_from,
      cell: (f) => (
        <span className="grid justify-items-start gap-1">
          <time dateTime={f.valid_from} className="text-muted">{timeAgo(f.valid_from)}</time>
          {f.valid_to && f.end_reason ? <Pill tone="warn">{t(END_REASON[f.end_reason])} {timeAgo(f.valid_to).toLowerCase()}</Pill> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      {canWrite ? <AddFact branches={branches} /> : null}
      <DataTable<Fact>
        label={t("Facts")}
        columns={columns}
        rows={table.rows}
        total={table.total}
        mode="server"
        rowId={(f) => f.id}
        rowLabel={(f) => f.text.slice(0, 60)}
        control={control}
        loading={table.loading}
        fetching={table.fetching}
        error={table.error}
        onRetry={table.refetch}
        searchPlaceholder={t("Filter facts")}
        exportName={t("facts")}
        exportRows={() => everyRow<Fact, { total: number; items: Fact[] }>("/api/brain/facts", control.state, {}, (b) => b.items)}
        filters={
          <>
            <Segmented<State> label={t("Which facts")} value={state} onChange={setState} className="col-span-2 w-fit"
              options={[{ value: "active", label: t("Active") }, { value: "ended", label: t("Ended") }, { value: "all", label: t("All") }]} />
            {branches.length > 1 ? (
              <TableFilter control={control} id="branch_id" label={t("Company")} allLabel={t("All companies")}
                options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : null}
          </>
        }
        actions={canWrite ? (f) => <FactActions f={f} /> : undefined}
        empty={<EmptyState icon={LightbulbIcon} title={state === "ended" ? t("Nothing has been replaced or forgotten") : t("No facts yet")}
          body={state === "ended" ? t("When a fact goes out of date, the old version lands here with the reason, so nothing is silently lost.")
            : t("Agents pick up facts as they finish tasks and chats: names, terms, prices, preferences. You can add them yourself too.")} />}
      />
    </div>
  );
}
