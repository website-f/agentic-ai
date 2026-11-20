import {
  ArrowLeftIcon, ArrowRightIcon, CopyIcon, CrownSimpleIcon, DotsThreeIcon, EnvelopeSimpleIcon, EyeIcon, FileXlsIcon, IdentificationCardIcon, KeyIcon, MicrosoftOutlookLogoIcon,
  PencilSimpleIcon, ShieldCheckIcon, ShieldSlashIcon, TrashIcon, TreeStructureIcon, UserGearIcon, UserPlusIcon, UsersIcon, UsersThreeIcon, XIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { SignInEmailsBar, useEmailMember } from "@/components/sign-in-emails";
import { ResetTwoFactorDialog, TwoFactorPill, useMemberTwoFactor } from "@/components/two-factor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DataTable, RowMenu, TableFilter, useTableState, type BulkOutcome, type Column, type TableControl, type TableState } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { MultiSelect, SearchSelect } from "@/components/ui/search-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, t as tr, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import {
  memberStatus, membersPageUrl, PAGE_SIZES,
  type MemberSort, type MembersFilters, type MembersPage, type MemberStatus, type PageSize,
} from "@/lib/members";
import { branchesQuery, keys, meQuery, membersQuery } from "@/lib/queries";
import { hasAny, ROLE_INFO, SCOPED_ROLES, type Branch, type Me, type Member, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

import { MemberIdentityDialog, ResetMicrosoftDialog } from "@/components/member-identity";

import { AccessBadges, AccessFields, accessChanges, accessOf, BulkAccessDialog, DEFAULT_ACCESS, LibraryAccessFields, libraryChanges, libraryOf, PrimaOpensAsCard, setsAccess, type AccessValue, type LibraryValue } from "./members-access";
import { ImportMembersDialog } from "./members-import";
import { addsDepartments, BulkManagerDialog, editsLines, editsOrg, HodBadge, ManagesField, NewDepartment, OrgFields, OrgLine, saveManages, TeamDialog } from "./members-org";

const ROLES: Role[] = ["owner", "admin", "branch_manager", "group_hod", "hod", "supervisor", "staff", "operator", "approver", "viewer", "management", "hr"];
// What a branch manager or HOD may hand out (mirrors api/routers/members.py TEAM_ROLES).
const TEAM_ROLES: Partial<Record<Role, Role[]>> = { branch_manager: ["hod", "supervisor", "staff"], group_hod: ["hod", "supervisor", "staff"], hod: ["supervisor", "staff"] };
const NONE = "none";

// Roles that are not tied to a branch or department (the English keeps its plural).
const WHOLE_WORKSPACE: Partial<Record<Role, string>> = {
  owner: msg("Owners see the whole workspace."),
  admin: msg("Admins see the whole workspace."),
  operator: msg("Operators see the whole workspace."),
  approver: msg("Approvers see the whole workspace."),
  viewer: msg("Viewers see the whole workspace."),
  management: msg("Management see the whole workspace."),
  hr: msg("HR see the whole workspace."),
};

function assignable(me: Me): Role[] {
  // P92: the server says which (nobody gives a role with more access than their own).
  if (me.assignable_roles) return ROLES.filter((r) => me.assignable_roles?.includes(r));
  if (me.permissions.includes("members.manage")) {
    return ROLES.filter((r) => r !== "owner" || me.permissions.includes("members.assign_owner"));
  }
  return TEAM_ROLES[me.role] ?? [];
}

function roleOptions(roles: Role[]) {
  // P97: the head of department role says "HOD" too, the word people use.
  return roles.map((r) => ({ value: r, label: r === "hod" ? tr("Head of department (HOD)") : tr(ROLE_INFO[r].label), hint: tr(ROLE_INFO[r].blurb) }));
}

/** P98: the branches a scoped manager may place people in (null: any). */
export function allowedBranches(me: Me): string[] | null {
  if (!me.scope || me.scope.kind === "all") return null;
  const ids = me.scope.branches?.map((b) => b.id) ?? [];
  return ids.length ? ids : me.scope.branch_id ? [me.scope.branch_id] : [];
}

/** A member's branches, home first (older answers carry only branch_id). */
export const branchIdsOf = (m: Member) => (m.branches?.length ? m.branches.map((b) => b.id) : m.branch_id ? [m.branch_id] : []);
/** Their branches' names, home first. */
export const branchNamesOf = (m: Member) => (m.branches?.length ? m.branches.map((b) => b.name) : m.branch_name ? [m.branch_name] : []);

/** Where a scoped member works (P98): one or more branches, the first their home, and for most
 * roles a department (from the picked branches). Workspace roles sit nowhere. */
function Placement({ role, branches, branchIds, departmentId, onChange, allowed, canAddDept }: {
  role: Role;
  branches: Branch[];
  /** Home first. */
  branchIds: string[];
  departmentId: string;
  onChange: (branchIds: string[], departmentId: string) => void;
  /** A scoped manager: only their own branches. */
  allowed?: string[] | null;
  /** P97: "+ New department" in the list (org.manage, as on the Organization page). */
  canAddDept?: boolean;
}) {
  const t = useT();
  const [adding, setAdding] = useState<string | null>(null);
  if (!SCOPED_ROLES.includes(role)) {
    const line = WHOLE_WORKSPACE[role];
    return <p className="text-[12.5px] text-muted">{line ? t(line) : t("{role} sees the whole workspace.", { role: t(ROLE_INFO[role].label) })}</p>;
  }
  const list = allowed ? branches.filter((b) => allowed.includes(b.id)) : branches;
  const picked = branchIds.filter((id) => list.some((b) => b.id === id));
  const pool = picked.length ? list.filter((b) => picked.includes(b.id)) : list.slice(0, 1);
  const needsDept = role === "hod" || role === "supervisor";
  const dept = list.flatMap((b) => b.departments).find((d) => d.id === departmentId);
  // The department's branch is their home: it leads the list and stays while the department does.
  const setBranches = (ids: string[]) => {
    const keep = dept && !ids.includes(dept.branch_id) ? [dept.branch_id, ...ids] : ids;
    onChange(keep, dept && keep.includes(dept.branch_id) ? departmentId : "");
  };
  const setDept = (id: string) => {
    const d = list.flatMap((b) => b.departments).find((x) => x.id === id);
    if (!d) return onChange(picked, id === NONE ? "" : id);
    onChange([d.branch_id, ...picked.filter((b) => b !== d.branch_id)], d.id);
  };
  const deptOptions = [
    ...(needsDept ? [] : [{ value: NONE, label: t("Any department") }]),
    ...pool.flatMap((b) => b.departments.map((d) => ({ value: d.id, label: d.name, group: pool.length > 1 ? b.name : undefined }))),
  ];
  const home = list.find((b) => b.id === picked[0]);
  const addTo = pool[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Branches|office")}</span>
        <MultiSelect value={picked} onValueChange={setBranches} label={t("Branches|office")} placeholder={t("Pick one or more branches")}
          searchPlaceholder={t("Search branches")}
          locked={dept && picked.includes(dept.branch_id) ? { [dept.branch_id]: t("Their department's branch") } : undefined}
          options={list.map((b) => ({ value: b.id, label: b.name, hint: b.id === picked[0] ? t("Home branch") : undefined }))} />
        <p className="text-[12.5px] text-muted">
          {home ? t("Home branch: {name}. Their own agents sit there; they work in every branch picked.", { name: home.name }) : t("They work in every branch picked. The first is their home branch.")}
        </p>
      </div>
      {role === "branch_manager" ? null : (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{needsDept ? t("Department") : t("Department (optional)")}</span>
          <SearchSelect value={departmentId || (needsDept ? "" : NONE)} label={t("Department")} onValueChange={setDept}
            placeholder={t("Pick a department")} searchPlaceholder={t("Search departments")} options={deptOptions}
            action={canAddDept && addTo ? { label: t("+ New department in {branch}", { branch: addTo.name }), onSelect: () => setAdding(addTo.id) } : undefined} />
        </div>
      )}
      {adding && role !== "branch_manager" ? (
        <NewDepartment branchId={adding} onCancel={() => setAdding(null)}
          onMade={(d) => { setAdding(null); onChange([d.branch_id, ...picked.filter((b) => b !== d.branch_id)], d.id); }} />
      ) : null}
    </div>
  );
}

function placementBody(role: Role, branchIds: string[], departmentId: string) {
  if (!SCOPED_ROLES.includes(role)) return { branch_id: null, branch_ids: [], department_id: null };
  const ids = branchIds.filter(Boolean);
  return { branch_id: ids[0] ?? null, branch_ids: ids, department_id: departmentId && departmentId !== NONE && role !== "branch_manager" ? departmentId : null };
}

/** Their branches, or the first one there is when none was picked. */
const orFirst = (ids: string[], list: Branch[]) => (ids.length ? ids : list[0] ? [list[0].id] : []);

function TempPassword({ email, password }: { email: string; password: string }) {
  const t = useT();
  // The email stays bold inside the translated sentence.
  const [before = "", after = ""] = t(
    "Give this temporary password to {email}. It is shown only once. They will pick their own password the first time they sign in.",
  ).split("{email}");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success(t("Copied."));
    } catch {
      toast.error(t("Copy blocked by the browser. Select the password and copy it by hand."));
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px] text-muted">
        {before}
        <span className="font-medium text-fg">{email}</span>
        {after}
      </p>
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 p-1.5 pl-3">
        <code className="min-w-0 flex-1 font-mono text-[15px] tracking-wide break-all select-all">{password}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          <CopyIcon size={15} /> {t("Copy")}
        </Button>
      </div>
    </div>
  );
}

function AddMemberDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const roles = assignable(me);
  const allowed = allowedBranches(me);
  const list = allowed ? branches.filter((b) => allowed.includes(b.id)) : branches;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(roles.includes("staff") ? "staff" : roles[0] ?? "viewer");
  const [branchIds, setBranchIds] = useState<string[]>(allowed?.length ? [me.scope?.branch_id ?? allowed[0]!] : []);
  const [departmentId, setDepartmentId] = useState(me.scope?.kind === "department" ? me.scope.department_id ?? "" : "");
  const [result, setResult] = useState<{ email: string; password: string | null } | null>(null);
  // P99: what they reach (owners, admins, management and HR set it).
  const [access, setAccess] = useState<AccessValue>(DEFAULT_ACCESS);
  const accessBody = setsAccess(me) && role !== "owner"
    ? { access: access.access, prima_modules: access.modules, ...(access.department ? { prima_department: access.department } : {}) }
    : {};

  const add = useMutation({
    mutationFn: () => api<{ temp_password: string | null }>("/api/members", "POST", { email, name, role, ...placementBody(role, orFirst(branchIds, list), departmentId), ...accessBody }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: keys.status });
      setResult({ email, password: r.temp_password });
      if (!r.temp_password) toast.success(t("{email} added. They sign in with their existing password.", { email }));
    },
  });
  const fields = add.error instanceof ApiError ? add.error.fields : {};

  if (result?.password) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Member added")} footer={<Button onClick={() => onOpenChange(false)}>{t("Done")}</Button>}>
        <TempPassword email={result.email} password={result.password} />
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Add member")}
      description={t("They get a temporary password to sign in with.")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button loading={add.isPending} disabled={!email || !name} onClick={() => add.mutate(undefined, { onSuccess: (r) => !r.temp_password && onOpenChange(false) })}>
            {t("Add member")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} autoFocus error={fields.name} />
        <Field label={t("Email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Role")}</span>
          <SearchSelect value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(roles)} label={t("Role")} searchPlaceholder={t("Search roles")} />
          <p className="text-[12.5px] text-muted">{t(ROLE_INFO[role].blurb)}</p>
        </div>
        <Placement role={role} branches={branches} branchIds={orFirst(branchIds, list)} departmentId={departmentId} allowed={allowed} canAddDept={addsDepartments(me)}
          onChange={(b, d) => { setBranchIds(b); setDepartmentId(d); }} />
        {setsAccess(me) ? <AccessFields value={access} onChange={setAccess} ownerTarget={role === "owner"} /> : null}
        <FormError message={add.error && !Object.keys(fields).length ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** Role and place for one member, or (P82) for everyone ticked in the table at once. */
function AccessDialog({ members, me, open, onOpenChange, onDone, inline }: {
  members: Member[];
  me: Me;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
  /** P120: on the member's own page, not in a dialog (Save stays on the page). */
  inline?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const roles = assignable(me);
  const allowed = allowedBranches(me);
  const list = allowed ? branches.filter((b) => allowed.includes(b.id)) : branches;
  const one = members.length === 1 ? members[0] : null;
  const [role, setRole] = useState<Role>(one?.role ?? (roles.includes("staff") ? "staff" : roles[0] ?? "viewer"));
  const [branchIds, setBranchIds] = useState<string[]>(one ? branchIdsOf(one) : allowed?.length ? [me.scope?.branch_id ?? allowed[0]!] : []);
  const [departmentId, setDepartmentId] = useState(one?.department_id ?? "");
  // P97: who they report to and whether they head their department (members.manage). P113:
  // branch managers and HODs set who their own people report to and their job titles.
  const org = !!one && editsLines(me);
  const heads = editsOrg(me);
  const { data: everyone = [] } = useQuery({ ...membersQuery, enabled: org });
  const [reportsTo, setReportsTo] = useState(one?.reports_to_user_id ?? "");
  // P111: their job title on the organization chart.
  const [jobTitle, setJobTitle] = useState(one?.job_title ?? "");
  // P109: the departments they head (any company); older answers only say "heads their own".
  const headOfStart = one ? (one.head_of?.length ? one.head_of.map((d) => d.id) : one.heads_department && one.department_id ? [one.department_id] : []) : [];
  const [headOf, setHeadOf] = useState<string[]>(headOfStart);
  // P109: what of the Library they read, and whether they may upload for other companies.
  const editsLibrary = !!one && me.permissions.includes("members.manage") && one.user_id !== me.user.id;
  const [libraryValue, setLibraryValue] = useState<LibraryValue>(one ? libraryOf(one) : libraryOf(null));
  // P98: the people they manage, many at once (sets those people's "reports to").
  const [manages, setManages] = useState<string[] | null>(null);
  // P99: what they reach (one person; the ticked people have their own Access button).
  const editsAccess = !!one && setsAccess(me);
  const [access, setAccess] = useState<AccessValue>(one ? accessOf(one) : DEFAULT_ACCESS);
  const save = useMutation({
    mutationFn: async () => {
      const place = placementBody(role, orFirst(branchIds, list), departmentId);
      if (one) {
        const orgBody = org
          ? {
              ...(reportsTo !== (one.reports_to_user_id ?? "") ? { reports_to_user_id: reportsTo || null } : {}),
              ...(jobTitle.trim() !== (one.job_title ?? "") ? { job_title: jobTitle.trim() || null } : {}),
              ...(heads && headOf.slice().sort().join() !== headOfStart.slice().sort().join() ? { head_of: headOf } : {}),
            }
          : {};
        const accessBody = editsAccess && role !== "owner" ? accessChanges(accessOf(one), access) : {};
        await api(`/api/members/${one.user_id}`, "PATCH", { role, ...place, ...orgBody, ...accessBody });
        const lib = editsLibrary ? libraryChanges(libraryOf(one), libraryValue) : null;
        if (lib) await api(`/api/members/${one.user_id}/library`, "PUT", lib);
        if (org && manages) {
          const r = await saveManages(one.user_id, manages);
          return { done: 1, skipped: r.skipped, first: r.results.find((x) => !x.ok)?.message ?? null };
        }
        return { done: 1, skipped: 0, first: null as string | null };
      }
      const r = await api<BulkOut>("/api/members/bulk", "POST", { user_ids: members.map((m) => m.user_id), action: "access", role, ...place });
      return { done: r.done, skipped: r.skipped, first: r.results.find((x) => !x.ok)?.message ?? null };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      if (one) {
        toast.success(t("{name} is now {role}.", { name: one.name, role: t(ROLE_INFO[role].label).toLowerCase() }));
        if (r.skipped) bulkToast(0, r.skipped, r.first);
      } else bulkToast(r.done, r.skipped, r.first);
      onDone?.();
      onOpenChange(false);
      if (inline && one) void qc.invalidateQueries({ queryKey: memberKey(one.user_id) });
    },
  });
  const options = one && !roles.includes(one.role) ? [one.role, ...roles] : roles;
  const fields = (
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Role")}</span>
          <SearchSelect value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(options)} label={t("Role")} searchPlaceholder={t("Search roles")} />
          <p className="text-[12.5px] text-muted">{t(ROLE_INFO[role].blurb)}</p>
        </div>
        <Placement role={role} branches={branches} branchIds={orFirst(branchIds, list)} departmentId={departmentId} allowed={allowed} canAddDept={addsDepartments(me)}
          onChange={(b, d) => { setBranchIds(b); setDepartmentId(d); }} />
        {org && one ? (
          <OrgFields member={{ ...one, role }} members={everyone} reportsTo={reportsTo} onReportsTo={setReportsTo} headOf={headOf} onHeadOf={setHeadOf}
            jobTitle={jobTitle} onJobTitle={setJobTitle} heads={heads}
            departmentId={placementBody(role, orFirst(branchIds, list), departmentId).department_id ?? ""} />
        ) : null}
        {org && one ? (
          <ManagesField member={one} members={everyone} value={manages} onChange={setManages} />
        ) : null}
        {editsAccess && one ? <AccessFields value={access} onChange={setAccess} member={one} ownerTarget={role === "owner" || one.role === "owner"} /> : null}
        {editsLibrary ? <LibraryAccessFields value={libraryValue} onChange={setLibraryValue} role={role} /> : null}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
  );
  if (inline) {
    return (
      <div className="grid gap-4">
        {fields}
        <div className="sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save changes")}</Button>
        </div>
      </div>
    );
  }
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}
      title={one ? t("Access for {name}", { name: one.name }) : t("Access for {n} people", { n: members.length })}
      description={one ? undefined : t("Everyone ticked gets this role and place. Anyone the rules stop is skipped and keeps what they have.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      {fields}
    </ResponsiveDialog>
  );
}

interface BulkOut { results: { user_id: string; ok: boolean; message: string | null }[]; done: number; skipped: number }

function bulkToast(done: number, skipped: number, first: string | null) {
  if (done) toast.success(done === 1 ? tr("1 person changed.") : tr("{n} people changed.", { n: done }));
  if (skipped) {
    const line = skipped === 1 ? tr("1 person skipped.") : tr("{n} people skipped.", { n: skipped });
    toast.warning(first ? `${line} ${first}` : line);
  }
}

const STATUS_INFO: Record<MemberStatus, { label: string; tone: "ok" | "warn" | "danger" }> = {
  active: { label: msg("Active"), tone: "ok" },
  pending: { label: msg("Temporary password"), tone: "warn" },
  disabled: { label: msg("Switched off"), tone: "danger" },
};

function StatusPill({ member }: { member: Member }) {
  const t = useT();
  const s = STATUS_INFO[memberStatus(member)];
  return <Pill tone={s.tone}>{t(s.label)}</Pill>;
}

/** P98: their home branch, then the others (a few, then "+N more"). */
function Branches({ member }: { member: Member }) {
  const t = useT();
  const names = branchNamesOf(member);
  if (!names.length) return <span className="text-muted">-</span>;
  return (
    <span className="grid gap-0.5">
      <span>{names[0]}</span>
      {names.length > 1 ? (
        <span className="text-[12px] text-muted" title={names.slice(1).join(", ")}>
          {names.length > 3 ? t("also {names} +{n} more", { names: names.slice(1, 3).join(", "), n: names.length - 3 }) : t("also {names}", { names: names.slice(1).join(", ") })}
        </span>
      ) : null}
    </span>
  );
}

/** P109: HOD badge and how many people are under them. */
function TeamCell({ member }: { member: Member }) {
  const t = useT();
  if (!member.heads_department && !member.manages) return <span className="text-muted">-</span>;
  return (
    <span className="grid justify-items-start gap-1">
      {member.heads_department ? <HodBadge member={member} /> : null}
      {member.manages ? (
        <span className="inline-flex items-center gap-1 text-[12.5px] text-muted tabular">
          <UsersThreeIcon size={12} /> {member.manages === 1 ? t("1 person") : t("{n} people", { n: member.manages })}
        </span>
      ) : null}
    </span>
  );
}

function RolePill({ role }: { role: Role }) {
  const t = useT();
  return <Pill tone={role === "owner" || role === "admin" ? "accent" : "neutral"}>{ROLE_INFO[role] ? t(ROLE_INFO[role].label) : role}</Pill>;
}

/** How they sign in: with Microsoft or a password, and when they last did. */
function SignIn({ member }: { member: Member }) {
  const t = useT();
  return (
    <div className="grid justify-items-start gap-0.5">
      {member.microsoft
        ? <Pill tone="ok"><MicrosoftOutlookLogoIcon size={12} weight="fill" /> {t("Microsoft")}</Pill>
        : <Pill tone="neutral">{t("Password only")}</Pill>}
      <span className="text-[12px] text-muted">
        {member.last_login_at ? t("Signed in {when}", { when: timeAgo(member.last_login_at).toLowerCase() }) : t("Never signed in")}
      </span>
    </div>
  );
}

function Avatar({ member, isMe }: { member: Member; isMe: boolean }) {
  return (
    <span className={cn(
      "grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold ring-1",
      isMe ? "bg-accent text-accent-fg ring-accent/30" : "bg-accent-soft text-accent ring-accent/15",
    )}>
      {initials(member.name)}
    </span>
  );
}

/** The ⋯ menu of one member: view, role and place, password, two-step sign-in, remove. */
function MemberActions({ member, me, onView }: { member: Member; me: Me; onView?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const isMe = member.user_id === me.user.id;
  const editable = !isMe && assignable(me).includes(member.role) && hasAny(me, "members.manage", "team.manage");
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reset, setReset] = useState<string | null>(null);
  // P57: owners and admins see who has two-step sign-in on; owners reset it (a lost phone).
  const hasTwoFactor = useMemberTwoFactor(member.user_id, me.permissions.includes("members.manage"));
  const [resetting2fa, setResetting2fa] = useState(false);
  // P92: correcting a name or email, and a wrong Microsoft link (members.manage only).
  const [identity, setIdentity] = useState(false);
  const [resettingMs, setResettingMs] = useState(false);
  // P97: who this member manages (owners, admins, management, HR).
  const [team, setTeam] = useState(false);
  const managesPeople = editsLines(me); // P111: anyone may have people under them on the chart
  const fixesPeople = me.permissions.includes("members.manage");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.members });
    qc.invalidateQueries({ queryKey: keys.status });
  };
  const resetPw = useMutation({
    mutationFn: () => api<{ temp_password: string }>(`/api/members/${member.user_id}/reset-password`, "POST"),
    onSuccess: (r) => { refresh(); setReset(r.temp_password); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // P92: a temporary password by email (owners and admins; the server checks).
  const emailPw = useEmailMember(member.user_id, member.name);
  if (!editable) {
    // P107: everyone may still open the details.
    return onView ? (
      <RowMenu label={t("Options for {name}", { name: member.name })}>
        <MenuItem icon={<EyeIcon />} onSelect={onView}>{t("View|verb")}</MenuItem>
      </RowMenu>
    ) : <span aria-hidden className="block size-10" />;
  }
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("Options for {name}", { name: member.name })}>
            <DotsThreeIcon size={20} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {onView ? <MenuItem icon={<EyeIcon />} onSelect={onView}>{t("View|verb")}</MenuItem> : null}
          <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>{fixesPeople ? t("Change role, place or access") : t("Change role or place")}</MenuItem>
          {managesPeople ? <MenuItem icon={<UsersThreeIcon />} onSelect={() => setTeam(true)}>{t("Who they manage")}</MenuItem> : null}
          {fixesPeople ? <MenuItem icon={<IdentificationCardIcon />} onSelect={() => setIdentity(true)}>{t("Change name or email")}</MenuItem> : null}
          {fixesPeople && member.microsoft ? <MenuItem icon={<MicrosoftOutlookLogoIcon />} onSelect={() => setResettingMs(true)}>{t("Reset Microsoft link")}</MenuItem> : null}
          <MenuItem icon={<KeyIcon />} onSelect={() => resetPw.mutate()}>{t("Reset password")}</MenuItem>
          {me.permissions.includes("members.manage") ? (
            <MenuItem icon={<EnvelopeSimpleIcon />} onSelect={() => emailPw.mutate()}>{t("Email a sign-in password")}</MenuItem>
          ) : null}
          {me.role === "owner" && hasTwoFactor ? (
            <MenuItem icon={<ShieldSlashIcon />} onSelect={() => setResetting2fa(true)}>{t("Reset two-step sign-in")}</MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>{t("Remove from workspace")}</MenuItem>
        </MenuContent>
      </Menu>
      {editing ? <AccessDialog members={[member]} me={me} open={editing} onOpenChange={setEditing} /> : null}
      {team ? <TeamDialog member={member} me={me} open={team} onOpenChange={setTeam} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("Remove {name}?", { name: member.name })}
        body={t("They lose access to this workspace immediately and are signed out. Their personal agents stay, without an owner.")}
        confirmLabel={t("Remove")}
        danger
        onConfirm={async () => {
          // P107: a refusal (the last owner, not yours to change) shows inside the dialog.
          await api(`/api/members/${member.user_id}`, "DELETE");
          refresh();
          toast.success(t("{name} removed.", { name: member.name }));
        }}
      />
      <ResetTwoFactorDialog member={member} open={resetting2fa} onOpenChange={setResetting2fa} />
      {identity ? <MemberIdentityDialog member={member} open={identity} onOpenChange={setIdentity} /> : null}
      <ResetMicrosoftDialog member={member} open={resettingMs} onOpenChange={setResettingMs} />
      <ResponsiveDialog open={!!reset} onOpenChange={() => setReset(null)} title={t("Password reset")} footer={<Button onClick={() => setReset(null)}>{t("Done")}</Button>}>
        {reset ? <TempPassword email={member.email} password={reset} /> : null}
      </ResponsiveDialog>
    </>
  );
}

function NameCell({ member, me, seesTwoFactor }: { member: Member; me: Me; seesTwoFactor: boolean }) {
  const t = useT();
  const isMe = member.user_id === me.user.id;
  const [team, setTeam] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar member={member} isMe={isMe} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
          <span className="min-w-0 break-words">{member.name}</span>
          {isMe ? <Pill tone="accent">{t("You")}</Pill> : null}
          <TwoFactorPill userId={member.user_id} enabled={seesTwoFactor} />
        </p>
        {member.job_title ? <p className="text-[12.5px] font-medium text-accent">{member.job_title}</p> : null}
        <p className="text-[12.5px] break-all text-muted">{member.email}</p>
        {member.agents ? (
          <p className="text-[12px] text-muted">{member.agents === 1 ? t("1 personal agent") : t("{n} personal agents", { n: member.agents })}</p>
        ) : null}
        <OrgLine member={member} onTeam={() => setTeam(true)} />
      </div>
      {team ? <TeamDialog member={member} me={me} open={team} onOpenChange={setTeam} /> : null}
    </div>
  );
}

export const MEMBER_FILTERS = ["company", "role", "status", "department", "team"] as const;

/** P107: the table's state (in the address) as the members API reads it. */
function membersFilters(s: TableState): MembersFilters {
  const sort = (["name", "email", "role", "company", "department", "last_seen", "joined"] as MemberSort[]).find((k) => k === s.sort) ?? "name";
  return {
    q: s.q.trim(),
    company: s.f.company ?? "",
    role: (s.f.role ?? "") as Role | "",
    status: (s.f.status ?? "") as MemberStatus | "",
    department: s.f.department ?? "",
    team: s.f.team ?? "",
    sort,
    dir: s.sort ? s.dir : "asc",
    page: s.page,
    pageSize: (PAGE_SIZES as readonly number[]).includes(s.size) ? (s.size as PageSize) : 25,
  };
}

/** P107: one page of members for a table's state (the Members page and Organization share it). */
export function useMembersPage(control: TableControl) {
  const filters = membersFilters(control.state);
  const query = useQuery({
    queryKey: [...keys.members, "page", filters],
    queryFn: () => api<MembersPage>(membersPageUrl(filters)),
    placeholderData: keepPreviousData,
  });
  return { filters, ...query };
}

/** Every member matching the filters (Export): the API's largest pages, one after another. */
async function everyMember(f: MembersFilters): Promise<Member[]> {
  const out: Member[] = [];
  for (let page = 1; page <= 1000; page++) {
    const r = await api<MembersPage>(membersPageUrl({ ...f, page, pageSize: 100 }));
    out.push(...r.items);
    if (!r.items.length || out.length >= r.total) break;
  }
  return out;
}

/** P107: one member's details (a row's View). */
function MemberSheet({ member, me, onClose }: { member: Member; me: Me; onClose: () => void }) {
  const t = useT();
  const isMe = member.user_id === me.user.id;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
  const line = (label: string, value: ReactNode) => (
    <div className="contents">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md"
      title={<span className="flex min-w-0 items-center gap-3"><Avatar member={member} isMe={isMe} /><span className="min-w-0 break-words">{member.name}</span></span>}
      description={<span className="break-all">{member.email}</span>}>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13.5px]">
        {line(t("Role"), <span className="flex flex-wrap items-center gap-1"><RolePill role={member.role} /><AccessBadges member={member} /></span>)}
        {line(t("Status"), <StatusPill member={member} />)}
        {line(t("Company"), <Branches member={member} />)}
        {line(t("Department"), member.department_name ?? <span className="text-muted">-</span>)}
        {member.job_title ? line(t("Job title"), member.job_title) : null}
        {member.reports_to_name ? line(t("Reports to"), member.reports_to_name) : null}
        {member.manages ? line(t("Manages"), member.manages === 1 ? t("Manages 1 person") : t("Manages {n} people", { n: member.manages })) : null}
        {member.heads_department ? line(t("Head of department (HOD)"), <HodBadge member={member} />) : null}
        {member.library_scope === "department" ? line(t("Library"), t("Own department only")) : null}
        {member.uploads_for_others ? line(t("Uploads"), t("May upload files for other companies")) : null}
        {line(t("Sign-in"), <SignIn member={member} />)}
        {line(t("Joined"), <span className="tabular">{when(member.joined_at)}</span>)}
        {member.agents ? line(t("Personal agents"), <span className="tabular">{member.agents}</span>) : null}
      </dl>
      <Link to="/settings/members/$userId" params={{ userId: member.user_id }} onClick={onClose}
        className="hit mt-5 mr-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
        <ArrowRightIcon size={15} /> {t("Open their page")}
      </Link>
      {me.permissions.includes("office.view") ? (
        <Link to="/organization" search={{ view: "hierarchy", focus: member.user_id } as never} onClick={onClose}
          className="hit mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
          <TreeStructureIcon size={15} /> {t("Show on the organization chart")}
        </Link>
      ) : null}
    </SideSheet>
  );
}

/** P107: the members data table (Settings > Members and Organization): the server searches,
 * filters, sorts and pages; each row has its ⋯ menu (View, change role or place, remove...);
 * ticked people get the bulk changes, Export and Remove. `withAddImport` adds the Add and
 * Import buttons to the table's toolbar (the Members page has them in its header). */
export function MembersTable({ control, me, withAddImport }: { control: TableControl; me: Me; withAddImport?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const canAdd = hasAny(me, "members.manage", "team.manage") && assignable(me).length > 0;
  const { data: branches = [] } = useQuery(branchesQuery);
  const { filters, data, isLoading, error, isFetching, refetch } = useMembersPage(control);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Ticks follow the search and filters (not the page or its size).
  const tickKey = JSON.stringify([filters.q, filters.company, filters.role, filters.status, filters.department, filters.team]);
  const [tickedFor, setTickedFor] = useState(tickKey);
  if (tickedFor !== tickKey) {
    setTickedFor(tickKey);
    if (selected.size) setSelected(new Set());
  }
  const [bulkAccess, setBulkAccess] = useState(false);
  const [bulkManager, setBulkManager] = useState(false);
  const [bulkPrima, setBulkPrima] = useState(false);
  const [viewing, setViewing] = useState<Member | null>(null);
  // P120 (Fitri, 20 Nov 2026: "when clicking each member open a full page"): a row opens their page.
  const goTo = useNavigate();
  const openPage = (m: Member) => void goTo({ to: "/settings/members/$userId", params: { userId: m.user_id } });
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  // P112: Members?q=<email>&focus=<user_id> (Prima's "Open in Members") opens that member once.
  const focusId = useRouterState({
    select: (s) => {
      const f = (s.location.search as { focus?: unknown }).focus;
      return s.location.pathname === "/settings/members" && typeof f === "string" ? f : "";
    },
  });
  const [focused, setFocused] = useState("");
  if (focusId && focused !== focusId) {
    const hit = rows.find((m) => m.user_id === focusId);
    if (hit) {
      setFocused(focusId);
      setViewing(hit);
    }
  }
  // The ticked people this page shows (the role dialog needs their names and roles).
  const ticked = rows.filter((m) => selected.has(m.user_id));
  const seesTwoFactor = me.permissions.includes("members.manage");
  // Departments to filter by: the picked company's, else every company's (grouped).
  const deptPool = filters.company && filters.company !== NONE ? branches.filter((b) => b.id === filters.company) : branches;
  const deptOptions = deptPool.flatMap((b) => b.departments.map((d) => ({ value: d.id, label: d.name, hint: deptPool.length > 1 ? b.name : undefined })));
  const statusLabel = (m: Member) => t(STATUS_INFO[memberStatus(m)].label);
  // P109: the Team filter: heads, managers, people under no one, or one manager's team.
  const { data: everyone = [] } = useQuery(membersQuery);
  const teamOptions = [
    { value: "heads", label: t("Heads of department (HOD)") },
    { value: "managers", label: t("Have people under them") },
    { value: "unplaced", label: t("Report to no one") },
    ...everyone.filter((m) => m.manages).sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: m.user_id, label: t("Team of {name}", { name: m.name }), hint: m.manages === 1 ? t("1 person") : t("{n} people", { n: m.manages ?? 0 }) })),
  ];
  const roleLabel = (r: Role) => (ROLE_INFO[r] ? t(ROLE_INFO[r].label) : r);
  const removeTicked = async (_rows: Member[], ids: string[]): Promise<BulkOutcome> => {
    const r = await api<BulkOut>("/api/members/bulk", "POST", { user_ids: ids, action: "remove" });
    qc.invalidateQueries({ queryKey: keys.members });
    qc.invalidateQueries({ queryKey: keys.status });
    return { done: r.done, failed: r.results.filter((x) => !x.ok).map((x) => ({ id: x.user_id, message: x.message ?? t("Something went wrong.") })) };
  };

  const columns: Column<Member>[] = [
    { id: "name", header: t("Name"), sortable: true, card: "title", className: "max-w-[22rem]", exportValue: (m) => m.name, cell: (m) => <NameCell member={m} me={me} seesTwoFactor={seesTwoFactor} /> },
    { id: "email", header: t("Email"), exportOnly: true, exportValue: (m) => m.email, cell: (m) => m.email },
    {
      id: "role", header: t("Role"), sortable: true, exportValue: (m) => roleLabel(m.role),
      cell: (m) => <span className="flex flex-wrap items-center gap-1"><RolePill role={m.role} /><AccessBadges member={m} /></span>,
    },
    { id: "company", header: t("Company"), sortable: true, exportValue: (m) => branchNamesOf(m).join("; "), cell: (m) => <Branches member={m} /> },
    { id: "department", header: t("Department"), sortable: true, exportValue: (m) => m.department_name ?? "", cell: (m) => m.department_name ?? <span className="text-muted">-</span> },
    {
      id: "team", header: t("Team"), hideBelow: "lg",
      exportValue: (m) => [(m.head_of ?? []).map((d) => d.name).join("; "), m.manages ? String(m.manages) : ""].filter(Boolean).join(" / "),
      cell: (m) => <TeamCell member={m} />,
    },
    { id: "last_seen", header: t("Sign-in"), sortable: true, kind: "date", hideBelow: "lg", exportValue: (m) => m.last_login_at ?? "", cell: (m) => <SignIn member={m} /> },
    {
      id: "joined", header: t("Joined"), sortable: true, kind: "date", hideBelow: "xl", exportValue: (m) => m.joined_at,
      cell: (m) => <span className="text-muted tabular">{new Date(m.joined_at).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}</span>,
    },
    { id: "status", header: t("Status"), exportValue: statusLabel, cell: (m) => <StatusPill member={m} /> },
  ];

  return (
    <>
      <DataTable
        label={t("Members")}
        mode="server"
        columns={columns}
        rows={rows}
        total={total}
        rowId={(m) => m.user_id}
        rowLabel={(m) => m.name}
        control={control}
        pageSizes={PAGE_SIZES}
        loading={isLoading}
        fetching={isFetching && !isLoading}
        error={error}
        onRetry={() => void refetch()}
        searchPlaceholder={t("Search by name or email")}
        filters={
          <>
            <TableFilter control={control} id="company" label={t("Company")} allLabel={t("All companies")} searchable
              options={[{ value: NONE, label: t("No company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
            {deptOptions.length ? (
              <TableFilter control={control} id="department" label={t("Department")} allLabel={t("All departments")} searchable options={deptOptions} />
            ) : null}
            <TableFilter control={control} id="role" label={t("Role")} allLabel={t("All roles")} searchable
              options={ROLES.map((r) => ({ value: r, label: t(ROLE_INFO[r].label) }))} />
            <TableFilter control={control} id="team" label={t("Team")} allLabel={t("Everyone")} searchable options={teamOptions} />
            <TableFilter control={control} id="status" label={t("Status")} allLabel={t("All statuses")}
              options={(Object.keys(STATUS_INFO) as MemberStatus[]).map((s) => ({ value: s, label: t(STATUS_INFO[s].label) }))} />
          </>
        }
        exportName={t("members")}
        exportRows={() => everyMember(filters)}
        onOpen={openPage}
        onAdd={withAddImport && canAdd ? () => { setAddKey((k) => k + 1); setAdding(true); } : undefined}
        addLabel={t("Add member")}
        onImport={withAddImport && canAdd ? () => setImporting(true) : undefined}
        importLabel={t("Import from Excel")}
        actions={(m) => <MemberActions member={m} me={me} onView={() => openPage(m)} />}
        selection={canAdd ? { selected, onChange: setSelected, canSelect: (m) => m.user_id !== me.user.id } : undefined}
        bulkRemove={canAdd ? {
          run: removeTicked,
          verb: "remove",
          title: (n) => (n === 1 ? t("Remove 1 person?") : t("Remove {n} people?", { n })),
          body: t("They lose access to this workspace immediately and are signed out. Their personal agents stay, without an owner."),
        } : undefined}
        bulk={() => (
          <>
            <Button size="sm" variant="secondary" disabled={!ticked.length} onClick={() => setBulkAccess(true)}>
              <PencilSimpleIcon size={14} /> {t("Change role or place")}
            </Button>
            {setsAccess(me) ? (
              <Button size="sm" variant="secondary" onClick={() => setBulkPrima(true)}>
                <ShieldCheckIcon size={14} /> {t("Access")}
              </Button>
            ) : null}
            {editsLines(me) ? (
              <Button size="sm" variant="secondary" onClick={() => setBulkManager(true)}>
                <TreeStructureIcon size={14} /> {t("Reports to")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <XIcon size={14} /> {t("Clear")}
            </Button>
            {ticked.length < selected.size ? (
              <span className="text-[12px] text-muted">{t("A role change applies to the ticked people on this page.")}</span>
            ) : null}
          </>
        )}
      />
      {viewing ? <MemberSheet member={viewing} me={me} onClose={() => setViewing(null)} /> : null}
      {withAddImport ? <AddMemberDialog key={addKey} open={adding} onOpenChange={setAdding} me={me} /> : null}
      {importing ? (
        <ImportMembersDialog open onOpenChange={setImporting} roles={assignable(me)} lockBranch={allowedBranches(me)} />
      ) : null}
      {bulkAccess ? (
        <AccessDialog members={ticked} me={me} open={bulkAccess} onOpenChange={setBulkAccess} onDone={() => setSelected(new Set())} />
      ) : null}
      {bulkPrima ? (
        <BulkAccessDialog userIds={[...selected]} open={bulkPrima} onOpenChange={setBulkPrima} onDone={() => setSelected(new Set())} />
      ) : null}
      {bulkManager ? (
        <BulkManagerDialog userIds={[...selected]} open={bulkManager} onOpenChange={setBulkManager} onDone={() => setSelected(new Set())} />
      ) : null}
    </>
  );
}

export function MembersPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canAdd = hasAny(me, "members.manage", "team.manage") && assignable(me).length > 0;
  // P98: the owner changes what each role may do (Settings > Roles and access).
  const editsRoles = me.permissions.includes("roles.manage");
  // P107: the shared data table; the server searches, filters, sorts and pages, and the address
  // keeps where you were (?company= and the other filters).
  const control = useTableState({ size: 25, sort: "name" }, { filters: MEMBER_FILTERS });
  const { filters, data, isLoading, error } = useMembersPage(control);
  const search = useSearch({ strict: false }) as { add?: number };
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [importing, setImporting] = useState(false);
  // "Add member" from the palette arrives as ?add=1.
  const addOpen = adding || (!!search.add && canAdd);
  const openAdd = () => { setAddKey((k) => k + 1); setAdding(true); };
  const setAddOpen = (o: boolean) => {
    setAdding(o);
    if (!o && search.add) navigate({ to: "/settings/members", search: {}, replace: true });
  };
  const scoped = me.scope && me.scope.kind !== "all";
  const clearAll = () => control.set({ q: "", f: Object.fromEntries(MEMBER_FILTERS.map((k) => [k, ""])) });
  const summary = data?.summary;
  const total = data?.total ?? 0;
  const filtered = !!(filters.q || filters.company || filters.role || filters.status || filters.department || filters.team);

  return (
    <Page wide>
      <PageHeader
        title={t("Members")}
        description={scoped ? t("People in {place}, and what their role lets them do.", { place: me.scope?.label ?? "" }) : t("People who can sign in to this workspace, where they sit, and what their role lets them do.")}
        actions={canAdd || editsRoles ? (
          <>
            {editsRoles ? (
              <Button asChild variant="outline">
                <Link to="/settings/roles"><UserGearIcon size={16} /> {t("Roles and access")}</Link>
              </Button>
            ) : null}
            {canAdd ? <Button variant="outline" onClick={() => setImporting(true)}>
              <FileXlsIcon size={16} /> {t("Import from Excel")}
            </Button> : null}
            {canAdd ? <Button data-guide="settings.add" onClick={openAdd}>
              <UserPlusIcon size={16} weight="bold" /> {t("Add member")}
            </Button> : null}
          </>
        ) : null}
      />
      {me.permissions.includes("members.manage") ? <SignInEmailsBar isOwner={me.role === "owner"} /> : null}
      {/* P106: the developer chooses how they open Prima (CEO record or their own account). */}
      {me.user.is_developer ? <PrimaOpensAsCard /> : null}
      {isLoading ? (
        <div className="grid gap-4">
          <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
          <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        </div>
      ) : error && !data ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load members.")} {errorMessage(error)}
        </div>
      ) : summary ? (
        <>
          <StatGrid>
            <Stat label={t("Members")} value={summary.members} icon={UsersIcon} hint={t("Can sign in here")} onClick={clearAll} active={!filtered} />
            <Stat label={t("Owners and admins")} value={summary.owners_admins} icon={CrownSimpleIcon} tone="violet" hint={t("Full workspace access")} />
            <Stat label={t("Temporary password")} value={summary.temp_password} icon={KeyIcon} tone={summary.temp_password ? "warn" : "neutral"} hint={t("Yet to pick their own")}
              onClick={() => control.set({ f: { status: filters.status === "pending" ? "" : "pending" } })} active={filters.status === "pending"} />
            <Stat label={t("Signed in with Microsoft")} value={summary.microsoft} icon={MicrosoftOutlookLogoIcon} tone="info" hint={t("Their work account is connected")} />
          </StatGrid>

          <div data-guide="settings.list" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[17px] font-semibold tabular">
                {summary.members === 1 ? t("1 member") : t("{n} members", { n: summary.members })}
              </h2>
              {filtered ? <p className="text-[13px] text-muted tabular">{t("{n} match the filters", { n: total })}</p> : null}
            </div>
            <MembersTable control={control} me={me} />
          </div>
        </>
      ) : null}

      <Section title={t("Roles")} description={t("What each role lets a person do. Scoped roles only see their own part of the workspace.")}
        actions={editsRoles ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/settings/roles"><UserGearIcon size={15} /> {t("Change what each role can do")}</Link>
          </Button>
        ) : null}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => {
            const count = summary?.roles[r] ?? 0;
            return (
              <div key={r} className="grid content-start gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  <span className="min-w-0 flex-1">{t(ROLE_INFO[r].label)}</span>
                  {SCOPED_ROLES.includes(r) ? <Pill tone="info">{r === "staff" ? t("Own agents") : r === "branch_manager" || r === "group_hod" ? t("Their branches") : t("One department")}</Pill> : null}
                </p>
                <p className="text-[12.5px] text-muted">{t(ROLE_INFO[r].blurb)}</p>
                <p className="text-[12px] text-muted tabular">{count ? (count === 1 ? t("1 member") : t("{n} members", { n: count })) : t("Nobody yet")}</p>
              </div>
            );
          })}
        </div>
      </Section>
      <AddMemberDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} me={me} />
      {importing ? (
        <ImportMembersDialog open onOpenChange={setImporting} roles={assignable(me)} lockBranch={allowedBranches(me)} />
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------- P120 a member's own page

const memberKey = (id: string) => [...keys.members, "one", id] as const;

/** P120 (Fitri, 20 Nov 2026: "when clicking each member, open a full page to assign by hand"):
 * one member on a page of their own. Who they are and where they sit, their line (who they report
 * to and everyone under them), and, for whoever may change them, every setting on the page:
 * role and companies, who they report to and the people under them (searchable), job title,
 * the departments they head, what they reach and their Library. The same rules as the dialog. */
export function MemberPage() {
  const t = useT();
  const { userId } = useParams({ strict: false }) as { userId?: string };
  const { data: me } = useSuspenseQuery(meQuery);
  const id = userId ?? "";
  const { data: member, isLoading, error } = useQuery({
    queryKey: memberKey(id),
    queryFn: () => api<Member>(`/api/members/${id}`),
    enabled: !!id,
  });
  const { data: team = [] } = useQuery({
    queryKey: [...memberKey(id), "team"],
    queryFn: () => api<Member[]>(`/api/members/${id}/team`),
    enabled: !!member,
  });
  const back = (
    <Link to="/settings/members" className="hit inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
      <ArrowLeftIcon size={14} /> {t("Members")}
    </Link>
  );
  if (isLoading) {
    return (
      <Page wide>
        {back}
        <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        <Skeleton className="h-96 rounded-[var(--radius-md)]" />
      </Page>
    );
  }
  if (error || !member) {
    return (
      <Page>
        {back}
        <p role="alert" className="text-danger">{error ? errorMessage(error) : t("That member is not here.")}</p>
      </Page>
    );
  }
  const isMe = member.user_id === me.user.id;
  const editable = !isMe && assignable(me).includes(member.role) && hasAny(me, "members.manage", "team.manage");
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
  const line = (label: string, value: ReactNode) => (
    <div className="contents">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  return (
    <Page wide>
      {back}
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-[18px] font-semibold text-accent ring-1 ring-accent/15">
          {initials(member.name)}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
            <span className="min-w-0 break-words">{member.name}</span>
            {isMe ? <Pill tone="accent">{t("You")}</Pill> : null}
          </h1>
          {member.job_title ? <p className="text-[13.5px] font-medium text-accent">{member.job_title}</p> : null}
          <p className="text-[13px] break-all text-muted">{member.email}</p>
          <div className="flex flex-wrap items-center gap-1.5"><RolePill role={member.role} /><StatusPill member={member} /><AccessBadges member={member} /></div>
        </div>
        <MemberActions member={member} me={me} />
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="grid min-w-0 gap-5">
          {editable ? (
            <section aria-label={t("Role, place and access")} className="grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 pt-4 sm:px-5">
              <div className="grid gap-0.5">
                <h2 className="text-[15px] font-semibold">{t("Role, place and access")}</h2>
                <p className="text-[12.5px] text-muted">{t("Change anything here, then Save changes at the bottom.")}</p>
              </div>
              <AccessDialog key={`${member.user_id}:${member.role}:${member.reports_to_user_id ?? ""}`} members={[member]} me={me} open onOpenChange={() => undefined} inline />
            </section>
          ) : (
            <p className="rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3 text-[13px] text-muted">
              {isMe ? t("This is you. Ask an owner or admin to change your own role or place.") : t("You can see this member. Owners, admins and their managers change them.")}
            </p>
          )}
        </div>
        <aside className="grid min-w-0 gap-4">
          <section aria-label={t("Details")} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13.5px]">
              {line(t("Company"), <Branches member={member} />)}
              {line(t("Department"), member.department_name ?? <span className="text-muted">-</span>)}
              {line(t("Reports to"), member.reports_to_name ?? <span className="text-muted">{t("Nobody yet")}</span>)}
              {member.heads_department ? line(t("Head of department (HOD)"), <HodBadge member={member} />) : null}
              {member.library_scope === "department" ? line(t("Library"), t("Own department only")) : null}
              {line(t("Sign-in"), <SignIn member={member} />)}
              {line(t("Joined"), <span className="tabular">{when(member.joined_at)}</span>)}
            </dl>
          </section>
          <section aria-label={t("People under them")} className="grid gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <UsersThreeIcon size={15} className="text-accent" />
              {team.length === 1 ? t("1 person reports to them") : t("{n} people report to them", { n: team.length })}
            </h2>
            {team.length ? (
              <ul className="grid max-h-80 gap-1 overflow-y-auto">
                {team.map((p) => (
                  <li key={p.user_id}>
                    <Link to="/settings/members/$userId" params={{ userId: p.user_id }} className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-2">
                      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent">{initials(p.name)}</span>
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-[13px] font-medium">{p.name}</span>
                        {p.job_title ? <span className="truncate text-[11.5px] text-muted">{p.job_title}</span> : null}
                      </span>
                      {p.manages ? <span className="shrink-0 text-[11.5px] text-muted tabular">+{p.manages}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[12.5px] text-muted">{t("Nobody reports to them yet.")}</p>}
            <Link to="/organization" search={{ view: "hierarchy", focus: member.user_id } as never}
              className="hit inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
              <TreeStructureIcon size={15} /> {t("Show on the organization chart")}
            </Link>
          </section>
        </aside>
      </div>
    </Page>
  );
}
