import {
  BuildingsIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TreeStructureIcon,
  UsersIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, eachRow, filterOf, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, t as tr, useLang, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import {
  DATA_LEVELS,
  dataLevelOf,
  LEVEL_HINT,
  LEVEL_LABEL,
  LOCAL_ONLY_LIMIT,
  patchBranchDataLevel,
  privacyKeys,
  type DataLevel,
} from "@/lib/privacy";
import { branchesQuery, keys, meQuery, membersQuery } from "@/lib/queries";
import type { Branch, Department, Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";
import { branchIdsOf, MEMBER_FILTERS, MembersTable } from "@/pages/members";
import { StarterTeamDialog, StarterTeamFields, teamToast, type StarterResult } from "@/pages/org-starter";
import { addToPrimaAfterCreate, draftReady, emptyDraft, NewCompanyPrima, PRIMA_COMPANIES_KEY, PrimaLinkCell } from "@/pages/org-prima";
import { DepartmentReviewDialog } from "@/pages/tasks/accountable";
import { OrgChartView } from "@/pages/org-chart";

const INDUSTRY_LABELS: Record<string, string> = {
  general: msg("General business"),
  network: msg("Network, IT & telecom"),
  engineering: msg("Engineering & construction"),
  trading: msg("Trading & retail"),
  professional: msg("Professional services"),
  security: msg("Security & guarding services"),
};
const industryLabel = (k: string) => {
  const label = INDUSTRY_LABELS[k];
  return label ? tr(label) : k;
};
/** The company's industry (P19); older API builds do not send it. */
const industryOf = (b: Branch) => b.industry ?? "";

const SWATCHES = ["#13895f", "#2f6db5", "#b7791f", "#c2412d", "#7a5af5", "#0f8ba0", "#5b6b2f", "#b04a87"];

function useOrgMutation<T>(fn: (vars: T) => Promise<unknown>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.branches });
      qc.invalidateQueries({ queryKey: keys.status });
      if (success) toast.success(success);
    },
  });
}

function BranchDialog({ open, onOpenChange, branch }: { open: boolean; onOpenChange: (o: boolean) => void; branch?: Branch }) {
  const t = useT();
  // Callers remount this with a fresh `key` each time it opens, so state starts clean.
  const editing = !!branch;
  const [name, setName] = useState(branch?.name ?? "");
  const [color, setColor] = useState(branch?.color ?? SWATCHES[0]!);
  // P36: the ready-made team brings the departments it works in; the generic set on top of
  // it only added empty departments (where sorted documents were then out of every agent's reach).
  const [seed, setSeed] = useState(false);
  const [isolated, setIsolated] = useState(branch?.isolated ?? false);
  // P19: what the company does, and a ready-made AI team for it (on by default).
  const [industry, setIndustry] = useState("general");
  const [team, setTeam] = useState(true);
  // P111: add it to Prima now, with its SSM details (else it is linked by name, or later).
  const [toPrima, setToPrima] = useState(false);
  const [primaDraft, setPrimaDraft] = useState(emptyDraft);
  const qc = useQueryClient();

  const save = useOrgMutation(
    () =>
      editing
        ? api(`/api/branches/${branch.id}`, "PATCH", { name, color, isolated })
        : api<Branch & { starter?: StarterResult | null }>("/api/branches", "POST", {
            name,
            color,
            isolated,
            seed_departments: seed,
            industry,
            starter_team: team,
          }),
    editing ? t("Company updated.") : undefined,
  );
  const create = () =>
    save.mutate(undefined, {
      onSuccess: (r) => {
        onOpenChange(false);
        // P111: the Prima link (linked by name, added, or a rename that followed) changed too.
        const primaLinks = () => void qc.invalidateQueries({ queryKey: PRIMA_COMPANIES_KEY });
        const made = r as Branch & { starter?: StarterResult | null };
        if (!editing && toPrima && draftReady(primaDraft)) void addToPrimaAfterCreate(made.id, made.name, primaDraft, primaLinks);
        else primaLinks();
        if (editing) return;
        if (made.starter) {
          qc.invalidateQueries({ queryKey: workKeys.agents });
          toast.success(t("{name} created. {team}", { name: made.name, team: teamToast(made.starter, made.name) }));
        } else toast.success(t("Company created."));
      },
    });
  const fieldError = save.error instanceof ApiError ? save.error.fields.name : undefined;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("Edit company") : t("New company")}
      description={editing ? undefined : t("Each company has its own departments, AI team, office and knowledge. Pick what it does and a team that fits is hired for you.")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim() || (!editing && toPrima && !draftReady(primaDraft))}
            onClick={create}
          >
            {editing ? t("Save") : t("Create company")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        {/* P111: organization names are in capitals (the API saves them so). */}
        <Field label={t("Company name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Syarikat Maju Sdn Bhd")} error={fieldError} autoFocus
          hint={t("Saved in capital letters.")} className="[&_input]:uppercase [&_input]:placeholder:normal-case" />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-[13px] font-medium">{t("Color")}</legend>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t("Color {code}", { code: c })}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={cn("size-9 rounded-full ring-offset-2 ring-offset-surface transition-shadow", c === color ? "ring-2 ring-fg" : "hover:ring-2 hover:ring-border")}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        {!editing ? (
          <SwitchField checked={seed} onCheckedChange={setSeed} label={t("Also add the standard departments")} hint={t("Management, Finance, Research, Operations, Data and Writing. Not needed with a ready-made team: it brings its own departments.")} />
        ) : null}
        {!editing ? <StarterTeamFields industry={industry} onIndustry={setIndustry} enabled={team} onEnabled={setTeam} /> : null}
        {!editing ? <NewCompanyPrima name={name} on={toPrima} onOn={setToPrima} draft={primaDraft} onDraft={setPrimaDraft} /> : null}
        <SwitchField checked={isolated} onCheckedChange={setIsolated} label={t("Keep this company's knowledge private")} hint={t("Agents in other branches will not see this branch's SOPs, facts or notes.")} />
        <FormError message={save.error && !fieldError ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function DepartmentChip({ dept, canManage }: { dept: Department; canManage: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dept.name);
  const rename = useOrgMutation(() => api(`/api/departments/${dept.id}`, "PATCH", { name }));
  const remove = useOrgMutation(() => api(`/api/departments/${dept.id}`, "DELETE"), t("{name} removed.", { name: dept.name }));

  if (editing) {
    return (
      <form
        className="flex min-h-9 items-center gap-1 rounded-full border border-accent bg-surface py-0.5 pr-1 pl-3 ring-3 ring-accent/15"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || name === dept.name) return setEditing(false);
          rename.mutate(undefined, { onSuccess: () => setEditing(false), onError: (err) => toast.error(errorMessage(err)) });
        }}
      >
        <input
          autoFocus
          aria-label={t("Department name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !rename.isPending && setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="w-28 bg-transparent text-[13px] outline-none"
        />
      </form>
    );
  }

  // Rename/remove are always visible on touch screens; with a mouse they appear on
  // hover or keyboard focus, so idle chips stay tight.
  return (
    <span className="group inline-flex min-h-9 max-w-full items-center gap-0.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-[13px] transition-colors hover:border-accent/40 [@media(hover:hover)]:pr-3 [@media(hover:hover)]:hover:pr-1 [@media(hover:hover)]:focus-within:pr-1">
      <span className="min-w-0 break-words">{dept.name}</span>
      {canManage ? (
        <span className="flex items-center [@media(hover:hover)]:hidden [@media(hover:hover)]:group-focus-within:flex [@media(hover:hover)]:group-hover:flex">
          <button type="button" aria-label={t("Rename {name}", { name: dept.name })} onClick={() => { setName(dept.name); setEditing(true); }} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg [@media(hover:hover)]:size-7">
            <PencilSimpleIcon size={12} />
          </button>
          <button
            type="button"
            aria-label={t("Remove {name}", { name: dept.name })}
            onClick={() => remove.mutate(undefined, { onError: (err) => toast.error(errorMessage(err)) })}
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger [@media(hover:hover)]:size-7"
          >
            <XIcon size={12} />
          </button>
        </span>
      ) : null}
    </span>
  );
}

function AddDepartment({ branchId }: { branchId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = useOrgMutation(() => api(`/api/branches/${branchId}/departments`, "POST", { name }));
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent">
        <PlusIcon size={12} /> {t("Department")}
      </button>
    );
  }
  return (
    <form
      className="inline-flex min-h-9 items-center rounded-full border border-accent bg-surface py-0.5 pr-1 pl-3 ring-3 ring-accent/15"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setOpen(false);
        add.mutate(undefined, {
          onSuccess: () => { setName(""); setOpen(false); },
          onError: (err) => toast.error(errorMessage(err)),
        });
      }}
    >
      <input
        autoFocus
        aria-label={t("New department name")}
        placeholder={t("Legal")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="w-28 bg-transparent text-[13px] outline-none placeholder:text-muted"
      />
    </form>
  );
}

/**
 * P33: which AI providers may see this company's work. Standard masks private details for any
 * provider; Confidential keeps to trusted providers; Local only never leaves the server.
 */
function DataProtection({ branch, canManage }: { branch: Branch & { data_level?: DataLevel | null }; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (level: DataLevel) => patchBranchDataLevel(branch.id, level),
    onSuccess: (_r, level) => {
      qc.invalidateQueries({ queryKey: keys.branches });
      qc.invalidateQueries({ queryKey: privacyKeys.settings });
      toast.success(t("{name} is now {level}.", { name: branch.name, level: t(LEVEL_LABEL[level]) }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Older API builds do not send a data level: nothing to show yet.
  if (!("data_level" in branch)) return null;
  const level = save.isPending && save.variables ? save.variables : dataLevelOf(branch);
  return (
    <div className="grid gap-2 border-t border-border px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] sm:items-start sm:gap-4 sm:px-5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
          <ShieldCheckIcon size={15} weight="duotone" className="shrink-0 text-accent" /> {t("Data protection")}
        </p>
        <p className="text-[12.5px] text-muted">{t(LEVEL_HINT[level])}</p>
        {level === "local_only" ? <p className="mt-1 text-[12.5px] text-warn">{t(LOCAL_ONLY_LIMIT)}</p> : null}
      </div>
      <Select
        size="sm"
        label={t("Data protection for {name}", { name: branch.name })}
        value={level}
        disabled={!canManage || save.isPending}
        onValueChange={(v) => v !== dataLevelOf(branch) && save.mutate(v as DataLevel)}
        options={DATA_LEVELS.map((l) => ({ value: l, label: t(LEVEL_LABEL[l]), hint: t(LEVEL_HINT[l]) }))}
        className="w-full"
      />
    </div>
  );
}


function CompanyTile({ branch, size = "md" }: { branch: Branch; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] text-white shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.15)]", size === "sm" ? "size-3 rounded-full" : "size-9")}
      style={{ background: branch.color }}
    >
      {size === "md" ? <BuildingsIcon size={18} weight="duotone" /> : null}
    </span>
  );
}

/** The pills that say how a company keeps its knowledge and data. */
function CompanyPills({ branch }: { branch: Branch }) {
  const t = useT();
  const level = dataLevelOf(branch);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {branch.isolated ? (
        <Pill tone="info"><LockSimpleIcon size={12} weight="bold" /> {t("Private knowledge")}</Pill>
      ) : (
        <Pill>{t("Shared knowledge")}</Pill>
      )}
      {level !== "standard" ? (
        <Pill tone={level === "local_only" ? "warn" : "info"}><ShieldCheckIcon size={12} weight="bold" /> {t(LEVEL_LABEL[level])}</Pill>
      ) : null}
    </span>
  );
}

/** P107: where Organization's tables point each other (a count opens the list it counts). */
type View = "companies" | "departments" | "members" | "hierarchy"; // P111: the chart
type Go = (view: View, filters?: Record<string, string>) => void;

/** P107: counts of people per company and per department, from the plain members list (the
 * one the people pickers read). Null while it loads or when this person does not manage people. */
interface Counts { byBranch: Map<string, number>; byDept: Map<string, number>; total: number }

function useCounts(enabled: boolean): Counts | null {
  const { data } = useQuery({ ...membersQuery, enabled });
  return useMemo(() => {
    if (!enabled || !data) return null;
    const byBranch = new Map<string, number>();
    const byDept = new Map<string, number>();
    for (const m of data) {
      for (const id of branchIdsOf(m)) byBranch.set(id, (byBranch.get(id) ?? 0) + 1);
      if (m.department_id) byDept.set(m.department_id, (byDept.get(m.department_id) ?? 0) + 1);
    }
    return { byBranch, byDept, total: data.length };
  }, [enabled, data]);
}

/** P107: the Prima company each branch is linked to (Prima > Prima companies; owners and
 * admins only). Null when Prima is not set up here or cannot be reached. */
function usePrimaLinks(enabled: boolean): Map<string, string | null> | null {
  const { data } = useQuery({
    queryKey: ["prima", "companies"],
    queryFn: () => api<{ companies: { id: string; name: string }[]; branches: { id: string; company_id: string | null }[] }>("/api/prima/companies"),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    if (!enabled || !data?.branches) return null;
    const names = new Map(data.companies.map((c) => [c.id, c.name]));
    return new Map(data.branches.map((b) => [b.id, b.company_id ? (names.get(b.company_id) ?? b.company_id) : null]));
  }, [enabled, data]);
}

/** A count that opens the list it counts. */
function CountLink({ n, label, onClick }: { n: number | undefined; label: string; onClick?: () => void }) {
  if (n === undefined) return <span className="text-muted">-</span>;
  if (!onClick || !n) return <span className={cn("tabular", !n && "text-muted")}>{n}</span>;
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="hit rounded-sm font-medium text-accent tabular hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none">
      {n}
    </button>
  );
}

/** P107: one company opened from the table: its departments (add, rename, remove), its data
 * protection, and a way to its people. */
function CompanySheet({ branch, canManage, seesMembers, people, onEdit, go, onClose }: {
  branch: Branch;
  canManage: boolean;
  seesMembers: boolean;
  people: number | undefined;
  onEdit: () => void;
  go: Go;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md"
      title={<span className="flex min-w-0 items-center gap-3"><CompanyTile branch={branch} /><span className="min-w-0 break-words">{branch.name}</span></span>}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{branch.departments.length === 1 ? t("1 department") : t("{n} departments", { n: branch.departments.length })}</span>
          {industryOf(branch) ? <Pill tone="accent">{industryLabel(industryOf(branch))}</Pill> : null}
          <CompanyPills branch={branch} />
        </span>
      }
      actions={canManage ? <Button variant="outline" size="sm" onClick={onEdit}><PencilSimpleIcon size={14} /> {t("Edit")}</Button> : undefined}>
      <div className="grid gap-5">
        <section className="grid gap-2">
          <h3 className="text-[13.5px] font-semibold">{t("Departments")}</h3>
          <div className="flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
            {branch.departments.map((d) => <DepartmentChip key={d.id} dept={d} canManage={canManage} />)}
            {canManage ? <AddDepartment branchId={branch.id} /> : null}
            {!branch.departments.length && !canManage ? <p className="text-[13px] text-muted">{t("No departments yet.")}</p> : null}
          </div>
          {canManage ? (
            <p className="text-[12px] text-muted">
              <span className="[@media(hover:hover)]:hidden">{t("Tap the pencil to rename a department.")}</span>
              <span className="hidden [@media(hover:hover)]:inline">{t("Hover a department to rename or remove it.")}</span>
            </p>
          ) : null}
        </section>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-border [&>div]:border-t-0">
          <DataProtection branch={branch} canManage={canManage} />
        </div>
        {seesMembers ? (
          <div>
            <Button variant="outline" onClick={() => { onClose(); go("members", { m_company: branch.id }); }}>
              <UsersIcon size={16} /> {people === undefined ? t("See its members") : people === 1 ? t("See its 1 member") : t("See its {n} members", { n: people })}
            </Button>
          </div>
        ) : null}
      </div>
    </SideSheet>
  );
}

/** P107: rename a department from the departments table. */
function RenameDepartmentDialog({ dept, onClose }: { dept: Department; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(dept.name);
  const rename = useOrgMutation(() => api(`/api/departments/${dept.id}`, "PATCH", { name }));
  const save = () => {
    if (!name.trim() || name === dept.name) return onClose();
    rename.mutate(undefined, { onSuccess: onClose });
  };
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Rename {name}", { name: dept.name })}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={rename.isPending} disabled={!name.trim()} onClick={save}>{t("Save")}</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={t("Department name")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <FormError message={rename.error ? errorMessage(rename.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

/** P107: add a department to any company from the departments table. */
function AddDepartmentDialog({ branches, initialBranch, onClose }: { branches: Branch[]; initialBranch: string; onClose: () => void }) {
  const t = useT();
  const [branchId, setBranchId] = useState(initialBranch || branches[0]?.id || "");
  const [name, setName] = useState("");
  const add = useOrgMutation(() => api(`/api/branches/${branchId}/departments`, "POST", { name }), t("Department added."));
  const save = () => {
    if (!name.trim() || !branchId) return;
    add.mutate(undefined, { onSuccess: onClose });
  };
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("New department")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={add.isPending} disabled={!name.trim() || !branchId} onClick={save}>{t("Add department")}</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Company")}</span>
          <SearchSelect label={t("Company")} value={branchId} onValueChange={setBranchId} searchPlaceholder={t("Search companies")}
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </div>
        <Field label={t("Department name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Legal")} autoFocus />
        <FormError message={add.error ? errorMessage(add.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}

function useRefreshOrg() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.branches });
    void qc.invalidateQueries({ queryKey: keys.status });
  };
}

const date = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

/** P107: every company as a table row; a row opens its sheet. */
function CompaniesTable({ branches, canManage, seesMembers, counts, prima, go }: {
  branches: Branch[];
  canManage: boolean;
  seesMembers: boolean;
  counts: Counts | null;
  prima: Map<string, string | null> | null;
  go: Go;
}) {
  const t = useT();
  const refresh = useRefreshOrg();
  const control = useTableState({ size: 25 }, { filters: ["prima", "people", "industry", "knowledge"] });
  const [linked] = filterOf(control, "prima");
  const [people] = filterOf(control, "people");
  const [industry] = filterOf(control, "industry");
  const [knowledge] = filterOf(control, "knowledge");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ branch: Branch; key: number } | null>(null);
  const [team, setTeam] = useState<{ branch: Branch; key: number } | null>(null);
  const [review, setReview] = useState<{ branch: Branch; key: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const nth = useRef(0);
  const next = () => (nth.current += 1);
  const peopleOf = (b: Branch) => counts?.byBranch.get(b.id) ?? (counts ? 0 : undefined);
  const primaOf = (b: Branch) => prima?.get(b.id) ?? null;
  const industries = [...new Set(branches.map(industryOf).filter(Boolean))].sort((a, b) => industryLabel(a).localeCompare(industryLabel(b)));
  const rows = branches.filter((b) =>
    (!linked || !prima || (linked === "yes") === !!primaOf(b))
    && (!people || !counts || (people === "yes") === !!peopleOf(b))
    && (!industry || industryOf(b) === industry)
    && (!knowledge || (knowledge === "private") === b.isolated));
  const first = branches[0]?.id;
  const opened = branches.find((b) => b.id === open);
  const remove = (b: Branch) => api(`/api/branches/${b.id}`, "DELETE");

  const columns: Column<Branch>[] = [
    {
      id: "name", header: t("Company"), sortValue: (b) => b.name, card: "title",
      cell: (b) => (
        <span data-guide={b.id === first ? "organization.company" : undefined} className="flex min-w-0 items-center gap-3">
          <CompanyTile branch={b} />
          <span className="min-w-0 text-[13.5px] font-semibold break-words">{b.name}</span>
        </span>
      ),
    },
    {
      id: "code", header: t("Short name"), sortValue: (b) => b.slug, hideBelow: "lg", card: "hide",
      cell: (b) => <span className="font-mono text-[12.5px] break-all text-muted">{b.slug}</span>,
    },
    ...(prima ? [{
      id: "prima", header: t("Prima company"), sortValue: (b: Branch) => primaOf(b), exportValue: (b: Branch) => primaOf(b) ?? "",
      cell: (b: Branch) => <PrimaLinkCell branchId={b.id} name={primaOf(b)} canManage={canManage} />, // P111
    } satisfies Column<Branch>] : []),
    {
      id: "departments", header: t("Departments"), kind: "number", align: "right", sortValue: (b) => b.departments.length,
      cell: (b) => <CountLink n={b.departments.length} label={t("Departments of {name}", { name: b.name })} onClick={() => go("departments", { d_company: b.id })} />,
    },
    ...(counts ? [{
      id: "members", header: t("Members"), kind: "number", align: "right", sortValue: (b: Branch) => peopleOf(b),
      cell: (b: Branch) => <CountLink n={peopleOf(b)} label={t("Members of {name}", { name: b.name })} onClick={() => go("members", { m_company: b.id })} />,
    } satisfies Column<Branch>] : []),
    {
      id: "industry", header: t("What it does"), sortValue: (b) => (industryOf(b) ? industryLabel(industryOf(b)) : null), hideBelow: "2xl", card: "hide",
      cell: (b) => (industryOf(b) ? <Pill tone="accent" className="max-w-full"><span className="truncate">{industryLabel(industryOf(b))}</span></Pill> : <span className="text-muted">-</span>),
    },
    {
      id: "knowledge", header: t("Knowledge and data"), hideBelow: "xl", card: "hide",
      sortValue: (b) => (b.isolated ? 1 : 0) + DATA_LEVELS.indexOf(dataLevelOf(b)) * 2,
      exportValue: (b) => [b.isolated ? t("Private knowledge") : t("Shared knowledge"), t(LEVEL_LABEL[dataLevelOf(b)])].join("; "),
      cell: (b) => <CompanyPills branch={b} />,
    },
    {
      id: "created", header: t("Added"), kind: "date", sortValue: (b) => b.created_at, hideBelow: "2xl", card: "hide",
      cell: (b) => <span className="text-muted tabular">{date(b.created_at)}</span>,
    },
  ];

  return (
    <>
      <DataTable
        label={t("Companies")}
        columns={columns}
        rows={rows}
        rowId={(b) => b.id}
        rowLabel={(b) => b.name}
        control={control}
        searchText={(b) => `${b.name} ${b.slug} ${primaOf(b) ?? ""} ${industryOf(b) ? industryLabel(industryOf(b)) : ""} ${b.departments.map((d) => d.name).join(" ")}`}
        searchPlaceholder={t("Search companies or departments")}
        onOpen={(b) => setOpen(b.id)}
        filters={
          <>
            {prima ? (
              <TableFilter control={control} id="prima" label={t("Prima link")} allLabel={t("Linked or not")}
                options={[{ value: "yes", label: t("Linked to Prima") }, { value: "no", label: t("Not linked to Prima") }]} />
            ) : null}
            {counts ? (
              <TableFilter control={control} id="people" label={t("Members")} allLabel={t("With or without members")}
                options={[{ value: "yes", label: t("Has members") }, { value: "no", label: t("No members") }]} />
            ) : null}
            {industries.length > 1 ? (
              <TableFilter control={control} id="industry" label={t("What it does")} allLabel={t("Every kind of business")}
                options={industries.map((k) => ({ value: k, label: industryLabel(k) }))} />
            ) : null}
            <TableFilter control={control} id="knowledge" label={t("Knowledge")} allLabel={t("Shared or private")}
              options={[{ value: "shared", label: t("Shared knowledge") }, { value: "private", label: t("Private knowledge") }]} />
          </>
        }
        exportName={t("companies")}
        rowActions={{
          view: (b) => setOpen(b.id),
          ...(canManage ? {
            edit: (b: Branch) => setEditing({ branch: b, key: next() }),
            more: (b: Branch) => (
              <>
                <MenuItem icon={<UsersThreeIcon />} onSelect={() => setTeam({ branch: b, key: next() })}>{t("Add ready-made AI team")}</MenuItem>
                <MenuItem icon={<ShieldCheckIcon />} onSelect={() => setReview({ branch: b, key: next() })}>{t("Review stages")}</MenuItem>
              </>
            ),
            remove: async (b: Branch) => {
              await remove(b);
              refresh();
            },
            removeBody: (b: Branch) => t("This removes the branch and its {n} departments. It cannot be undone.", { n: b.departments.length }),
          } : {}),
        }}
        selection={canManage ? { selected, onChange: setSelected } : undefined}
        bulkRemove={canManage ? {
          run: async (list) => {
            const out = await eachRow(list, (b) => b.id, remove);
            refresh();
            return out;
          },
          title: (n) => (n === 1 ? t("Delete 1 company?") : t("Delete {n} companies?", { n })),
          body: t("Each goes with its departments. It cannot be undone."),
        } : undefined}
      />
      {opened ? (
        <CompanySheet branch={opened} canManage={canManage} seesMembers={seesMembers} people={peopleOf(opened)} go={go}
          onEdit={() => setEditing({ branch: opened, key: next() })} onClose={() => setOpen(null)} />
      ) : null}
      {editing ? <BranchDialog key={editing.key} open onOpenChange={(o) => !o && setEditing(null)} branch={editing.branch} /> : null}
      {review ? <DepartmentReviewDialog key={review.key} departments={review.branch.departments} open onOpenChange={(o) => !o && setReview(null)} /> : null}
      {team ? (
        <StarterTeamDialog key={`team-${team.key}`} open onOpenChange={(o) => !o && setTeam(null)}
          branchId={team.branch.id} branchName={team.branch.name} initialIndustry={industryOf(team.branch)} />
      ) : null}
    </>
  );
}

type DeptRow = Department & { branch: Branch };

/** P107: every department of every company as one table. */
function DepartmentsTable({ branches, canManage, counts, go, onOpenCompany }: {
  branches: Branch[];
  canManage: boolean;
  counts: Counts | null;
  go: Go;
  onOpenCompany: (id: string) => void;
}) {
  const t = useT();
  const refresh = useRefreshOrg();
  const control = useTableState({ size: 25, sort: "company" }, { prefix: "d_", filters: ["company"] });
  const [company] = filterOf(control, "company");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Department | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const all = useMemo(() => branches.flatMap((b) => b.departments.map((d): DeptRow => ({ ...d, branch: b }))), [branches]);
  const rows = company ? all.filter((d) => d.branch_id === company) : all;
  const peopleOf = (d: DeptRow) => counts?.byDept.get(d.id) ?? (counts ? 0 : undefined);
  const remove = (d: DeptRow) => api(`/api/departments/${d.id}`, "DELETE");
  const columns: Column<DeptRow>[] = [
    { id: "name", header: t("Department"), sortValue: (d) => d.name, card: "title", cell: (d) => <span className="text-[13.5px] font-medium break-words">{d.name}</span> },
    {
      id: "company", header: t("Company"), sortValue: (d) => `${d.branch.name}\u0000${String(d.position).padStart(4, "0")}`, exportValue: (d) => d.branch.name,
      cell: (d) => <span className="flex min-w-0 items-center gap-2"><CompanyTile branch={d.branch} size="sm" /><span className="min-w-0 break-words">{d.branch.name}</span></span>,
    },
    ...(counts ? [{
      id: "members", header: t("Members"), kind: "number", align: "right", sortValue: (d: DeptRow) => peopleOf(d),
      cell: (d: DeptRow) => <CountLink n={peopleOf(d)} label={t("Members of {name}", { name: d.name })} onClick={() => go("members", { m_company: d.branch_id, m_department: d.id })} />,
    } satisfies Column<DeptRow>] : []),
  ];
  return (
    <>
      <DataTable
        label={t("Departments")}
        columns={columns}
        rows={rows}
        rowId={(d) => d.id}
        rowLabel={(d) => d.name}
        control={control}
        searchText={(d) => `${d.name} ${d.branch.name}`}
        searchPlaceholder={t("Search departments")}
        filters={branches.length > 1 ? (
          <TableFilter control={control} id="company" label={t("Company")} allLabel={t("All companies")} searchable
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        ) : null}
        exportName={t("departments")}
        onAdd={canManage ? () => setAdding(true) : undefined}
        addLabel={t("Add department")}
        rowActions={{
          view: (d) => onOpenCompany(d.branch_id),
          ...(canManage ? {
            edit: (d: DeptRow) => setRenaming(d),
            remove: async (d: DeptRow) => {
              await remove(d);
              refresh();
            },
            removeBody: () => t("Its people, agents and SOPs stay in the company without a department. It cannot be undone."),
          } : {}),
        }}
        selection={canManage ? { selected, onChange: setSelected } : undefined}
        bulkRemove={canManage ? {
          run: async (list) => {
            const out = await eachRow(list, (d) => d.id, remove);
            refresh();
            return out;
          },
          title: (n) => (n === 1 ? t("Delete 1 department?") : t("Delete {n} departments?", { n })),
          body: t("Their people, agents and SOPs stay in their companies without a department. It cannot be undone."),
        } : undefined}
        empty={<p className="rounded-[var(--radius-md)] border border-dashed border-border px-6 py-10 text-center text-[13.5px] text-muted">{t("No departments yet.")}</p>}
      />
      {adding ? <AddDepartmentDialog branches={branches} initialBranch={company} onClose={() => setAdding(false)} /> : null}
      {renaming ? <RenameDepartmentDialog dept={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}

/** P107: everyone in the workspace (or one company), the same table as Settings > Members. */
function OrgMembers({ me }: { me: Me }) {
  const control = useTableState({ size: 25, sort: "name" }, { prefix: "m_", filters: MEMBER_FILTERS });
  return <MembersTable control={control} me={me} withAddImport />;
}

export function OrganizationPage() {
  const t = useT();
  // "Branches" is also the workflow word (Cabang); companies need their own Malay word.
  const lang = useLang((s) => s.lang);
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const seesMembers = me.permissions.includes("members.manage") || me.permissions.includes("team.manage");
  const { data: branches, isLoading, error } = useQuery(branchesQuery);
  const counts = useCounts(seesMembers);
  const prima = usePrimaLinks(canManage);
  const search = useSearch({ strict: false }) as { new?: number };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [openCompany, setOpenCompany] = useState<string | null>(null);
  const [editBranch, setEditBranch] = useState<{ branch: Branch; key: number } | null>(null);
  // P107: companies, departments and members are three tables; the address keeps which one shows.
  const raw = useRouterState({ select: (s) => (s.location.search as { view?: string }).view });
  const view: View = raw === "departments" ? "departments" : raw === "members" && seesMembers ? "members" : raw === "hierarchy" ? "hierarchy" : "companies";
  const focus = useRouterState({ select: (s) => (s.location.search as { focus?: string }).focus });
  const go: Go = (v, filters = {}) =>
    void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, ...filters, view: v === "companies" ? undefined : v })) as never, resetScroll: false });
  // "New branch" from the palette or switcher arrives as ?new=1.
  const createOpen = creating || (!!search.new && canManage);
  const openCreate = () => { setCreateKey((k) => k + 1); setCreating(true); };
  const setCreateOpen = (o: boolean) => {
    setCreating(o);
    if (!o && search.new) navigate({ to: "/organization", search: {}, replace: true });
  };
  const departments = branches?.reduce((n, b) => n + b.departments.length, 0) ?? 0;
  const opened = branches?.find((b) => b.id === openCompany);

  return (
    <Page wide>
      <PageHeader
        title={t("Organization")}
        description={t("Each company you run is a branch. Departments inside a branch hold its agents and SOPs.")}
        actions={canManage ? (
          <Button data-guide="organization.add" onClick={openCreate}>
            <PlusIcon size={16} weight="bold" /> {t("New branch")}
          </Button>
        ) : null}
      />

      {isLoading ? (
        <div className="grid gap-4">
          <StatGrid className="lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
          <Skeleton className="h-72 rounded-[var(--radius-md)]" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load branches.")} {errorMessage(error)}
        </div>
      ) : branches && branches.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <StatGrid className="lg:grid-cols-3">
            <Stat label={lang === "ms" ? t("Branches (companies)") : t("Branches")} value={branches.length} icon={BuildingsIcon} hint={t("One per company")}
              onClick={() => go("companies")} active={view === "companies"} />
            <Stat label={t("Departments")} value={departments} icon={TreeStructureIcon} tone="info" hint={t("Across every branch")}
              onClick={() => go("departments")} active={view === "departments"} />
            {seesMembers ? (
              <Stat label={t("Members")} value={counts?.total ?? "-"} icon={UsersIcon} tone="violet" hint={t("People who can sign in")}
                onClick={() => go("members")} active={view === "members"} className="max-lg:col-span-2" />
            ) : (
              <Stat label={t("Private knowledge")} value={branches.filter((b) => b.isolated).length} icon={LockSimpleIcon} tone="violet"
                hint={t("Branches that keep SOPs and facts to themselves")} className="max-lg:col-span-2" />
            )}
          </StatGrid>
          <Segmented<View> label={t("Show")} value={view} onChange={(v) => go(v)} className="justify-self-start"
            options={[
              { value: "companies", label: t("Companies"), count: branches.length },
              { value: "departments", label: t("Departments"), count: departments },
              ...(seesMembers ? [{ value: "members" as const, label: t("Members"), count: counts?.total }] : []),
              { value: "hierarchy", label: t("Hierarchy") },
            ]} />
          {view === "hierarchy" ? <OrgChartView key={focus ?? ""} me={me} initialFocus={focus} />
            : view === "members" ? <OrgMembers me={me} />
            : view === "departments" ? <DepartmentsTable branches={branches} canManage={canManage} counts={counts} go={go} onOpenCompany={setOpenCompany} />
              : <CompaniesTable branches={branches} canManage={canManage} seesMembers={seesMembers} counts={counts} prima={prima} go={go} />}
          {opened && view === "departments" ? (
            <CompanySheet branch={opened} canManage={canManage} seesMembers={seesMembers} people={counts ? (counts.byBranch.get(opened.id) ?? 0) : undefined} go={go}
              onEdit={() => setEditBranch({ branch: opened, key: Date.now() })} onClose={() => setOpenCompany(null)} />
          ) : null}
          {editBranch ? <BranchDialog key={editBranch.key} open onOpenChange={(o) => !o && setEditBranch(null)} branch={editBranch.branch} /> : null}
        </div>
      ) : (
        <EmptyState
          icon={BuildingsIcon}
          title={t("No branches yet")}
          body={t("Create one branch per company. Standard departments are added for you, and you can change them any time.")}
          action={canManage ? (
            <Button onClick={openCreate}>
              <PlusIcon size={16} weight="bold" /> {t("Create first branch")}
            </Button>
          ) : undefined}
        />
      )}
      <BranchDialog key={createKey} open={createOpen} onOpenChange={setCreateOpen} />
    </Page>
  );
}
