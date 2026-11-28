import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

import { aiKeys, aiSettingsQuery, type AISettings, type CopilotFirst } from "./data";

/** P147: "Microsoft 365 Copilot first": a person's own plain questions (summaries, drafts,
 * translations, explanations) go to Microsoft 365 Copilot as them, free with their Copilot
 * licence; our AI engine answers everything that needs tools, long context or fails over. Owners
 * and admins switch it; everyone with AI Engine access sees it. */
function CopilotFirstSection({ data }: { data: AISettings }) {
  const t = useT();
  const queryClient = useQueryClient();
  const saved = data.copilot_first;
  const [draft, setDraft] = useState<CopilotFirst | null>(null);
  const [chars, setChars] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (copilot_first: CopilotFirst) => api<AISettings>("/api/ai/settings", "PATCH", { copilot_first }),
    onSuccess: (next) => {
      queryClient.setQueryData(aiKeys.settings, next);
      setDraft(null);
      setChars(null);
      toast.success(t("AI Engine settings saved."));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!saved) return null; // an older server
  const value = draft ?? saved;
  const canSet = data.can_set_copilot === true;
  const typed = chars ?? String(value.max_prompt_chars);
  const parsed = Number(typed);
  const charsOk = Number.isInteger(parsed) && parsed >= 1000 && parsed <= 20000;
  const next = { ...value, max_prompt_chars: charsOk ? parsed : value.max_prompt_chars };
  const changed = JSON.stringify(next) !== JSON.stringify(saved);
  return (
    <Section
      title={t("Microsoft 365 Copilot first")}
      description={t("Saves AI tokens: people with a Microsoft 365 Copilot licence get their plain questions answered by Copilot, at no extra cost. The AI engine still does everything else.")}
    >
      <div className="grid gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <SwitchField
          checked={value.on}
          disabled={!canSet}
          onCheckedChange={(on) => setDraft({ ...value, on })}
          label={t("Ask Microsoft 365 Copilot first")}
          hint={t("Only a person's own chat with their own AI, as that person, when they allowed Copilot on the Microsoft 365 page and have the licence. Anything that needs tools (mail, Teams, tasks, files, Prima), long questions and any Copilot error go to the AI engine at once. Company and shared agents, tasks and background work never use Copilot.")}
        />
        <SwitchField
          checked={value.use_retrieval}
          disabled={!canSet || !value.on}
          onCheckedChange={(use_retrieval) => setDraft({ ...value, use_retrieval })}
          label={t("Search SharePoint and OneDrive through Copilot")}
          hint={t("Gives a person's own AI the Microsoft 365 search tool: passages from the files they can already open.")}
        />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,18rem)_1fr] sm:items-end">
          <Field
            label={t("Longest question for Copilot (characters)")}
            type="number"
            min={1000}
            max={20000}
            step={500}
            value={typed}
            disabled={!canSet || !value.on}
            onChange={(event) => setChars(event.target.value)}
            hint={t("Default: 6000. Allowed range: 1000–20000.")}
          />
          <div className="text-[13px] leading-relaxed text-muted">
            {t("Longer questions, with the conversation before them, go to the AI engine. Copilot is in public preview: Microsoft may slow it down, and then the AI engine answers.")}
          </div>
        </div>
        <p className="text-[12.5px] text-muted">
          {t("Before switching on: your Microsoft 365 admin grants admin consent for the Copilot permissions of this app in Azure (App registrations > API permissions). Then each person presses Allow Copilot on the Microsoft 365 page once. Usage per person shows calls answered by Copilot and the tokens saved.")}
        </p>
        {canSet ? (
          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={() => save.mutate(next)} disabled={!charsOk || !changed || save.isPending} loading={save.isPending}>
              {t("Save")}
            </Button>
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-[12.5px] text-muted">{t("Only owners and admins change this.")}</p>
        )}
      </div>
    </Section>
  );
}

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
      <CopilotFirstSection data={settings.data} />
    </div>
  );
}
