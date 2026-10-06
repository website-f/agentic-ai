import {
  BuildingsIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  TreeStructureIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { msg, t as tr, useLang, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { branchesQuery, keys, meQuery } from "@/lib/queries";
import type { Branch, Department } from "@/lib/types";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";
import { StarterTeamDialog, StarterTeamFields, teamToast, type StarterResult } from "@/pages/org-starter";
import { DepartmentReviewDialog } from "@/pages/tasks/accountable";

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
  const [seed, setSeed] = useState(true);
  const [isolated, setIsolated] = useState(branch?.isolated ?? false);
  // P19: what the company does, and a ready-made AI team for it (on by default).
  const [industry, setIndustry] = useState("general");
  const [team, setTeam] = useState(true);
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
    editing ? t("Branch updated.") : undefined,
  );
  const create = () =>
    save.mutate(undefined, {
      onSuccess: (r) => {
        onOpenChange(false);
        if (editing) return;
        const made = r as Branch & { starter?: StarterResult | null };
        if (made.starter) {
          qc.invalidateQueries({ queryKey: workKeys.agents });
          toast.success(t("{name} created. {team}", { name: made.name, team: teamToast(made.starter, made.name) }));
        } else toast.success(t("Branch created."));
      },
    });
  const fieldError = save.error instanceof ApiError ? save.error.fields.name : undefined;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("Edit branch") : t("New branch")}
      description={editing ? undefined : t("One branch per company. Its agents, office and knowledge live under it.")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={create}
          >
            {editing ? t("Save") : t("Create branch")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <Field label={t("Company name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Syarikat Maju Sdn Bhd")} error={fieldError} autoFocus />
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
          <SwitchField checked={seed} onCheckedChange={setSeed} label={t("Add standard departments")} hint={t("Management, Finance, Research, Operations, Data and Writing. You can rename or remove them later.")} />
        ) : null}
        {!editing ? <StarterTeamFields industry={industry} onIndustry={setIndustry} enabled={team} onEnabled={setTeam} /> : null}
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

function BranchCard({ branch, canManage, guide }: { branch: Branch; canManage: boolean; guide?: string }) {
  const t = useT();
  const [edit, setEdit] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [team, setTeam] = useState(false);
  const [teamKey, setTeamKey] = useState(0);
  const [review, setReview] = useState(0); // P21: review stages dialog (0 = closed)
  const qc = useQueryClient();
  return (
    <Card data-guide={guide} className="overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white shadow-[inset_0_0_0_1px_hsl(0_0%_100%/0.15)]"
          style={{ background: branch.color }}
        >
          <BuildingsIcon size={20} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold break-words">{branch.name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            <span>{branch.departments.length === 1 ? t("1 department") : t("{n} departments", { n: branch.departments.length })}</span>
            {industryOf(branch) ? <Pill tone="accent" className="max-w-full"><span className="truncate">{industryLabel(industryOf(branch))}</span></Pill> : null}
            {branch.isolated ? (
              <Pill tone="info">
                <LockSimpleIcon size={12} weight="bold" /> {t("Private knowledge")}
              </Pill>
            ) : (
              <Pill>{t("Shared knowledge")}</Pill>
            )}
          </div>
        </div>
        {canManage ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("Options for {name}", { name: branch.name })} className="-mt-1 -mr-2">
                <DotsThreeIcon size={20} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<PencilSimpleIcon />} onSelect={() => { setEditKey((k) => k + 1); setEdit(true); }}>{t("Edit branch")}</MenuItem>
              <MenuItem icon={<UsersThreeIcon />} onSelect={() => { setTeamKey((k) => k + 1); setTeam(true); }}>{t("Add ready-made AI team")}</MenuItem>
              <MenuItem icon={<ShieldCheckIcon />} onSelect={() => setReview((k) => k + 1)}>{t("Review stages")}</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon />} danger onSelect={() => setConfirm(true)}>{t("Delete branch")}</MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </header>
      <div className="flex flex-wrap gap-2 bg-surface-2/30 px-4 py-4 sm:px-5">
        {branch.departments.map((d) => (
          <DepartmentChip key={d.id} dept={d} canManage={canManage} />
        ))}
        {canManage ? <AddDepartment branchId={branch.id} /> : null}
        {!branch.departments.length && !canManage ? <p className="text-[13px] text-muted">{t("No departments yet.")}</p> : null}
      </div>
      {canManage ? (
        <p className="border-t border-border px-4 py-2 text-[12px] text-muted sm:px-5">
          <span className="[@media(hover:hover)]:hidden">{t("Tap the pencil to rename a department.")}</span>
          <span className="hidden [@media(hover:hover)]:inline">{t("Hover a department to rename or remove it.")}</span>
        </p>
      ) : null}
      <BranchDialog key={editKey} open={edit} onOpenChange={setEdit} branch={branch} />
      {review ? <DepartmentReviewDialog key={review} departments={branch.departments} open onOpenChange={(o) => !o && setReview(0)} /> : null}
      <StarterTeamDialog
        key={`team-${teamKey}`}
        open={team}
        onOpenChange={setTeam}
        branchId={branch.id}
        branchName={branch.name}
        initialIndustry={industryOf(branch)}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Delete {name}?", { name: branch.name })}
        body={t("This removes the branch and its {n} departments. It cannot be undone.", { n: branch.departments.length })}
        confirmLabel={t("Delete branch")}
        danger
        onConfirm={async () => {
          try {
            await api(`/api/branches/${branch.id}`, "DELETE");
            toast.success(t("{name} deleted.", { name: branch.name }));
            qc.invalidateQueries({ queryKey: keys.branches });
            qc.invalidateQueries({ queryKey: keys.status });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Card>
  );
}

export function OrganizationPage() {
  const t = useT();
  // "Branches" is also the workflow word (Cabang); companies need their own Malay word.
  const lang = useLang((s) => s.lang);
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("org.manage");
  const { data: branches, isLoading, error } = useQuery(branchesQuery);
  const search = useSearch({ strict: false }) as { new?: number };
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const reduce = useReducedMotion();
  // "New branch" from the palette or switcher arrives as ?new=1.
  const createOpen = creating || (!!search.new && canManage);
  const openCreate = () => { setCreateKey((k) => k + 1); setCreating(true); };
  const setCreateOpen = (o: boolean) => {
    setCreating(o);
    if (!o && search.new) navigate({ to: "/organization", search: {}, replace: true });
  };

  return (
    <Page>
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
          {[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-[var(--radius-md)]" />)}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load branches.")} {errorMessage(error)}
        </div>
      ) : branches && branches.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <StatGrid className="lg:grid-cols-3">
            <Stat label={lang === "ms" ? t("Branches (companies)") : t("Branches")} value={branches.length} icon={BuildingsIcon} hint={t("One per company")} />
            <Stat label={t("Departments")} value={branches.reduce((n, b) => n + b.departments.length, 0)} icon={TreeStructureIcon} tone="info" hint={t("Across every branch")} />
            <Stat
              label={t("Private knowledge")}
              value={branches.filter((b) => b.isolated).length}
              icon={LockSimpleIcon}
              tone="violet"
              hint={t("Branches that keep SOPs and facts to themselves")}
              className="max-lg:col-span-2"
            />
          </StatGrid>
          <AnimatePresence initial={false}>
            {branches.map((b, i) => (
              <motion.div
                key={b.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <BranchCard branch={b} canManage={canManage} guide={i === 0 ? "organization.company" : undefined} />
              </motion.div>
            ))}
          </AnimatePresence>
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
