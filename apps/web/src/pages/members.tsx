import { CopyIcon, CrownSimpleIcon, DotsThreeIcon, KeyIcon, PencilSimpleIcon, RobotIcon, TrashIcon, UserPlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, ApiError, errorMessage } from "@/lib/api";
import { branchesQuery, keys, meQuery, membersQuery } from "@/lib/queries";
import { hasAny, ROLE_INFO, SCOPED_ROLES, type Branch, type Me, type Member, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

const ROLES: Role[] = ["owner", "admin", "branch_manager", "hod", "supervisor", "staff", "operator", "approver", "viewer"];
// What a branch manager or HOD may hand out (mirrors api/routers/members.py TEAM_ROLES).
const TEAM_ROLES: Partial<Record<Role, Role[]>> = { branch_manager: ["hod", "supervisor", "staff"], hod: ["supervisor", "staff"] };
const NONE = "none";

function assignable(me: Me): Role[] {
  if (me.permissions.includes("members.manage")) {
    return ROLES.filter((r) => r !== "owner" || me.permissions.includes("members.assign_owner"));
  }
  return TEAM_ROLES[me.role] ?? [];
}

function roleOptions(roles: Role[]) {
  return roles.map((r) => ({ value: r, label: ROLE_INFO[r].label, hint: ROLE_INFO[r].blurb }));
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
  if (!SCOPED_ROLES.includes(role)) {
    return <p className="text-[12.5px] text-muted">{ROLE_INFO[role].label}s see the whole workspace.</p>;
  }
  const list = lockBranch ? branches.filter((b) => b.id === lockBranch) : branches;
  const branch = list.find((b) => b.id === branchId) ?? list[0];
  const needsDept = role === "hod" || role === "supervisor";
  const deptOptions = [
    ...(needsDept ? [] : [{ value: NONE, label: "Any department" }]),
    ...(branch?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Branch</span>
        <Select value={branch?.id ?? ""} onValueChange={(v) => onChange(v, NONE)} label="Branch" placeholder="Pick a branch"
          options={list.map((b) => ({ value: b.id, label: b.name }))} />
      </div>
      {role === "branch_manager" ? null : (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Department{needsDept ? "" : " (optional)"}</span>
          <Select value={departmentId || (needsDept ? "" : NONE)} onValueChange={(v) => onChange(branch?.id ?? "", v)} label="Department"
            placeholder="Pick a department" options={deptOptions} />
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Copied.");
    } catch {
      toast.error("Copy blocked by the browser. Select the password and copy it by hand.");
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px] text-muted">
        Give this temporary password to <span className="font-medium text-fg">{email}</span>. It is shown only once. They will pick their own password the first time they sign in.
      </p>
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 p-1.5 pl-3">
        <code className="min-w-0 flex-1 font-mono text-[15px] tracking-wide break-all select-all">{password}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          <CopyIcon size={15} /> Copy
        </Button>
      </div>
    </div>
  );
}

function AddMemberDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (o: boolean) => void; me: Me }) {
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
      if (!r.temp_password) toast.success(`${email} added. They sign in with their existing password.`);
    },
  });
  const fields = add.error instanceof ApiError ? add.error.fields : {};

  if (result?.password) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Member added" footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}>
        <TempPassword email={result.email} password={result.password} />
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add member"
      description="They get a temporary password to sign in with."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={add.isPending} disabled={!email || !name} onClick={() => add.mutate(undefined, { onSuccess: (r) => !r.temp_password && onOpenChange(false) })}>
            Add member
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus error={fields.name} />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Role</span>
          <Select value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(roles)} label="Role" />
          <p className="text-[12.5px] text-muted">{ROLE_INFO[role].blurb}</p>
        </div>
        <Placement role={role} branches={branches} branchId={branchId} departmentId={departmentId} lockBranch={lockBranch}
          onChange={(b, d) => { setBranchId(b); setDepartmentId(d); }} />
        <FormError message={add.error && !Object.keys(fields).length ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function AccessDialog({ member, me, open, onOpenChange }: { member: Member; me: Me; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const roles = assignable(me);
  const lockBranch = me.scope && me.scope.kind !== "all" ? me.scope.branch_id : null;
  const [role, setRole] = useState<Role>(member.role);
  const [branchId, setBranchId] = useState(member.branch_id ?? lockBranch ?? "");
  const [departmentId, setDepartmentId] = useState(member.department_id ?? "");
  const save = useMutation({
    mutationFn: () => api(`/api/members/${member.user_id}`, "PATCH", { role, ...placementBody(role, branchId || branches[0]?.id || "", departmentId) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.members });
      toast.success(`${member.name} is now ${ROLE_INFO[role].label.toLowerCase()}.`);
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Access for ${member.name}`}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Role</span>
          <Select value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(roles.includes(member.role) ? roles : [member.role, ...roles])} label="Role" />
          <p className="text-[12.5px] text-muted">{ROLE_INFO[role].blurb}</p>
        </div>
        <Placement role={role} branches={branches} branchId={branchId} departmentId={departmentId} lockBranch={lockBranch}
          onChange={(b, d) => { setBranchId(b); setDepartmentId(d); }} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function where(m: Member): string | null {
  if (m.department_name && m.branch_name) return `${m.department_name}, ${m.branch_name}`;
  return m.branch_name ?? null;
}

function MemberRow({ member, me }: { member: Member; me: Me }) {
  const qc = useQueryClient();
  const isMe = member.user_id === me.user.id;
  const roles = assignable(me);
  const editable = !isMe && roles.includes(member.role) && hasAny(me, "members.manage", "team.manage");
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reset, setReset] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.members });
    qc.invalidateQueries({ queryKey: keys.status });
  };
  const resetPw = useMutation({
    mutationFn: () => api<{ temp_password: string }>(`/api/members/${member.user_id}/reset-password`, "POST"),
    onSuccess: (r) => { refresh(); setReset(r.temp_password); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const place = where(member);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-5">
      <span
        className={cn(
          "row-span-2 grid size-10 shrink-0 place-items-center self-start rounded-full text-[12.5px] font-semibold ring-1 sm:row-span-1 sm:self-center",
          isMe ? "bg-accent text-accent-fg ring-accent/30" : "bg-accent-soft text-accent ring-accent/15",
        )}
      >
        {initials(member.name)}
      </span>
      <div className="col-start-2 row-start-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
          <span className="min-w-0 break-words">{member.name}</span>
          {isMe ? <Pill tone="accent">You</Pill> : null}
          {member.must_change_password ? <Pill tone="warn">Temporary password</Pill> : null}
        </p>
        <p className="text-[12.5px] break-all text-muted">{member.email}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
          <Meta
            items={[
              member.last_login_at ? `Signed in ${timeAgo(member.last_login_at).toLowerCase()}` : "Never signed in",
              member.agents ? `${member.agents} personal agent${member.agents === 1 ? "" : "s"}` : null,
            ]}
          />
        </p>
      </div>
      <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:col-start-3 sm:row-start-1 sm:grid sm:justify-items-end sm:gap-0.5 sm:text-right">
        <Pill tone={member.role === "owner" || member.role === "admin" ? "accent" : "neutral"}>{ROLE_INFO[member.role]?.label ?? member.role}</Pill>
        {place ? <span className="text-[12px] break-words text-muted">{place}</span> : null}
      </div>
      <div className="col-start-3 row-start-1 sm:col-start-4">
        {editable ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Options for ${member.name}`}>
                <DotsThreeIcon size={20} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>Change role or place</MenuItem>
              <MenuItem icon={<KeyIcon />} onSelect={() => resetPw.mutate()}>Reset password</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Remove from workspace</MenuItem>
            </MenuContent>
          </Menu>
        ) : <span aria-hidden className="block size-10" />}
      </div>
      {editing ? <AccessDialog member={member} me={me} open={editing} onOpenChange={setEditing} /> : null}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${member.name}?`}
        body="They lose access to this workspace immediately and are signed out. Their personal agents stay, without an owner."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          try {
            await api(`/api/members/${member.user_id}`, "DELETE");
            refresh();
            toast.success(`${member.name} removed.`);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      <ResponsiveDialog open={!!reset} onOpenChange={() => setReset(null)} title="Password reset" footer={<Button onClick={() => setReset(null)}>Done</Button>}>
        {reset ? <TempPassword email={member.email} password={reset} /> : null}
      </ResponsiveDialog>
    </li>
  );
}

export function MembersPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canAdd = hasAny(me, "members.manage", "team.manage") && assignable(me).length > 0;
  const { data: members, isLoading, error } = useQuery(membersQuery);
  const search = useSearch({ strict: false }) as { add?: number };
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  // "Add member" from the palette arrives as ?add=1.
  const addOpen = adding || (!!search.add && canAdd);
  const openAdd = () => { setAddKey((k) => k + 1); setAdding(true); };
  const setAddOpen = (o: boolean) => {
    setAdding(o);
    if (!o && search.add) navigate({ to: "/settings/members", search: {}, replace: true });
  };
  const scoped = me.scope && me.scope.kind !== "all";
  const list = members ?? [];

  return (
    <Page>
      <PageHeader
        title="Members"
        description={scoped ? `People in ${me.scope?.label}, and what their role lets them do.` : "People who can sign in to this workspace, where they sit, and what their role lets them do."}
        actions={canAdd ? (
          <Button onClick={openAdd}>
            <UserPlusIcon size={16} weight="bold" /> Add member
          </Button>
        ) : null}
      />
      {isLoading ? (
        <div className="grid gap-4">
          <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
          <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          Could not load members. {errorMessage(error)}
        </div>
      ) : (
        <>
          <StatGrid>
            <Stat label="Members" value={list.length} icon={UsersIcon} hint="Can sign in here" />
            <Stat label="Owners and admins" value={list.filter((m) => m.role === "owner" || m.role === "admin").length} icon={CrownSimpleIcon} tone="violet" hint="Full workspace access" />
            <Stat label="Temporary password" value={list.filter((m) => m.must_change_password).length} icon={KeyIcon} tone={list.some((m) => m.must_change_password) ? "warn" : "neutral"} hint="Yet to pick their own" />
            <Stat label="Personal agents" value={list.reduce((n, m) => n + (m.agents ?? 0), 0)} icon={RobotIcon} tone="info" hint="Owned by members" />
          </StatGrid>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {list.map((m) => <MemberRow key={m.user_id} member={m} me={me} />)}
          </ul>
        </>
      )}

      <Section title="Roles" description="What each role lets a person do. Scoped roles only see their own part of the workspace.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => {
            const count = list.filter((m) => m.role === r).length;
            return (
              <div key={r} className="grid content-start gap-1 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  <span className="min-w-0 flex-1">{ROLE_INFO[r].label}</span>
                  {SCOPED_ROLES.includes(r) ? <Pill tone="info">{r === "staff" ? "Own agents" : r === "branch_manager" ? "One branch" : "One department"}</Pill> : null}
                </p>
                <p className="text-[12.5px] text-muted">{ROLE_INFO[r].blurb}</p>
                <p className="text-[12px] text-muted tabular">{count ? `${count} ${count === 1 ? "member" : "members"}` : "Nobody yet"}</p>
              </div>
            );
          })}
        </div>
      </Section>
      <AddMemberDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} me={me} />
    </Page>
  );
}
