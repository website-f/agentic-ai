/**
 * P131 (Fitri, 25 Nov 2026): an owner or a global admin signs in as any other role on a practice
 * account (made the first time, kept after), to see what that role sees and to try changes on it;
 * a bar on every screen brings them back to their own account. API: routers/role_preview.py.
 */
import { ArrowUUpLeftIcon, MaskHappyIcon, SignInIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api } from "@/lib/api";

interface PreviewState {
  can_start: boolean;
  previewing: boolean;
  as_role: string | null;
  as_label: string | null;
  roles: { role: string; label: string; needs_branch: boolean; needs_department: boolean }[];
  branches: { id: string; name: string; departments: { id: string; name: string }[] }[];
}

const previewQuery = {
  queryKey: ["role-preview"],
  queryFn: () => api<PreviewState>("/api/role-preview"),
  staleTime: 60_000,
};

/** A fresh page load: every screen, menu and the Prima frame start again as the new person. */
function reloadHome() {
  window.location.assign("/");
}

export function RolePreviewCard() {
  const t = useT();
  const { data } = useQuery(previewQuery);
  const [role, setRole] = useState("staff");
  const [branchId, setBranchId] = useState("");
  const [deptId, setDeptId] = useState("");
  const chosen = (data?.roles ?? []).find((r) => r.role === role);
  const branch = useMemo(
    () => (data?.branches ?? []).find((b) => b.id === branchId) ?? data?.branches?.[0],
    [data, branchId],
  );
  const start = useMutation({
    mutationFn: () =>
      api<PreviewState>("/api/role-preview/start", "POST", {
        role,
        branch_id: chosen?.needs_branch ? branch?.id ?? null : null,
        department_id: chosen?.needs_department ? deptId || null : null,
      }),
    onSuccess: () => reloadHome(),
    onError: (e: Error) => toast.error(e.message),
  });
  if (data?.can_start !== true || !Array.isArray(data.roles) || !Array.isArray(data.branches)) return null;
  return (
    <Card>
      <CardHeader
        icon={<MaskHappyIcon size={20} className="mt-0.5 text-accent" aria-hidden />}
        title={t("Sign in as a role")}
        description={t(
          "See exactly what another role sees. A practice account for that role is made the first time and kept, so you can change its permissions and try things on it. A bar at the bottom brings you back.",
        )}
      />
      <CardBody className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid min-w-0 gap-1.5 text-[12.5px] font-medium text-muted">
          {t("Role")}
          <Select
            value={role}
            onValueChange={setRole}
            label={t("Role")}
            options={data.roles.map((r) => ({ value: r.role, label: t(r.label) }))}
          />
        </label>
        {chosen?.needs_branch && data.branches.length > 0 ? (
          <label className="grid min-w-0 gap-1.5 text-[12.5px] font-medium text-muted">
            {t("Company")}
            <Select
              value={branch?.id ?? ""}
              onValueChange={(v) => {
                setBranchId(v);
                setDeptId("");
              }}
              label={t("Company")}
              options={data.branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}
        {chosen?.needs_department && branch && branch.departments.length > 0 ? (
          <label className="grid min-w-0 gap-1.5 text-[12.5px] font-medium text-muted">
            {t("Department")}
            <Select
              value={deptId || branch.departments[0]?.id || ""}
              onValueChange={setDeptId}
              label={t("Department")}
              options={branch.departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </label>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          <SignInIcon size={16} weight="bold" /> {start.isPending ? t("Signing in…") : t("Sign in as this role")}
        </Button>
      </CardBody>
    </Card>
  );
}

/** While trying a role: a small bar on every screen (over Prima too) with the way back. */
export function RolePreviewBar() {
  const t = useT();
  const { data } = useQuery(previewQuery);
  const stop = useMutation({
    mutationFn: () => api<{ signed_out: boolean }>("/api/role-preview/stop", "POST", {}),
    onSuccess: (r) => (r.signed_out ? window.location.assign("/login") : reloadHome()),
    onError: (e: Error) => toast.error(e.message),
  });
  if (data?.previewing !== true) return null;
  return (
    <div
      role="status"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[90] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full border border-accent/30 bg-surface py-1.5 pl-4 pr-1.5 text-[13px] shadow-[0_10px_30px_-12px_hsl(var(--shadow)/0.45)] md:bottom-5"
    >
      <MaskHappyIcon size={18} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 truncate">
        {t("Trying the role:")} <strong>{t(data.as_label ?? data.as_role ?? "")}</strong>
      </span>
      <Button size="sm" onClick={() => stop.mutate()} disabled={stop.isPending}>
        <ArrowUUpLeftIcon size={15} weight="bold" /> {t("Back to my account")}
      </Button>
    </div>
  );
}
