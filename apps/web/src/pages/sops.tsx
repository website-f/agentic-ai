import { BookBookmarkIcon, BuildingsIcon, CheckCircleIcon, FileTextIcon, GlobeHemisphereEastIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Page, type Tone } from "@/components/page";
import { PinButton } from "@/components/pin-button";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DataTable, filterOf, TableFilter, useTableState, type BulkOutcome, type Column } from "@/components/ui/data-table";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { bulkDelete } from "@/lib/bulk";
import { libraryKeys } from "@/lib/library";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { sopsQuery, workKeys, type SOP } from "@/lib/work";

import { LibraryHeader } from "./library-hub/hub";
import { sopScopeLabel, sopsForCompany } from "./library-hub/views";

type Scope = SOP["scope"];
const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "workspace", label: msg("Every company"), hint: msg("Every agent in every branch follows it.") },
  { value: "branch", label: msg("One company"), hint: msg("Every agent in that branch.") },
  { value: "department", label: msg("One department"), hint: msg("Every agent in that department.") },
  { value: "library", label: msg("Attached to agents"), hint: msg("Only agents you attach it to, like a skill pack.") },
];
const SCOPE_LOOK: Record<Scope, { icon: typeof FileTextIcon; tone: Tone }> = {
  workspace: { icon: GlobeHemisphereEastIcon, tone: "accent" },
  branch: { icon: BuildingsIcon, tone: "info" },
  department: { icon: UsersThreeIcon, tone: "violet" },
  library: { icon: BookBookmarkIcon, tone: "orange" },
};

const SCOPE_ORDER: Record<Scope, number> = { workspace: 0, branch: 1, department: 2, library: 3 };

const STARTER = `## Purpose
What this procedure is for, in one sentence.

## Steps
1. First step
2. Second step

## Rules
- Always ...
- Never ...

## Output
What the finished work must look like.`;

function Editor({ sop, open, onOpenChange, canManage }: { sop: SOP | null; open: boolean; onOpenChange: (o: boolean) => void; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const [title, setTitle] = useState(sop?.title ?? "");
  const [scope, setScope] = useState<Scope>(sop?.scope ?? "department");
  const [scopeId, setScopeId] = useState<string | null>(sop?.scope_id ?? null);
  const [body, setBody] = useState(sop?.body ?? STARTER);
  const [view, setView] = useState<"write" | "preview">(sop ? "preview" : "write");
  const [deleting, setDeleting] = useState(false);
  const departments = branches.flatMap((b) => b.departments.map((d) => ({ value: d.id, label: `${d.name}, ${b.name}` })));

  const save = useMutation({
    mutationFn: () => sop
      ? api<SOP>(`/api/sops/${sop.id}`, "PATCH", { title, body })
      : api<SOP>("/api/sops", "POST", { title, body, scope, scope_id: scope === "branch" || scope === "department" ? scopeId : null }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: workKeys.sops });
      toast.success(sop ? tr("Saved as version {n}.", { n: s.version }) : tr("SOP created. Agents in scope follow it from their next step."));
      onOpenChange(false);
    },
  });
  const needsTarget = !sop && (scope === "branch" || scope === "department") && !scopeId;
  // P24: an AI-written draft waits for a person; approving saves any edits too.
  const isDraft = sop?.status === "draft";
  const approve = useMutation({
    mutationFn: () => api<SOP>(`/api/sops/${sop!.id}`, "PATCH", { title, body, status: "active" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workKeys.sops });
      toast.success(tr("Approved. Agents in scope follow it from their next step."));
      onOpenChange(false);
    },
  });

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sop ? sop.title : t("New SOP")}
      description={sop ? `${sopScopeLabel(sop)} · ${t("version {n}", { n: sop.version })} · ${t("updated {when}", { when: timeAgo(sop.updated_at).toLowerCase() })}` : t("Agents read SOPs before every step, so they follow them without being reminded.")}
      actions={canManage ? (
        <>
          {isDraft ? (
            <>
              <Button size="sm" loading={approve.isPending} disabled={!title.trim()} onClick={() => approve.mutate()}><CheckCircleIcon size={15} /> {t("Approve")}</Button>
              {view === "preview" ? <Button size="sm" variant="outline" onClick={() => setView("write")}><PencilSimpleIcon size={14} /> {t("Edit before approving")}</Button> : null}
            </>
          ) : null}
          <Button size="sm" variant={isDraft ? "outline" : "primary"} loading={save.isPending} disabled={!title.trim() || needsTarget} onClick={() => save.mutate()}>
            {isDraft ? t("Save draft") : sop ? t("Save new version") : t("Create SOP")}
          </Button>
          {sop ? <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}><TrashIcon size={14} /> {t("Delete")}</Button> : null}
          {sop ? <PinButton kind="sop" refId={sop.id} title={sop.title} /> : null}
        </>
      ) : sop ? (
        <PinButton kind="sop" refId={sop.id} title={sop.title} withLabel />
      ) : null}
    >
      <div className="grid gap-4">
        {isDraft ? (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 px-3 py-2.5 text-[12.5px]">
            <Pill tone="warn">{t("Draft")}</Pill>
            <span className="min-w-0">{t("Written by AI from your documents. Agents don't see it until someone approves it. Check the steps, amounts and deadlines against the source first.")}</span>
          </div>
        ) : null}
        {sop?.source_files?.length ? (
          <p className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-muted">
            <FileTextIcon size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{t("Built from: {names}", { names: sop.source_files.map((f) => f.name).join(", ") })}</span>
          </p>
        ) : null}
        <Field label={t("Title")} value={title} disabled={!canManage} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Month-end close")} />
        {!sop ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t("Who follows it")}</legend>
              <RadioGroup.Root value={scope} onValueChange={(v) => { setScope(v as Scope); setScopeId(null); }} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {SCOPES.map((s) => (
                  <RadioGroup.Item key={s.value} value={s.value} className="flex min-w-0 items-start gap-2.5 rounded-sm border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
                    <IconTile icon={SCOPE_LOOK[s.value].icon} tone={SCOPE_LOOK[s.value].tone} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{t(s.label)}</span>
                      <span className="block text-[12px] text-muted">{t(s.hint)}</span>
                    </span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </fieldset>
            {scope === "branch" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label={t("Branch")} placeholder={t("Pick a company")} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : scope === "department" ? (
              <Select value={scopeId ?? ""} onValueChange={setScopeId} label={t("Department")} placeholder={t("Pick a department")} options={departments} />
            ) : null}
          </>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium">{t("Procedure")}</span>
            {canManage ? (
              <Segmented<"write" | "preview"> label={t("Editor view")} size="sm" value={view} onChange={setView}
                options={[{ value: "write", label: t("Write") }, { value: "preview", label: t("Preview") }]} />
            ) : null}
          </div>
          {view === "write" && canManage ? (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18} aria-label={t("Procedure (Markdown)")}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          ) : (
            <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"><Markdown>{body || t("_Empty_")}</Markdown></div>
          )}
          <p className="text-[12px] text-muted">{t("Markdown: ## headings, - lists, 1. steps, **bold**, tables.")}</p>
        </div>
        <FormError message={save.error ? errorMessage(save.error) : approve.error ? errorMessage(approve.error) : null} />
      </div>
      {sop ? (
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete {name}?", { name: sop.title })} danger confirmLabel={t("Delete SOP")}
          body={t("Agents stop following it immediately and it is detached from every agent.")}
          onConfirm={async () => {
            try {
              await api(`/api/sops/${sop.id}`, "DELETE");
              qc.invalidateQueries({ queryKey: workKeys.sops });
              toast.success(tr("SOP deleted."));
              onOpenChange(false);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }} />
      ) : null}
    </SideSheet>
  );
}

export function SopsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const { data: sops, isLoading, error, refetch } = useQuery(sopsQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const search = useSearch({ strict: false }) as { sop?: string };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(0);
  const openSop = sops?.find((s) => s.id === search.sop) ?? null;
  // P107: a data table. Search, who follows it, company and draft filters, sortable columns
  // and numbered pages; the address keeps them, so closing a SOP returns to the same rows.
  const control = useTableState({ size: 25, sort: "scope" }, { filters: ["scope", "company", "status"] });
  const [scope] = filterOf(control, "scope");
  const [company] = filterOf(control, "company");
  const [status] = filterOf(control, "status");
  const all = useMemo(() => sops ?? [], [sops]);
  const rows = useMemo(() => {
    const branch = company ? branches.find((b) => b.id === company) ?? null : null;
    const inCompany = new Set((branch ? sopsForCompany(all, branch) : all).map((s) => s.id));
    return all.filter((s) => (!scope || s.scope === scope) && (!status || (s.status ?? "active") === status) && inCompany.has(s.id));
  }, [all, scope, status, company, branches]);
  const drafts = all.filter((s) => s.status === "draft").length;
  const open = (s: SOP) => navigate({ to: "/sops", search: ((p: Record<string, unknown>) => ({ ...p, sop: s.id })) as never });

  // P81: pick many SOPs (those listed now) and delete them in one go.
  const qc = useQueryClient();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // P107: "Delete ticked" (the table's bulk bar and confirmation) deletes them in one call; what
  // the server skips comes back as not done, with why.
  const deleteTicked = async (list: SOP[]): Promise<BulkOutcome> => {
    try {
      const r = await bulkDelete({ sops: list.map((s) => s.id) });
      return { done: r.sops, failed: r.skipped.map((x) => ({ id: x.id, message: x.reason === "not_found" ? tr("Already gone.") : tr("Not yours to delete.") })) };
    } finally {
      void qc.invalidateQueries({ queryKey: workKeys.sops });
      void qc.invalidateQueries({ queryKey: libraryKeys.all });
    }
  };

  const columns: Column<SOP>[] = [
    {
      id: "title", header: t("SOP"), card: "title", sortValue: (s) => s.title.toLowerCase(), exportValue: (s) => s.title,
      cell: (s) => {
        const look = SCOPE_LOOK[s.scope];
        return (
          <span className="flex min-w-0 items-center gap-3">
            <IconTile icon={look.icon} tone={look.tone} size="sm" />
            <span className="min-w-0 text-[13.5px] font-medium break-words">{s.title}</span>
            {s.status === "draft" ? <Pill tone="warn">{t("Draft")}</Pill> : null}
          </span>
        );
      },
    },
    {
      id: "scope", header: t("Who follows it"), sortValue: (s) => `${SCOPE_ORDER[s.scope]} ${sopScopeLabel(s).toLowerCase()}`, exportValue: (s) => sopScopeLabel(s),
      cell: (s) => (
        <span className="grid min-w-0">
          <span className="break-words">{sopScopeLabel(s)}</span>
          <span className="text-[12px] text-muted">{t(SCOPES.find((x) => x.value === s.scope)!.label)}</span>
        </span>
      ),
    },
    { id: "status", header: t("Status"), exportOnly: true, cell: () => null, exportValue: (s) => (s.status === "draft" ? t("Draft") : t("In use")) },
    { id: "version", header: t("Version"), kind: "number", align: "right", hideBelow: "lg", sortValue: (s) => s.version, cell: (s) => `v${s.version}` },
    {
      id: "updated", header: t("Updated"), kind: "date", sortValue: (s) => s.updated_at,
      cell: (s) => <span className="text-muted">{timeAgo(s.updated_at)}</span>,
    },
  ];

  return (
    <Page>
      <LibraryHeader tab="/sops"
        actions={<>
          {/* P24: turn a company's uploaded procedures into SOPs from Company files. */}
          <Button variant="ghost" asChild><Link to="/explorer">{t("Upload in Browse →")}</Link></Button>
          {canManage ? <Button data-guide="sops.new" onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("New SOP")}</Button> : null}
        </>} />
      {!isLoading && !error && !all.length ? (
        <EmptyState icon={FileTextIcon} title={t("No SOPs yet")} body={t("Write down how your company does things once (month-end close, quotation checks, report formats) and every agent in scope follows it.")}
          action={canManage ? <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("Write the first SOP")}</Button> : undefined} />
      ) : (
        <div data-guide="sops.list" className="grid min-w-0">
          <DataTable
            label={t("SOPs")}
            columns={columns}
            rows={rows}
            rowId={(s) => s.id}
            rowLabel={(s) => s.title}
            control={control}
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            searchText={(s) => `${s.title} ${sopScopeLabel(s)}`}
            searchPlaceholder={t("Search SOPs")}
            onOpen={open}
            rowClassName={(s) => (s.id === search.sop ? "bg-accent-soft/40" : undefined)}
            filters={
              <>
                <TableFilter control={control} id="scope" label={t("Who follows it")} allLabel={t("Every scope")}
                  options={SCOPES.map((sc) => ({ value: sc.value, label: t(sc.label) }))} />
                {branches.length > 1 ? (
                  <TableFilter control={control} id="company" label={t("Company")} allLabel={t("All companies")}
                    options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                ) : null}
                {drafts || status ? (
                  <TableFilter control={control} id="status" label={t("Status")} allLabel={t("All statuses")}
                    options={[{ value: "active", label: t("In use") }, { value: "draft", label: t("Drafts") }]} />
                ) : null}
              </>
            }
            selection={canManage ? { selected: ticked, onChange: setTicked } : undefined}
            exportName={t("sops")}
            rowActions={{
              view: open,
              ...(canManage ? {
                remove: async (s: SOP) => {
                  await api(`/api/sops/${s.id}`, "DELETE");
                  void qc.invalidateQueries({ queryKey: workKeys.sops });
                  void qc.invalidateQueries({ queryKey: libraryKeys.all });
                },
                removeBody: () => t("Agents stop following it immediately and it is detached from every agent."),
              } : {}),
            }}
            bulkRemove={canManage ? {
              run: (list) => deleteTicked(list),
              title: (n) => (n === 1 ? t("Delete 1 SOP?") : t("Delete {n} SOPs?", { n })),
              body: t("Agents stop following them immediately and they are detached from every agent. This cannot be undone."),
            } : undefined}
          />
        </div>
      )}
      {openSop ? <Editor key={openSop.id + openSop.version} sop={openSop} open canManage={canManage}
        onOpenChange={(o) => !o && navigate({ to: "/sops", search: ((p: Record<string, unknown>) => ({ ...p, sop: undefined })) as never })} /> : null}
      {creating ? <Editor key={`new-${creating}`} sop={null} open canManage={canManage} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}
