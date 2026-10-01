import { CopyIcon, DotsThreeIcon, KeyIcon, TrashIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys, meQuery, membersQuery } from "@/lib/queries";
import { ROLE_INFO, type Member, type Role } from "@/lib/types";
import { initials, timeAgo } from "@/lib/utils";

const ROLES: Role[] = ["owner", "admin", "operator", "approver", "viewer"];

function roleOptions(canAssignOwner: boolean) {
  return ROLES.map((r) => ({
    value: r,
    label: ROLE_INFO[r].label,
    hint: ROLE_INFO[r].blurb,
    disabled: r === "owner" && !canAssignOwner,
  }));
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
        <code className="flex-1 font-mono text-[15px] tracking-wide select-all">{password}</code>
        <Button size="sm" variant="outline" onClick={copy}>
          <CopyIcon size={15} /> Copy
        </Button>
      </div>
    </div>
  );
}

function AddMemberDialog({ open, onOpenChange, canAssignOwner }: { open: boolean; onOpenChange: (o: boolean) => void; canAssignOwner: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [result, setResult] = useState<{ email: string; password: string | null } | null>(null);
  // Remounted with a fresh `key` per open, so fields always start empty.

  const add = useMutation({
    mutationFn: () => api<{ temp_password: string | null }>("/api/members", "POST", { email, name, role }),
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
          <Select value={role} onValueChange={(v) => setRole(v as Role)} options={roleOptions(canAssignOwner)} label="Role" />
        </div>
        <FormError message={add.error && !Object.keys(fields).length ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function MemberRow({ member, meId, canManage, canAssignOwner }: { member: Member; meId: string; canManage: boolean; canAssignOwner: boolean }) {
  const qc = useQueryClient();
  const isMe = member.user_id === meId;
  const editable = canManage && !isMe && (member.role !== "owner" || canAssignOwner);
  const [removing, setRemoving] = useState(false);
  const [reset, setReset] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.members });
    qc.invalidateQueries({ queryKey: keys.status });
  };
  const changeRole = useMutation({
    mutationFn: (role: Role) => api(`/api/members/${member.user_id}`, "PATCH", { role }),
    onSuccess: (_, role) => { refresh(); toast.success(`${member.name} is now ${ROLE_INFO[role].label.toLowerCase()}.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resetPw = useMutation({
    mutationFn: () => api<{ temp_password: string }>(`/api/members/${member.user_id}/reset-password`, "POST"),
    onSuccess: (r) => { refresh(); setReset(r.temp_password); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[12.5px] font-semibold text-accent">
          {initials(member.name)}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
            {member.name}
            {isMe ? <Pill tone="accent">You</Pill> : null}
            {member.must_change_password ? <Pill tone="warn">Temporary password</Pill> : null}
          </p>
          <p className="truncate text-[12.5px] text-muted">
            {member.email} · signed in {timeAgo(member.last_login_at).toLowerCase()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {editable ? (
          <Select
            size="sm"
            value={member.role}
            onValueChange={(v) => changeRole.mutate(v as Role)}
            options={roleOptions(canAssignOwner)}
            label={`Role for ${member.name}`}
            className="w-32"
          />
        ) : (
          <Pill className="capitalize">{member.role}</Pill>
        )}
        {editable ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Options for ${member.name}`}>
                <DotsThreeIcon size={20} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<KeyIcon />} onSelect={() => resetPw.mutate()}>Reset password</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Remove from workspace</MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${member.name}?`}
        body="They lose access to this workspace immediately and are signed out."
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
  const canManage = me.permissions.includes("members.manage");
  const canAssignOwner = me.permissions.includes("members.assign_owner");
  const { data: members, isLoading, error } = useQuery(membersQuery);
  const search = useSearch({ strict: false }) as { add?: number };
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  // "Add member" from the palette arrives as ?add=1.
  const addOpen = adding || (!!search.add && canManage);
  const openAdd = () => { setAddKey((k) => k + 1); setAdding(true); };
  const setAddOpen = (o: boolean) => {
    setAdding(o);
    if (!o && search.add) navigate({ to: "/settings/members", search: {}, replace: true });
  };

  return (
    <Page>
      <PageHeader
        title="Members"
        description="People who can sign in to this workspace, and what their role lets them do."
        actions={canManage ? (
          <Button onClick={openAdd}>
            <UserPlusIcon size={16} weight="bold" /> Add member
          </Button>
        ) : null}
      />
      {isLoading ? (
        <Skeleton className="h-48 rounded-[var(--radius-md)]" />
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          Could not load members. {errorMessage(error)}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
          {members?.map((m) => (
            <MemberRow key={m.user_id} member={m} meId={me.user.id} canManage={canManage} canAssignOwner={canAssignOwner} />
          ))}
        </ul>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-[var(--radius-md)] border border-border px-4 py-3">
            <p className="text-[13.5px] font-medium">{ROLE_INFO[r].label}</p>
            <p className="text-[12.5px] text-muted">{ROLE_INFO[r].blurb}</p>
          </div>
        ))}
      </div>
      <AddMemberDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} canAssignOwner={canAssignOwner} />
    </Page>
  );
}
