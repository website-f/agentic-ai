import { CheckCircleIcon, SparkleIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { IconTile, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { workKeys } from "@/lib/work";

/** One agent a starter team brings (GET /api/branches/starter-teams). */
export interface StarterAgent {
  key: string;
  role: string;
  short: string;
  department: string;
  does: string;
  model_group: string;
  tools: Record<string, string>;
  skills: string[];
  example_name: string;
}

export interface StarterIndustry {
  key: string;
  label: string;
  description: string;
  agents: StarterAgent[];
}

export interface StarterResult {
  branch_id: string;
  industry: string;
  created: { key: string; name: string; role: string; department: string; agent_id: string }[];
  skipped: { key: string; name: string; role: string }[];
  departments_created: string[];
}

export const starterTeamsQuery = {
  queryKey: ["starter-teams"] as const,
  queryFn: () => api<StarterIndustry[]>("/api/branches/starter-teams"),
  staleTime: Infinity,
};

const TONES: Record<string, Tone> = {
  finance: "orange",
  sales: "info",
  operations: "ok",
  hr: "pink",
  customer_service: "accent",
  noc: "violet",
  it_helpdesk: "info",
  project_coordinator: "warn",
  quantity_surveyor: "orange",
  purchasing: "ok",
  proposals: "info",
};

/** The industry picker, the "ready-made team" switch and a preview of who joins. */
export function StarterTeamFields({
  industry,
  onIndustry,
  enabled,
  onEnabled,
  showSwitch = true,
}: {
  industry: string;
  onIndustry: (v: string) => void;
  enabled: boolean;
  onEnabled?: (v: boolean) => void;
  showSwitch?: boolean;
}) {
  const t = useT();
  const { data: catalog, isLoading, error } = useQuery(starterTeamsQuery);
  const picked = catalog?.find((i) => i.key === industry);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Industry")}</span>
        <Select
          label={t("Industry")}
          value={industry}
          onValueChange={onIndustry}
          className="w-full"
          options={(catalog ?? [{ key: "general", label: t("General business"), description: "" }]).map((i) => ({
            value: i.key,
            label: i.label,
            hint: i.description,
          }))}
        />
      </div>
      {showSwitch && onEnabled ? (
        <SwitchField
          checked={enabled}
          onCheckedChange={onEnabled}
          label={t("Add a ready-made AI team")}
          hint={t("Office agents placed in the right departments. They ask before acting and you can change or remove any of them.")}
        />
      ) : null}
      {enabled ? (
        isLoading ? (
          <Skeleton className="h-40 rounded-[var(--radius-md)]" />
        ) : error ? (
          <FormError message={t("Could not load the starter teams. {error}", { error: errorMessage(error) })} />
        ) : picked ? (
          <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-md)] border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/40 px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
                <UsersThreeIcon size={14} className="shrink-0 text-muted" /> {t("Who joins")}
              </span>
              <Pill tone="accent">{picked.agents.length === 1 ? t("1 agent") : t("{n} agents", { n: picked.agents.length })}</Pill>
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border sm:max-h-72 sm:overflow-y-auto">
              {picked.agents.map((a) => (
                <li key={a.key} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
                  <IconTile icon={SparkleIcon} tone={TONES[a.key] ?? "accent"} size="sm" />
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-[13px] font-medium break-words">
                      {a.role} <span className="font-normal text-muted">{t("in {department}", { department: a.department })}</span>
                    </span>
                    <span className="text-[12px] text-muted">{a.does}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-3 py-2 text-[12px] text-muted">
              {t("Each gets a friendly name (like {name}), autonomy set to ask first, and no heartbeat.", { name: picked.agents[0]?.example_name ?? "" })}
            </p>
          </div>
        ) : null
      ) : null}
    </div>
  );
}

/** Add (or top up) an existing company's ready-made team. Roles it already has are skipped. */
export function StarterTeamDialog({
  open,
  onOpenChange,
  branchId,
  branchName,
  initialIndustry,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string;
  branchName: string;
  initialIndustry?: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [industry, setIndustry] = useState(initialIndustry || "general");
  const add = useMutation({
    mutationFn: () => api<StarterResult>(`/api/branches/${branchId}/starter-team`, "POST", { industry }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.branches });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(teamToast(r, branchName));
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Add a ready-made AI team")}
      description={t("For {name}. Roles the company already has are skipped, so this is safe to run again.", { name: branchName })}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button loading={add.isPending} onClick={() => add.mutate()}>
            <CheckCircleIcon size={16} weight="bold" /> {t("Add team")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <StarterTeamFields industry={industry} onIndustry={setIndustry} enabled showSwitch={false} />
        <FormError message={add.error ? errorMessage(add.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

export function teamToast(r: StarterResult, branchName: string): string {
  if (!r.created.length) return tr("{name} already has every role in this team.", { name: branchName });
  const vars = { n: r.created.length, name: branchName, skipped: r.skipped.length };
  if (r.created.length === 1) return r.skipped.length ? tr("1 agent joined {name} ({skipped} already there).", vars) : tr("1 agent joined {name}.", vars);
  return r.skipped.length ? tr("{n} agents joined {name} ({skipped} already there).", vars) : tr("{n} agents joined {name}.", vars);
}
