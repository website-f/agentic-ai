/** P92 / P98 Settings > Roles and access (owner only): what each role may do, permission by
 * permission, grouped by area, with the pages each one opens. The owner turns a permission on
 * or off per role, resets one role or all of them, searches, and reviews the changes against
 * the defaults before saving. The change applies from each person's next click, on the server
 * and in their menu, and is written to the audit log. The owner role is shown locked: it always
 * has everything. On a phone: pick a role, then a list of switches.
 * (api/routers/role_access.py, lib/role-access.ts) */
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  LockSimpleIcon,
  MinusIcon,
  PlusIcon,
  UserGearIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { SearchSelect } from "@/components/ui/search-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import {
  AREAS,
  areaOf,
  changesOf,
  diffOf,
  effectiveOf,
  getRoleAccess,
  opensOf,
  resetRole,
  roleAccessKey,
  sameChanges,
  saveRoleAccess,
  SECTIONS,
  stateOf,
  toggle,
  type Area,
  type Changes,
  type RoleAccess,
  type RoleAccessRole,
} from "@/lib/role-access";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

function Toggle({ on, changed, label, onChange, locked }: {
  on: boolean;
  changed: boolean;
  label: string;
  onChange?: (on: boolean) => void;
  locked?: boolean;
}) {
  return (
    <span className="relative inline-flex">
      <Switch.Root
        checked={on}
        onCheckedChange={onChange}
        disabled={locked}
        aria-label={label}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent",
          locked && "cursor-not-allowed opacity-60",
        )}
      >
        <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
      {changed ? <span aria-hidden className="absolute -top-1 -right-1 size-2.5 rounded-full bg-warn ring-2 ring-surface" /> : null}
    </span>
  );
}

/** The row's name, what it does and what it opens. */
function RowLabel({ area }: { area: Area }) {
  const t = useT();
  const opens = opensOf(area);
  return (
    <>
      <span className="block text-[13px] font-medium">{t(area.label)}</span>
      <span className="block max-w-[22rem] text-[12px] text-muted">{t(area.hint)}</span>
      {opens.length ? (
        <span className="mt-0.5 block max-w-[22rem] text-[11.5px] text-muted/90">
          {t("Opens: {pages}", { pages: opens.map((p) => t(p)).join(", ") })}
        </span>
      ) : null}
    </>
  );
}

/** Words of one permission, for the review list. */
function permName(t: ReturnType<typeof useT>, perm: string) {
  const a = areaOf(perm);
  return a ? t(a.label) : perm;
}

export function RolesAccessPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: roleAccessKey, queryFn: getRoleAccess });
  const [draft, setDraft] = useState<Changes | null>(null);
  const [phoneRole, setPhoneRole] = useState<Role>("management");
  const [resetting, setResetting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [find, setFind] = useState("");
  const save = useMutation({
    mutationFn: (c: Changes) => saveRoleAccess(c),
    onSuccess: (data: RoleAccess) => {
      qc.setQueryData(roleAccessKey, data);
      void qc.invalidateQueries({ queryKey: keys.me });
      setDraft(null);
      setReviewing(false);
      toast.success(t("Saved. Each person gets the new access on their next click."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading)
    return (
      <Page>
        <PageHeader title={t("Roles and access")} icon={UserGearIcon} />
        <Skeleton className="h-96" />
      </Page>
    );
  if (q.error || !q.data) {
    return (
      <Page>
        <PageHeader title={t("Roles and access")} icon={UserGearIcon} />
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load roles and access.")} {errorMessage(q.error)}
        </div>
        <div>
          <Button variant="outline" onClick={() => void q.refetch()}>{t("Try again")}</Button>
        </div>
      </Page>
    );
  }
  const data = q.data;
  const saved = changesOf(data);
  const changes = draft ?? saved;
  const dirty = !sameChanges(changes, saved);
  const owner = data.roles.find((r) => r.role === "owner");
  const roles = data.roles.filter((r) => r.editable);
  const hasChanges = Object.keys(changes).length > 0;
  const needle = find.trim().toLowerCase();
  const rows = needle
    ? AREAS.filter((a) => [t(a.label), t(a.hint), a.label, a.hint, ...a.perms, ...opensOf(a).flatMap((p) => [p, t(p)]), t(a.section)].join(" ").toLowerCase().includes(needle))
    : AREAS;
  const sections = SECTIONS.map((s) => ({ name: s, rows: rows.filter((a) => a.section === s) })).filter((s) => s.rows.length);

  const cell = (r: RoleAccessRole, area: Area) => {
    const now = stateOf(effectiveOf(r.default, changes[r.role]), area);
    const was = stateOf(r.default, area);
    return { now, changed: now !== was };
  };
  const flip = (r: RoleAccessRole, area: Area, on: boolean) => setDraft(toggle(changes, r.role, r.default, area, on));
  const roleName = (r: Role) => (ROLE_INFO[r] ? t(ROLE_INFO[r].label) : r);
  const changedCount = (r: RoleAccessRole) => AREAS.filter((a) => cell(r, a).changed).length;
  const picked = roles.find((r) => r.role === phoneRole) ?? roles[0];
  const diff = diffOf(data.roles, changes, saved);
  const resetOne = (r: RoleAccessRole) => setDraft(resetRole(changes, r.role));

  return (
    <Page wide>
      <PageHeader
        title={t("Roles and access")}
        icon={UserGearIcon}
        description={t("Set what each role can open and change. Turn a permission on or off for a role; it applies to everyone in that role from their next click. Owners always have everything.")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!hasChanges || save.isPending} onClick={() => setResetting(true)}>
              <ArrowCounterClockwiseIcon size={15} /> {t("Reset to defaults")}
            </Button>
            <Button disabled={!dirty} loading={save.isPending} onClick={() => setReviewing(true)}>
              {t("Save changes")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <SearchInput value={find} onChange={setFind} placeholder={t("Search permissions or pages")} className="sm:max-w-sm" />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-warn" /> {t("Changed from the default")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LockSimpleIcon size={13} /> {t("Never given to anyone: making owners, this page, erasing the workspace.")}
          </span>
          {dirty ? <Pill tone="warn">{t("Not saved yet")}</Pill> : null}
        </p>
      </div>

      {sections.length === 0 ? (
        <EmptyState icon={UserGearIcon} title={t("Nothing matches")} body={t("Try another word, such as money, members or AI engine.")}
          action={<Button variant="outline" onClick={() => setFind("")}>{t("Clear the search")}</Button>} />
      ) : null}

      {/* Phone: pick a role, then its switches. */}
      {picked && sections.length ? (
        <div className="grid gap-3 sm:hidden" data-testid="roles-phone">
          <SearchSelect value={picked.role} onValueChange={(v) => setPhoneRole(v as Role)} label={t("Role")}
            options={roles.map((r) => ({
              value: r.role,
              label: changedCount(r) ? t("{role} ({n} changed)", { role: roleName(r.role), n: changedCount(r) }) : roleName(r.role),
              hint: ROLE_INFO[r.role] ? t(ROLE_INFO[r.role].blurb) : undefined,
            }))} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-[12.5px] text-muted">{ROLE_INFO[picked.role] ? t(ROLE_INFO[picked.role].blurb) : null}</p>
            {changedCount(picked) ? (
              <Button size="sm" variant="outline" onClick={() => resetOne(picked)}>
                <ArrowCounterClockwiseIcon size={14} /> {t("Reset {role}", { role: roleName(picked.role) })}
              </Button>
            ) : null}
          </div>
          {sections.map((s) => (
            <section key={s.name} className="grid gap-1.5">
              <h2 className="px-1 text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">{t(s.name)}</h2>
              <Card className="divide-y divide-border">
                {s.rows.map((area) => {
                  const c = cell(picked, area);
                  return (
                    <div key={area.key} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0"><RowLabel area={area} /></div>
                      <Toggle on={c.now === "on"} changed={c.changed}
                        label={t("{area} for {role}", { area: t(area.label), role: roleName(picked.role) })}
                        onChange={(on) => flip(picked, area, on)} />
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      ) : null}

      {/* Wider screens: the whole matrix, roles as columns, the owner locked first. */}
      {sections.length ? (
        <Card className="hidden overflow-x-auto sm:block" data-testid="roles-matrix">
          <table className="w-full min-w-[60rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-2/40">
                <th scope="col" className="sticky left-0 z-10 min-w-[16rem] bg-surface px-4 py-3 text-[12.5px] font-medium text-muted">
                  {t("Permission")}
                </th>
                {owner ? (
                  <th scope="col" className="px-2 py-3 text-center text-[12.5px] font-medium">
                    {roleName("owner")}
                    <span className="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-normal text-muted">
                      <LockSimpleIcon size={11} /> {t("Locked")}
                    </span>
                  </th>
                ) : null}
                {roles.map((r) => (
                  <th key={r.role} scope="col" className="px-2 py-3 text-center align-top text-[12.5px] font-medium">
                    {roleName(r.role)}
                    {changedCount(r) ? (
                      <span className="block text-[11px] font-normal text-warn">{t("{n} changed", { n: changedCount(r) })}</span>
                    ) : null}
                    {changedCount(r) ? (
                      <button type="button" onClick={() => resetOne(r)} aria-label={t("Reset {role}", { role: roleName(r.role) })}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal text-accent hover:underline">
                        <ArrowCounterClockwiseIcon size={11} /> {t("Reset")}
                      </button>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.name}>
                <tr className="border-b border-border bg-surface-2/60">
                  <th scope="colgroup" colSpan={roles.length + (owner ? 2 : 1)}
                    className="sticky left-0 px-4 py-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-muted uppercase">
                    {t(s.name)}
                  </th>
                </tr>
                {s.rows.map((area) => (
                  <tr key={area.key} className="border-b border-border">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2.5 align-top font-normal"><RowLabel area={area} /></th>
                    {owner ? (
                      <td className="px-2 py-2.5 text-center">
                        <Toggle on locked changed={false} label={t("{area} for {role}", { area: t(area.label), role: roleName("owner") })} />
                      </td>
                    ) : null}
                    {roles.map((r) => {
                      const c = cell(r, area);
                      return (
                        <td key={r.role} className={cn("px-2 py-2.5 text-center", c.changed && "bg-warn/8")}>
                          <Toggle on={c.now === "on"} changed={c.changed}
                            label={t("{area} for {role}", { area: t(area.label), role: roleName(r.role) })}
                            onChange={(on) => flip(r, area, on)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </Card>
      ) : null}

      <Card className="grid gap-1 p-4 text-[12.5px] text-muted sm:p-5">
        <p className="font-medium text-fg">{t("Who can change this page")}</p>
        <p>{t("Only owners. Every save is written to the audit log (Activity) with what changed.")}</p>
        <p>{t("A person who can manage members can only give roles with no more access than their own.")}</p>
        <p>{t("Customers (CRM) are shared part by part from the CRM page. Prima uses each person's own Prima access, and the owner links people on the Prima page.")}</p>
      </Card>

      <ResponsiveDialog open={reviewing} onOpenChange={setReviewing} title={t("Check the changes")}
        description={t("What each role gets after saving, compared with its default access.")}
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(false)}>{t("Back")}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(changes)}>{t("Save changes")}</Button>
          </>
        }>
        <ul className="grid gap-3" data-testid="roles-review">
          {diff.map((d) => (
            <li key={d.role} className="grid gap-1.5 rounded-[var(--radius-md)] border border-border p-3">
              <p className="text-[13.5px] font-semibold">{roleName(d.role)}</p>
              {d.turnsOn.length ? (
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                  <span className="inline-flex items-center gap-1 font-medium text-ok"><PlusIcon size={12} weight="bold" /> {t("Gets")}</span>
                  {d.turnsOn.map((p) => <Pill key={p} tone="ok">{permName(t, p)}</Pill>)}
                </p>
              ) : null}
              {d.turnsOff.length ? (
                <p className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                  <span className="inline-flex items-center gap-1 font-medium text-danger"><MinusIcon size={12} weight="bold" /> {t("Loses")}</span>
                  {d.turnsOff.map((p) => <Pill key={p} tone="danger">{permName(t, p)}</Pill>)}
                </p>
              ) : null}
              <p className="text-[12px] text-muted">
                {d.added.length || d.removed.length
                  ? t("Against the default: {more} more, {less} less.", { more: d.added.length, less: d.removed.length })
                  : <span className="inline-flex items-center gap-1"><CheckIcon size={12} /> {t("Back to the default.")}</span>}
              </p>
            </li>
          ))}
        </ul>
      </ResponsiveDialog>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={t("Reset every role to its defaults?")}
        body={t("Every change on this page is undone. Each person gets the default access of their role on their next click.")}
        confirmLabel={t("Reset to defaults")}
        onConfirm={async () => {
          await save.mutateAsync({});
        }}
      />
    </Page>
  );
}
