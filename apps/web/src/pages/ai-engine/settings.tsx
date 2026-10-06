import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

import { aiKeys, aiSettingsQuery } from "./data";

export function SettingsTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const settings = useQuery(aiSettingsQuery);
  // What the person typed; until they type, the saved value shows.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (settings.data ? String(settings.data.max_task_model_calls) : "");

  const save = useMutation({
    mutationFn: (maxTaskModelCalls: number) =>
      api("/api/ai/settings", "PATCH", { max_task_model_calls: maxTaskModelCalls }),
    onSuccess: (data) => {
      queryClient.setQueryData(aiKeys.settings, data);
      setDraft(null);
      toast.success(t("AI Engine settings saved."));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (settings.isPending) return <Skeleton className="h-56 rounded-[var(--radius-md)]" />;
  if (settings.isError) return <FormError message={errorMessage(settings.error)} />;

  const hardMax = settings.data.hard_max_task_model_calls;
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= hardMax;

  return (
    <div className="grid max-w-2xl gap-8">
      <Section
        title={t("Task safety limit")}
        description={t("Controls how many model calls one task may make before it is stopped as unfinished.")}
      >
        <div className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-end">
            <Field
              label={t("Maximum model calls per task")}
              type="number"
              min={1}
              max={hardMax}
              step={1}
              value={value}
              disabled={!canManage}
              onChange={(event) => setDraft(event.target.value)}
              hint={t("Default: 30. Allowed range: 1–{max}.", { max: hardMax })}
            />
            <div className="text-[13px] leading-relaxed text-muted">
              {t("This is a workspace-wide limit for agent tasks. A higher value gives long-running research tasks more room, but can increase runtime and model cost.")}
            </div>
          </div>
          {canManage ? (
            <div className="mt-5 flex justify-end border-t border-border pt-4">
              <Button
                onClick={() => save.mutate(parsed)}
                disabled={!valid || save.isPending || parsed === settings.data.max_task_model_calls}
                loading={save.isPending}
              >
                {t("Save limit")}
              </Button>
            </div>
          ) : (
            <p className="mt-4 border-t border-border pt-4 text-[12.5px] text-muted">
              {t("You need AI Engine management permission to change this limit.")}
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
