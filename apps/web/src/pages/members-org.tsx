/**
 * P97: the organisation around a member. A department made right from the member editor, who
 * heads a department, who reports to whom ("Manages"), and placing many people under one
 * manager at once. Who may change it: owners, admins, management and HR (members.manage), as
 * the server decides (api/routers/members.py set_manager / set_head).
 */
import { CrownSimpleIcon, PlusIcon, TreeStructureIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PeoplePicker, type PickPerson } from "@/components/people-picker";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { MultiSelect, SearchSelect } from "@/components/ui/search-select";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { MANAGER_ROLES } from "@/lib/people";
import { branchesQuery, keys, membersQuery } from "@/lib/queries";
import { ROLE_INFO, type Department, type Me, type Member } from "@/lib/types";

export const NEW_DEPT = "__new__";

/** Who may set who reports to whom and who heads a department. */
export const editsOrg = (me: Me) => me.permissions.includes("members.manage");
/** Who may add a department (as on the Organization page). */
export const addsDepartments = (me: Me) => me.permissions.includes("org.manage");

/** "+ New department" right under the department dropdown: type a name, Add, and it is picked. */
export function NewDepartment({ branchId, onMade, onCancel }: { branchId: string; onMade: (d: Department) => void; onCancel: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => api<Department>(`/api/branches/${branchId}/departments`, "POST", { name: name.trim() }),
    onSuccess: async (d) => {
      await qc.invalidateQueries({ queryKey: keys.branches });
      toast.success(t("{name} added.", { name: d.name }));
      onMade(d);
    },
  });
  return (
    <form className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-accent/40 bg-accent-soft/20 p-3"
      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (name.trim()) add.mutate(); }}>
      <Field label={t("New department name")} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} placeholder={t("For example: Procurement")} />
      <FormError message={add.error ? errorMessage(add.error) : null} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" loading={add.isPending} disabled={!name.trim()}><PlusIcon size={14} weight="bold" /> {t("Add department")}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}

/** The people who may be someone's manager (a role that manages people), but not themselves. */
export function managerOptions(members: Member[], exceptId?: string) {
  return members
    .filter((m) => MANAGER_ROLES.includes(m.role) && m.user_id !== exceptId && m.is_active)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({ value: m.user_id, label: m.name, hint: [tr(ROLE_INFO[m.role].label), m.department_name].filter(Boolean).join(", ") }));
}

const NO_ONE = "none";

/** Reports to (a manager) and heads their department: part of the member editor. */
export function OrgFields({ member, members, reportsTo, onReportsTo, heads, onHeads, hasDepartment }: {
  member: Member;
  members: Member[];
  reportsTo: string;
  onReportsTo: (v: string) => void;
  heads: boolean;
  onHeads: (v: boolean) => void;
  hasDepartment: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
      <legend className="px-1 text-[13px] font-medium">{t("Team")}</legend>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Reports to")}</span>
        <SearchSelect value={reportsTo || NO_ONE} onValueChange={(v) => onReportsTo(v === NO_ONE ? "" : v)} label={t("Reports to")}
          searchPlaceholder={t("Search people")} options={[{ value: NO_ONE, label: t("No one") }, ...managerOptions(members, member.user_id)]} />
        <p className="text-[12.5px] text-muted">{t("Their manager can give them tasks and follows their work.")}</p>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" checked={heads} disabled={!hasDepartment} onChange={(e) => onHeads(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
        <span className="grid gap-0.5">
          <span className="text-[13.5px] font-medium">{t("Heads this department")}</span>
          <span className="text-[12.5px] text-muted">{hasDepartment ? t("A department can have more than one head.") : t("Pick a department first.")}</span>
        </span>
      </label>
    </fieldset>
  );
}

type TeamSave = { done: number; skipped: number; results: { ok: boolean; message: string | null }[] };

/** P98: exactly these people report to this manager (the rest who did report to no one). */
export const saveManages = (userId: string, ids: string[]) => api<TeamSave>(`/api/members/${userId}/team`, "PUT", { user_ids: ids });

/** P98: "Staff they manage" in the member editor: search and tick many at once (or take some
 * away); saving sets those people's "reports to". `value` null: not changed yet (shows the
 * people who report to them now). */
export function ManagesField({ member, members, value, onChange }: {
  member: Member;
  members: Member[];
  value: string[] | null;
  onChange: (ids: string[]) => void;
}) {
  const t = useT();
  const team = useQuery({ queryKey: [...keys.members, "team", member.user_id], queryFn: () => api<Member[]>(`/api/members/${member.user_id}/team`) });
  const now = (team.data ?? []).map((m) => m.user_id);
  const none = t("No department");
  const options = members
    .filter((m) => m.user_id !== member.user_id && m.is_active)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      value: m.user_id,
      label: m.name,
      keywords: [m.email],
      group: m.department_name ?? none,
      hint: [tr(ROLE_INFO[m.role].label), m.department_name, m.reports_to_user_id && m.reports_to_user_id !== member.user_id && m.reports_to_name ? t("now reports to {name}", { name: m.reports_to_name }) : null].filter(Boolean).join(" · "),
    }))
    // Grouped by department (A to Z), people with none last; by name inside each.
    .sort((a, b) => Number(a.group === none) - Number(b.group === none) || a.group.localeCompare(b.group));
  const sameDept = member.department_id ? members.filter((m) => m.department_id === member.department_id && m.user_id !== member.user_id && m.is_active).map((m) => m.user_id) : [];
  const current = value ?? now;
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">{t("Staff they manage")}</span>
      {team.isLoading ? <Skeleton className="h-10" /> : (
        <MultiSelect value={current} onValueChange={onChange} label={t("Staff they manage")} placeholder={t("Pick the people who report to them")}
          searchPlaceholder={t("Search by name, email or department")} options={options} />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted">{t("They can give these people tasks and follow their work. Someone who reports to another manager moves to them.")}</p>
        {member.department_name && sameDept.some((id) => !current.includes(id)) ? (
          <button type="button" className="text-[12.5px] font-medium text-accent hover:underline"
            onClick={() => onChange([...current, ...sameDept.filter((id) => !current.includes(id))])}>
            {t("+ Everyone in {department}", { department: member.department_name })}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Under a member's name: heads a department, reports to someone, manages people. */
export function OrgLine({ member, onTeam }: { member: Member; onTeam?: () => void }) {
  const t = useT();
  if (!member.heads_department && !member.reports_to_name && !member.manages) return null;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
      {member.heads_department ? (
        <Pill tone="accent"><CrownSimpleIcon size={11} weight="fill" /> {t("Head of {department}", { department: member.department_name ?? t("department") })}</Pill>
      ) : null}
      {member.manages ? (
        onTeam ? (
          <button type="button" onClick={onTeam} className="inline-flex min-h-6 items-center gap-1 font-medium text-accent hover:underline">
            <UsersThreeIcon size={12} weight="bold" /> {member.manages === 1 ? t("Manages 1 person") : t("Manages {n} people", { n: member.manages })}
          </button>
        ) : <span className="inline-flex items-center gap-1"><UsersThreeIcon size={12} /> {member.manages === 1 ? t("Manages 1 person") : t("Manages {n} people", { n: member.manages })}</span>
      ) : null}
      {member.reports_to_name ? <span className="inline-flex items-center gap-1"><TreeStructureIcon size={12} /> {t("Reports to {name}", { name: member.reports_to_name })}</span> : null}
    </p>
  );
}

/** "Manages": the people who report to this member. Editable by members.manage, read only otherwise. */
export function TeamDialog({ member, me, open, onOpenChange }: { member: Member; me: Me; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = editsOrg(me) && MANAGER_ROLES.includes(member.role);
  const team = useQuery({ queryKey: [...keys.members, "team", member.user_id], queryFn: () => api<Member[]>(`/api/members/${member.user_id}/team`), enabled: open });
  const all = useQuery({ ...membersQuery, enabled: open && canEdit });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const value = picked ?? new Set((team.data ?? []).map((m) => m.user_id));
  const save = useMutation({
    mutationFn: () => api<{ done: number; skipped: number; results: { ok: boolean; message: string | null }[] }>(`/api/members/${member.user_id}/team`, "PUT", { user_ids: [...value] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      const first = r.results.find((x) => !x.ok)?.message;
      if (r.skipped) toast.warning(first ? `${t("{n} people skipped.", { n: r.skipped })} ${first}` : t("{n} people skipped.", { n: r.skipped }));
      else toast.success(t("Saved."));
      onOpenChange(false);
    },
  });
  const people: PickPerson[] = (all.data ?? [])
    .filter((m) => m.user_id !== member.user_id && m.is_active)
    .map((m) => ({
      user_id: m.user_id,
      name: m.name,
      line: [tr(ROLE_INFO[m.role].label), m.department_name, m.reports_to_user_id && m.reports_to_user_id !== member.user_id && m.reports_to_name ? t("now reports to {name}", { name: m.reports_to_name }) : null].filter(Boolean).join(" · "),
    }));
  const sameDept = member.department_id ? (all.data ?? []).filter((m) => m.department_id === member.department_id && m.user_id !== member.user_id && m.is_active).map((m) => m.user_id) : [];
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPicked(null); }}
      title={t("Who {name} manages", { name: member.name })}
      description={canEdit ? t("Tick the people who report to {name}. They can give them tasks and follow their work. Someone who reports to another manager moves to {name}.", { name: member.name }) : undefined}
      footer={canEdit ? (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button loading={save.isPending} disabled={team.isLoading} onClick={() => save.mutate()}>{t("Save")}</Button>
        </>
      ) : <Button onClick={() => onOpenChange(false)}>{t("Done")}</Button>}>
      {team.isLoading || (canEdit && all.isLoading) ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : canEdit ? (
        <div className="grid gap-3">
          <PeoplePicker label={t("People {name} manages", { name: member.name })} people={people} value={value} onChange={setPicked}
            quick={member.department_name ? [{ label: t("Everyone in {department}", { department: member.department_name }), ids: sameDept }] : undefined} />
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      ) : team.data?.length ? (
        <ul className="grid divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {team.data.map((m) => (
            <li key={m.user_id} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-[13px] font-medium">{m.name}</span>
              <span className="shrink-0 text-[12px] text-muted">{m.department_name ?? tr(ROLE_INFO[m.role].label)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{t("Nobody reports to {name} yet.", { name: member.name })}</p>}
    </ResponsiveDialog>
  );
}

/** Everyone ticked reports to one manager (or to no one). */
export function BulkManagerDialog({ userIds, open, onOpenChange, onDone }: { userIds: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const all = useQuery({ ...membersQuery, enabled: open });
  const [manager, setManager] = useState(NO_ONE);
  const save = useMutation({
    mutationFn: () => api<{ done: number; skipped: number; results: { ok: boolean; message: string | null }[] }>("/api/members/bulk", "POST", { user_ids: userIds, action: "manager", manager_id: manager === NO_ONE ? null : manager }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      if (r.done) toast.success(r.done === 1 ? t("1 person changed.") : t("{n} people changed.", { n: r.done }));
      const first = r.results.find((x) => !x.ok)?.message;
      if (r.skipped) toast.warning(first ? `${t("{n} people skipped.", { n: r.skipped })} ${first}` : t("{n} people skipped.", { n: r.skipped }));
      onDone();
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}
      title={userIds.length === 1 ? t("Who 1 person reports to") : t("Who {n} people report to", { n: userIds.length })}
      description={t("Everyone ticked reports to this manager, who can then give them tasks. Anyone the rules stop is skipped.")}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-3">
        {all.isLoading ? <Skeleton className="h-10" /> : (
          <SearchSelect value={manager} onValueChange={setManager} label={t("Reports to")} searchPlaceholder={t("Search people")}
            options={[{ value: NO_ONE, label: t("No one") }, ...managerOptions(all.data ?? []).filter((o) => !userIds.includes(o.value))]} />
        )}
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** Is the department list of this branch empty or does the person need a new one? */
export function departmentOptions(departments: Department[], canAdd: boolean, withAny: { value: string; label: string } | null) {
  return [
    ...(withAny ? [withAny] : []),
    ...departments.map((d) => ({ value: d.id, label: d.name })),
    ...(canAdd ? [{ value: NEW_DEPT, label: tr("+ New department") }] : []),
  ];
}

/** Keeps the branch list fresh for the Placement after a department is made. */
export const useBranches = () => useQuery(branchesQuery);
