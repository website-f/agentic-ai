import {
  CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpIcon, CopyIcon, CrownSimpleIcon, DotsThreeIcon, EnvelopeSimpleIcon, FileXlsIcon, IdentificationCardIcon, KeyIcon, MicrosoftOutlookLogoIcon,
  PencilSimpleIcon, ShieldSlashIcon, TrashIcon, UserPlusIcon, UsersIcon, XIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader, Section } from "@/components/page";
import { SignInEmailsBar, useEmailMember } from "@/components/sign-in-emails";
import { ResetTwoFactorDialog, TwoFactorPill, useMemberTwoFactor } from "@/components/two-factor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { msg, t as tr, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import {
  FIRST_PAGE, memberStatus, membersPageUrl, nextSort, PAGE_SIZES, pageRange, toggleAll, withFilter,
  type MemberSort, type MembersFilters, type MembersPage, type MemberStatus, type PageSize,
} from "@/lib/members";
import { useDebounced } from "@/lib/paged";
import { branchesQuery, keys, meQuery } from "@/lib/queries";
import { hasAny, ROLE_INFO, SCOPED_ROLES, type Branch, type Me, type Member, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

import { MemberIdentityDialog, ResetMicrosoftDialog } from "@/components/member-identity";

import { ImportMembersDialog } from "./members-import";

const ROLES: Role[] = ["owner", "admin", "branch_manager", "hod", "supervisor", "staff", "operator", "approver", "viewer", "management", "hr"];
// What a branch manager or HOD may hand out (mirrors api/routers/members.py TEAM_ROLES).
const TEAM_ROLES: Partial<Record<Role, Role[]>> = { branch_manager: ["hod", "supervisor", "staff"], hod: ["supervisor", "staff"] };
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
  return roles.map((r) => ({ value: r, label: tr(ROLE_INFO[r].label), hint: tr(ROLE_INFO[r].blurb) }));
}

/** Where a scoped member sits: branch managers and staff pick a branch, HODs and supervisors a department. */
function Placement({ role, branches, branchId, departmentId, onChange, lockBranch }: {
  role: Role;
  branches: Branch[];
  branchId: string;
  departmentId: string;
  onChange: (b: string, d: string) => void;
  lockBranch?: string | null;
}) {
  const t = useT();
  if (!SCOPED_ROLES.includes(role)) {
    const line = WHOLE_WORKSPACE[role];
    return <p className="text-[12.5px] text-muted">{line ? t(line) : t("{role} sees the whole workspace.", { role: t(ROLE_INFO[role].label) })}</p>;
  }
  const list = lockBranch ? branches.filter((b) => b.id === lockBranch) : branches;
  const branch = list.find((b) => b.id === branchId) ?? list[0];
  const needsDept = role === "hod" || role === "supervisor";
  const deptOptions = [
    ...(needsDept ? [] : [{ value: NONE, label: t("Any department") }]),
    ...(branch?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Branch")}</span>
        <Select value={branch?.id ?? ""} onValueChange={(v) => onChange(v, NONE)} label={t("Branch")} placeholder={t("Pick a branch")}
          options={list.map((b) => ({ value: b.id, label: b.name }))} />
      </div>
      {role === "branch_manager" ? null : (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{needsDept ? t("Department") : t("Department (optional)")}</span>
          <Select value={departmentId || (needsDept ? "" : NONE)} onValueChange={(v) => onChange(branch?.id ?? "", v)} label={t("Department")}
            placeholder={t("Pick a department")} options={deptOptions} />
        </div>
      )}
    </div>
  );
}

function placementBody(role: Role, branchId: string, departmentId: string) {
  if (!SCOPED_ROLES.includes(role)) return { branch_id: null, department_id: null };
  return { branch_id: branchId || null, department_id: departmentId && departmentId !== NONE && role !== "branch_manager" ? departmentId : null };
}

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
  const lockBranch = me.scope && me.scope.kind !== "all" ? me.scope.branch_id : null;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(roles.includes("staff") ? "staff" : roles[0] ?? "viewer");
  const [branchId, setBranchId] = useState(lockBranch ?? "");
  const [departmentId, setDepartmentId] = useState(me.scope?.kind === "department" ? me.scope.department_id ?? "" : "");
  const [result, setResult] = useState<{ email: string; password: string | null } | null>(null);

  const add = useMutation({
    mutationFn: () => api<{ temp_password: string | null }>("/api/members", "POST", { email, name, role, ...placementBody(role, branchId || branches[0]?.id || "", departmentId) }),
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
          <Select value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(roles)} label={t("Role")} />
          <p className="text-[12.5px] text-muted">{t(ROLE_INFO[role].blurb)}</p>
        </div>
        <Placement role={role} branches={branches} branchId={branchId} departmentId={departmentId} lockBranch={lockBranch}
          onChange={(b, d) => { setBranchId(b); setDepartmentId(d); }} />
        <FormError message={add.error && !Object.keys(fields).length ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** Role and place for one member, or (P82) for everyone ticked in the table at once. */
function AccessDialog({ members, me, open, onOpenChange, onDone }: {
  members: Member[];
  me: Me;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const roles = assignable(me);
  const lockBranch = me.scope && me.scope.kind !== "all" ? me.scope.branch_id : null;
  const one = members.length === 1 ? members[0] : null;
  const [role, setRole] = useState<Role>(one?.role ?? (roles.includes("staff") ? "staff" : roles[0] ?? "viewer"));
  const [branchId, setBranchId] = useState(one?.branch_id ?? lockBranch ?? "");
  const [departmentId, setDepartmentId] = useState(one?.department_id ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const place = placementBody(role, branchId || branches[0]?.id || "", departmentId);
      if (one) {
        await api(`/api/members/${one.user_id}`, "PATCH", { role, ...place });
        return { done: 1, skipped: 0, first: null as string | null };
      }
      const r = await api<BulkOut>("/api/members/bulk", "POST", { user_ids: members.map((m) => m.user_id), action: "access", role, ...place });
      return { done: r.done, skipped: r.skipped, first: r.results.find((x) => !x.ok)?.message ?? null };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      if (one) toast.success(t("{name} is now {role}.", { name: one.name, role: t(ROLE_INFO[role].label).toLowerCase() }));
      else bulkToast(r.done, r.skipped, r.first);
      onDone?.();
      onOpenChange(false);
    },
  });
  const options = one && !roles.includes(one.role) ? [one.role, ...roles] : roles;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}
      title={one ? t("Access for {name}", { name: one.name }) : t("Access for {n} people", { n: members.length })}
      description={one ? undefined : t("Everyone ticked gets this role and place. Anyone the rules stop is skipped and keeps what they have.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Role")}</span>
          <Select value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(options)} label={t("Role")} />
          <p className="text-[12.5px] text-muted">{t(ROLE_INFO[role].blurb)}</p>
        </div>
        <Placement role={role} branches={branches} branchId={branchId} departmentId={departmentId} lockBranch={lockBranch}
          onChange={(b, d) => { setBranchId(b); setDepartmentId(d); }} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
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

function Tick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
  );
}

/** The ⋯ menu of one member: role and place, password, two-step sign-in, remove. */
function MemberActions({ member, me }: { member: Member; me: Me }) {
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
  if (!editable) return <span aria-hidden className="block size-10" />;
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("Options for {name}", { name: member.name })}>
            <DotsThreeIcon size={20} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>{t("Change role or place")}</MenuItem>
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
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("Remove {name}?", { name: member.name })}
        body={t("They lose access to this workspace immediately and are signed out. Their personal agents stay, without an owner.")}
        confirmLabel={t("Remove")}
        danger
        onConfirm={async () => {
          try {
            await api(`/api/members/${member.user_id}`, "DELETE");
            refresh();
            toast.success(t("{name} removed.", { name: member.name }));
          } catch (e) {
            toast.error(errorMessage(e));
          }
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
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar member={member} isMe={isMe} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
          <span className="min-w-0 break-words">{member.name}</span>
          {isMe ? <Pill tone="accent">{t("You")}</Pill> : null}
          <TwoFactorPill userId={member.user_id} enabled={seesTwoFactor} />
        </p>
        <p className="text-[12.5px] break-all text-muted">{member.email}</p>
        {member.agents ? (
          <p className="text-[12px] text-muted">{member.agents === 1 ? t("1 personal agent") : t("{n} personal agents", { n: member.agents })}</p>
        ) : null}
      </div>
    </div>
  );
}

const COLUMNS: { key: MemberSort | null; label: string }[] = [
  { key: "name", label: msg("Name") },
  { key: "role", label: msg("Role") },
  { key: "company", label: msg("Company") },
  { key: "department", label: msg("Department") },
  { key: "last_seen", label: msg("Sign-in") },
  { key: null, label: msg("Status") },
];

function SortHeading({ col, f, onSort }: { col: (typeof COLUMNS)[number]; f: MembersFilters; onSort: (k: MemberSort) => void }) {
  const t = useT();
  const key = col.key;
  const on = key !== null && f.sort === key;
  return (
    <th scope="col" aria-sort={on ? (f.dir === "asc" ? "ascending" : "descending") : undefined}
      className="px-3 py-2.5 text-left text-[12px] font-medium tracking-wide text-muted uppercase">
      {key ? (
        <button type="button" onClick={() => onSort(key)} className={cn("inline-flex items-center gap-1 hover:text-fg", on && "text-fg")}>
          {t(col.label)}
          {on ? (f.dir === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />) : null}
        </button>
      ) : t(col.label)}
    </th>
  );
}

function MembersTable({ rows, me, f, onSort, selected, onTick, onTickPage, canBulk }: {
  rows: Member[];
  me: Me;
  f: MembersFilters;
  onSort: (k: MemberSort) => void;
  selected: Set<string>;
  onTick: (id: string) => void;
  onTickPage: () => void;
  canBulk: boolean;
}) {
  const t = useT();
  const seesTwoFactor = me.permissions.includes("members.manage");
  const others = rows.filter((m) => m.user_id !== me.user.id);
  const all = others.length > 0 && others.every((m) => selected.has(m.user_id));
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface md:block">
      <table className="w-full min-w-[56rem] border-collapse text-[13px]">
        <thead className="border-b border-border bg-surface-2/60">
          <tr>
            {canBulk ? (
              <th scope="col" className="w-10 px-3 py-2.5"><Tick checked={all} onChange={onTickPage} label={t("Select everyone on this page")} /></th>
            ) : null}
            {COLUMNS.map((c) => <SortHeading key={c.label} col={c} f={f} onSort={onSort} />)}
            <th scope="col" className="w-12 px-3 py-2.5"><span className="sr-only">{t("Actions")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((m) => (
            <tr key={m.user_id} className={cn("align-middle", selected.has(m.user_id) && "bg-accent-soft/40")}>
              {canBulk ? (
                <td className="px-3 py-2.5">
                  {m.user_id === me.user.id ? null : <Tick checked={selected.has(m.user_id)} onChange={() => onTick(m.user_id)} label={t("Select {name}", { name: m.name })} />}
                </td>
              ) : null}
              <td className="max-w-[20rem] px-3 py-2.5"><NameCell member={m} me={me} seesTwoFactor={seesTwoFactor} /></td>
              <td className="px-3 py-2.5"><RolePill role={m.role} /></td>
              <td className="px-3 py-2.5 break-words">{m.branch_name ?? <span className="text-muted">-</span>}</td>
              <td className="px-3 py-2.5 break-words">{m.department_name ?? <span className="text-muted">-</span>}</td>
              <td className="px-3 py-2.5"><SignIn member={m} /></td>
              <td className="px-3 py-2.5"><StatusPill member={m} /></td>
              <td className="px-1 py-1.5 text-right"><MemberActions member={m} me={me} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phones: one card per member instead of the table. */
function MemberCards({ rows, me, selected, onTick, canBulk }: {
  rows: Member[];
  me: Me;
  selected: Set<string>;
  onTick: (id: string) => void;
  canBulk: boolean;
}) {
  const t = useT();
  const seesTwoFactor = me.permissions.includes("members.manage");
  return (
    <ul className="grid gap-2 md:hidden">
      {rows.map((m) => {
        const place = [m.department_name, m.branch_name].filter(Boolean).join(", ");
        return (
          <li key={m.user_id} className={cn("grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3", selected.has(m.user_id) && "border-accent/40 bg-accent-soft/40")}>
            <div className="flex items-start gap-2">
              {canBulk && m.user_id !== me.user.id ? (
                <span className="pt-2.5"><Tick checked={selected.has(m.user_id)} onChange={() => onTick(m.user_id)} label={t("Select {name}", { name: m.name })} /></span>
              ) : null}
              <div className="min-w-0 flex-1"><NameCell member={m} me={me} seesTwoFactor={seesTwoFactor} /></div>
              <MemberActions member={m} me={me} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RolePill role={m.role} />
              <StatusPill member={m} />
              {place ? <span className="text-[12px] break-words text-muted">{place}</span> : null}
            </div>
            <SignIn member={m} />
          </li>
        );
      })}
    </ul>
  );
}

function Pager({ f, total, onChange }: { f: MembersFilters; total: number; onChange: (c: Partial<MembersFilters>) => void }) {
  const t = useT();
  const { pages, from, to } = pageRange(f.page, f.pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-muted tabular">{total ? t("Showing {from} to {to} of {total}", { from, to, total }) : null}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select size="sm" className="w-36" label={t("Rows per page")} value={String(f.pageSize)}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: t("{n} a page", { n }) }))}
          onValueChange={(v) => onChange({ pageSize: Number(v) as PageSize })} />
        <Button size="sm" variant="outline" disabled={f.page <= 1} onClick={() => onChange({ page: f.page - 1 })} aria-label={t("Previous page")}>
          <CaretLeftIcon size={14} />
        </Button>
        <span className="text-[13px] tabular">{t("Page {page} of {pages}", { page: Math.min(f.page, pages), pages })}</span>
        <Button size="sm" variant="outline" disabled={f.page >= pages} onClick={() => onChange({ page: f.page + 1 })} aria-label={t("Next page")}>
          <CaretRightIcon size={14} />
        </Button>
      </div>
    </div>
  );
}

export function MembersPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const canAdd = hasAny(me, "members.manage", "team.manage") && assignable(me).length > 0;
  const { data: branches = [] } = useQuery(branchesQuery);
  const [f, setF] = useState<MembersFilters>(FIRST_PAGE);
  const [typed, setTyped] = useState("");
  // The search box asks the server once typing settles; a new search starts on page 1.
  const q = useDebounced(typed, 300);
  const filters = q.trim() === f.q ? f : withFilter(f, { q: q.trim() });
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: [...keys.members, "page", filters],
    queryFn: () => api<MembersPage>(membersPageUrl(filters)),
    placeholderData: keepPreviousData,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAccess, setBulkAccess] = useState(false);
  const [bulkRemove, setBulkRemove] = useState(false);
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
  const change = (c: Partial<MembersFilters>) => {
    setF(withFilter(filters, c));
    if (!("page" in c) && !("pageSize" in c)) setSelected(new Set()); // ticks follow the filters
  };
  const clearAll = () => {
    setTyped("");
    setF(FIRST_PAGE);
    setSelected(new Set());
  };
  const rows = data?.items ?? [];
  const summary = data?.summary;
  const total = data?.total ?? 0;
  const pageIds = rows.filter((m) => m.user_id !== me.user.id).map((m) => m.user_id);
  const tick = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  // The ticked people this page shows (the role dialog needs their names and roles).
  const ticked = rows.filter((m) => selected.has(m.user_id));
  const filtered = !!(filters.q || filters.company || filters.role || filters.status);
  const removeTicked = async () => {
    try {
      const r = await api<BulkOut>("/api/members/bulk", "POST", { user_ids: [...selected], action: "remove" });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: keys.status });
      bulkToast(r.done, r.skipped, r.results.find((x) => !x.ok)?.message ?? null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("Members")}
        description={scoped ? t("People in {place}, and what their role lets them do.", { place: me.scope?.label ?? "" }) : t("People who can sign in to this workspace, where they sit, and what their role lets them do.")}
        actions={canAdd ? (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <FileXlsIcon size={16} /> {t("Import from Excel")}
            </Button>
            <Button data-guide="settings.add" onClick={openAdd}>
              <UserPlusIcon size={16} weight="bold" /> {t("Add member")}
            </Button>
          </>
        ) : null}
      />
      {me.permissions.includes("members.manage") ? <SignInEmailsBar isOwner={me.role === "owner"} /> : null}
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
              onClick={() => change({ status: filters.status === "pending" ? "" : "pending" })} active={filters.status === "pending"} />
            <Stat label={t("Signed in with Microsoft")} value={summary.microsoft} icon={MicrosoftOutlookLogoIcon} tone="info" hint={t("Their work account is connected")} />
          </StatGrid>

          <div data-guide="settings.list" className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[17px] font-semibold tabular">
                {summary.members === 1 ? t("1 member") : t("{n} members", { n: summary.members })}
              </h2>
              {filtered ? <p className="text-[13px] text-muted tabular">{t("{n} match the filters", { n: total })}</p> : null}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
              <SearchInput value={typed} onChange={setTyped} placeholder={t("Search by name or email")} className="sm:col-span-2 lg:col-span-1" />
              <Select label={t("Company")} value={filters.company || "all"} onValueChange={(v) => change({ company: v === "all" ? "" : v })}
                options={[{ value: "all", label: t("All companies") }, { value: "none", label: t("No company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              <Select label={t("Role")} value={filters.role || "all"} onValueChange={(v) => change({ role: v === "all" ? "" : (v as Role) })}
                options={[{ value: "all", label: t("All roles") }, ...ROLES.map((r) => ({ value: r, label: t(ROLE_INFO[r].label) }))]} />
              <Select label={t("Status")} value={filters.status || "all"} onValueChange={(v) => change({ status: v === "all" ? "" : (v as MemberStatus) })}
                options={[{ value: "all", label: t("All statuses") }, ...(Object.keys(STATUS_INFO) as MemberStatus[]).map((s) => ({ value: s, label: t(STATUS_INFO[s].label) }))]} />
            </div>
            <div className="flex flex-wrap items-center gap-2 md:hidden">
              <Select size="sm" className="w-56" label={t("Sort by")} value={`${filters.sort}:${filters.dir}`}
                onValueChange={(v) => {
                  const [sort, dir] = v.split(":") as [MemberSort, "asc" | "desc"];
                  change({ sort, dir });
                }}
                options={[
                  { value: "name:asc", label: t("Name, A to Z") },
                  { value: "name:desc", label: t("Name, Z to A") },
                  { value: "company:asc", label: t("Company") },
                  { value: "role:asc", label: t("Role") },
                  { value: "last_seen:desc", label: t("Signed in most recently") },
                  { value: "joined:desc", label: t("Joined most recently") },
                ]} />
              {canAdd && pageIds.length ? (
                <Button size="sm" variant="outline" onClick={() => setSelected(toggleAll(selected, pageIds))}>
                  {pageIds.every((id) => selected.has(id)) ? t("Untick this page") : t("Tick this page")}
                </Button>
              ) : null}
            </div>

            {canAdd && selected.size ? (
              <div role="region" aria-label={t("Ticked members")}
                className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-surface px-3 py-2 shadow-sm">
                <span className="text-[13px] font-medium tabular">{selected.size === 1 ? t("1 ticked") : t("{n} ticked", { n: selected.size })}</span>
                <Button size="sm" variant="secondary" disabled={!ticked.length} onClick={() => setBulkAccess(true)}>
                  <PencilSimpleIcon size={14} /> {t("Change role or place")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBulkRemove(true)}>
                  <TrashIcon size={14} /> {t("Remove")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <XIcon size={14} /> {t("Clear")}
                </Button>
                {ticked.length < selected.size ? (
                  <span className="text-[12px] text-muted">{t("A role change applies to the ticked people on this page.")}</span>
                ) : null}
              </div>
            ) : null}

            {rows.length ? (
              <div className={cn("grid gap-3 transition-opacity", isFetching && "opacity-70")}>
                <MembersTable rows={rows} me={me} f={filters} canBulk={canAdd} selected={selected}
                  onSort={(k) => change(nextSort(filters, k))} onTick={tick} onTickPage={() => setSelected(toggleAll(selected, pageIds))} />
                <MemberCards rows={rows} me={me} canBulk={canAdd} selected={selected} onTick={tick} />
                <Pager f={filters} total={total} onChange={change} />
              </div>
            ) : (
              <EmptyState icon={UsersIcon} title={t("Nobody matches")} body={t("Try another name or email, or clear the filters.")}
                action={<Button variant="outline" onClick={clearAll}>{t("Clear the filters")}</Button>} />
            )}
          </div>
        </>
      ) : null}

      <Section title={t("Roles")} description={t("What each role lets a person do. Scoped roles only see their own part of the workspace.")}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => {
            const count = summary?.roles[r] ?? 0;
            return (
              <div key={r} className="grid content-start gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  <span className="min-w-0 flex-1">{t(ROLE_INFO[r].label)}</span>
                  {SCOPED_ROLES.includes(r) ? <Pill tone="info">{r === "staff" ? t("Own agents") : r === "branch_manager" ? t("One branch") : t("One department")}</Pill> : null}
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
        <ImportMembersDialog open onOpenChange={setImporting} roles={assignable(me)} lockBranch={scoped ? me.scope?.branch_id ?? null : null} />
      ) : null}
      {bulkAccess ? (
        <AccessDialog members={ticked} me={me} open={bulkAccess} onOpenChange={setBulkAccess} onDone={() => setSelected(new Set())} />
      ) : null}
      <ConfirmDialog
        open={bulkRemove}
        onOpenChange={setBulkRemove}
        title={selected.size === 1 ? t("Remove 1 person?") : t("Remove {n} people?", { n: selected.size })}
        body={t("They lose access to this workspace immediately and are signed out. Their personal agents stay, without an owner.")}
        confirmLabel={t("Remove")}
        danger
        onConfirm={removeTicked}
      />
    </Page>
  );
}
