/** P92 Settings > Roles and access (owner only): what each role may do, area by area. The owner
 * turns areas on or off per role; the change applies from each person's next click, on the
 * server and in their menu. On a phone: pick a role, then a list of switches.
 * (api/routers/role_access.py, lib/role-access.ts) */
import {
  ArrowCounterClockwiseIcon,
  LockSimpleIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import {
  AREAS,
  changesOf,
  effectiveOf,
  getRoleAccess,
  roleAccessKey,
  sameChanges,
  saveRoleAccess,
  stateOf,
  toggle,
  type Area,
  type Changes,
  type RoleAccess,
  type RoleAccessRole,
} from "@/lib/role-access";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

function Toggle({
  on,
  some,
  changed,
  label,
  onChange,
}: {
  on: boolean;
  some: boolean;
  changed: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <span className="relative inline-flex">
      <Switch.Root
        checked={on}
        onCheckedChange={onChange}
        aria-label={label}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent",
          some && "bg-accent/40",
        )}
      >
        <Switch.Thumb
          className={cn(
            "block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]",
            some && "translate-x-[9px]",
          )}
        />
      </Switch.Root>
      {changed ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-2.5 rounded-full bg-warn ring-2 ring-surface"
        />
      ) : null}
    </span>
  );
}

export function RolesAccessPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: roleAccessKey, queryFn: getRoleAccess });
  const [draft, setDraft] = useState<Changes | null>(null);
  const [phoneRole, setPhoneRole] = useState<Role>("management");
  const [resetting, setResetting] = useState(false);
  const save = useMutation({
    mutationFn: (c: Changes) => saveRoleAccess(c),
    onSuccess: (data: RoleAccess) => {
      qc.setQueryData(roleAccessKey, data);
      void qc.invalidateQueries({ queryKey: keys.me });
      setDraft(null);
      toast.success(
        t("Saved. Each person gets the new access on their next click."),
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading)
    return (
      <Page>
        <Skeleton className="h-96" />
      </Page>
    );
  if (q.error || !q.data) {
    return (
      <Page>
        <PageHeader title={t("Roles and access")} icon={UsersIcon} />
        <p role="alert" className="text-[13.5px] text-danger">
          {errorMessage(q.error)}
        </p>
      </Page>
    );
  }
  const data = q.data;
  const saved = changesOf(data);
  const changes = draft ?? saved;
  const dirty = !sameChanges(changes, saved);
  const roles = data.roles.filter((r) => r.editable);
  const hasChanges = Object.keys(changes).length > 0;

  const cell = (r: RoleAccessRole, area: Area) => {
    const now = stateOf(effectiveOf(r.default, changes[r.role]), area);
    const was = stateOf(r.default, area);
    return { now, changed: now !== was };
  };
  const flip = (r: RoleAccessRole, area: Area, on: boolean) =>
    setDraft(toggle(changes, r.role, r.default, area, on));
  const roleName = (r: Role) => (ROLE_INFO[r] ? t(ROLE_INFO[r].label) : r);
  const changedCount = (r: RoleAccessRole) =>
    AREAS.filter((a) => cell(r, a).changed).length;
  const picked = roles.find((r) => r.role === phoneRole) ?? roles[0];

  return (
    <Page wide>
      <PageHeader
        title={t("Roles and access")}
        icon={UsersIcon}
        description={t(
          "What each role may do, area by area. Turn an area on or off for a role; it applies to everyone in that role from their next click. Owners always have everything.",
        )}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!hasChanges || save.isPending}
              onClick={() => setResetting(true)}
            >
              <ArrowCounterClockwiseIcon size={15} /> {t("Reset to defaults")}
            </Button>
            <Button
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate(changes)}
            >
              {t("Save changes")}
            </Button>
          </div>
        }
      />

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-warn" />{" "}
          {t("Changed from the default")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LockSimpleIcon size={13} />{" "}
          {t(
            "Never given to anyone: making owners, this page, erasing the workspace.",
          )}
        </span>
        {dirty ? <Pill tone="warn">{t("Not saved yet")}</Pill> : null}
      </p>

      {/* Phone: pick a role, then its switches. */}
      {picked ? (
        <div className="grid gap-3 sm:hidden" data-testid="roles-phone">
          <Select
            value={picked.role}
            onValueChange={(v) => setPhoneRole(v as Role)}
            label={t("Role")}
            options={roles.map((r) => ({
              value: r.role,
              label: changedCount(r)
                ? t("{role} ({n} changed)", {
                    role: roleName(r.role),
                    n: changedCount(r),
                  })
                : roleName(r.role),
            }))}
          />
          <p className="text-[12.5px] text-muted">
            {ROLE_INFO[picked.role] ? t(ROLE_INFO[picked.role].blurb) : null}
          </p>
          <Card className="divide-y divide-border">
            {AREAS.map((area) => {
              const c = cell(picked, area);
              return (
                <div
                  key={area.key}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">
                      {t(area.label)}
                      {c.now === "some" ? (
                        <span className="ml-1.5 text-[12px] font-normal text-muted">
                          {t("(partly)")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[12.5px] text-muted">{t(area.hint)}</p>
                  </div>
                  <Toggle
                    on={c.now === "on"}
                    some={c.now === "some"}
                    changed={c.changed}
                    label={t("{area} for {role}", {
                      area: t(area.label),
                      role: roleName(picked.role),
                    })}
                    onChange={(on) => flip(picked, area, on)}
                  />
                </div>
              );
            })}
          </Card>
        </div>
      ) : null}

      {/* Wider screens: the whole matrix, roles as columns. */}
      <Card
        className="hidden overflow-x-auto sm:block"
        data-testid="roles-matrix"
      >
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-surface-2/40">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[15rem] bg-surface px-4 py-3 text-[12.5px] font-medium text-muted"
              >
                {t("Area")}
              </th>
              {roles.map((r) => (
                <th
                  key={r.role}
                  scope="col"
                  className="px-2 py-3 text-center text-[12.5px] font-medium"
                >
                  {roleName(r.role)}
                  {changedCount(r) ? (
                    <span className="block text-[11px] font-normal text-warn">
                      {t("{n} changed", { n: changedCount(r) })}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AREAS.map((area) => (
              <tr
                key={area.key}
                className="border-b border-border last:border-b-0"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-surface px-4 py-2.5 align-top font-normal"
                >
                  <span className="block text-[13px] font-medium">
                    {t(area.label)}
                  </span>
                  <span className="block max-w-[18rem] text-[12px] text-muted">
                    {t(area.hint)}
                  </span>
                </th>
                {roles.map((r) => {
                  const c = cell(r, area);
                  return (
                    <td
                      key={r.role}
                      className={cn(
                        "px-2 py-2.5 text-center",
                        c.changed && "bg-warn/8",
                      )}
                    >
                      <Toggle
                        on={c.now === "on"}
                        some={c.now === "some"}
                        changed={c.changed}
                        label={t("{area} for {role}", {
                          area: t(area.label),
                          role: roleName(r.role),
                        })}
                        onChange={(on) => flip(r, area, on)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 text-[12.5px] text-muted sm:p-5">
        <p>
          {t(
            "Customers (CRM) are shared part by part from the CRM page. Prima uses each person's own Prima access, and the owner links people on the Prima page.",
          )}
        </p>
        <p className="mt-1">
          {t(
            "A person who can manage members can only give roles with no more access than their own.",
          )}
        </p>
      </Card>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={t("Reset every role to its defaults?")}
        body={t(
          "Every change on this page is undone. Each person gets the default access of their role on their next click.",
        )}
        confirmLabel={t("Reset to defaults")}
        onConfirm={async () => {
          await save.mutateAsync({});
        }}
      />
    </Page>
  );
}
