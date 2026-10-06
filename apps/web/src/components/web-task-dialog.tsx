/** "Browse for me": give a browser agent a link and say what you want, read or fill in. */
import { BrowserIcon, CursorClickIcon, FileTextIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { workKeys, type Agent, type Task } from "@/lib/work";

const NONE = "none";
const BROWSER_TOOLS = ["browser_open", "browser_read"];

function Choice({ value, title, body, icon: Icon }: { value: string; title: string; body: string; icon: typeof BrowserIcon }) {
  return (
    <RadioGroup.Item value={value}
      className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
      <Icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted">{body}</span>
      </span>
    </RadioGroup.Item>
  );
}

export function WebTaskDialog({ agent, open, onOpenChange, onStarted }: {
  agent: Pick<Agent, "id" | "name" | "tools" | "can_manage">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStarted?: (t: Task) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"read" | "interact" | "tender">("read");
  const [values, setValues] = useState("");
  const [login, setLogin] = useState(NONE);
  const [output, setOutput] = useState<"answer" | "report">("answer");
  const logins = useQuery({
    queryKey: ["agent-logins", agent.id],
    queryFn: () => api<{ name: string; hosts: string[] }[]>(`/api/agents/${agent.id}/logins`),
    enabled: open,
  });
  const hasBrowser = BROWSER_TOOLS.every((k) => (agent.tools ?? {})[k] && agent.tools[k] !== "deny");
  const start = useMutation({
    mutationFn: () => api<Task>(`/api/agents/${agent.id}/web-task`, "POST", {
      url, instructions, mode, values: mode === "read" ? "" : values,
      output: mode === "tender" ? "report" : output,
      login: login === NONE ? null : login,
    }),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: ["office"] });
      toast.success(t("{name} is on it. Watch the browser here.", { name: agent.name }));
      onStarted?.(task);
      onOpenChange(false);
    },
  });
  const fields = start.error instanceof ApiError ? start.error.fields : {};
  const ready = url.trim().length > 3 && instructions.trim().length > 2;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Browse for me: {name}", { name: agent.name })}
      description={t("Give a link and say what you want. You can watch the browser live while it works.")}
      className="w-[min(94vw,36rem)]"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        <Button disabled={!ready} loading={start.isPending} onClick={() => start.mutate()}><BrowserIcon size={15} /> {t("Start")}</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) start.mutate(); }}>
        <Field label={t("Link")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("https://… or portal.example.com/page")} autoFocus error={fields.url} />
        <RadioGroup.Root value={mode} onValueChange={(v) => setMode(v as "read" | "interact" | "tender")} aria-label={t("What it may do")} className="grid gap-2 sm:grid-cols-3">
          <Choice value="read" icon={MagnifyingGlassIcon} title={t("Find information")} body={t("Reads the page (and the pages it links to). Fills in nothing.")} />
          <Choice value="interact" icon={CursorClickIcon} title={t("Interact and fill in")} body={t("Clicks, types and fills forms. Sending a form waits for your approval.")} />
          <Choice value="tender" icon={FileTextIcon} title={t("Prepare a tender")} body={t("Researches, drafts the technical proposal and fills only verified values. Submission waits for approval.")} />
        </RadioGroup.Root>
        <TextareaField label={mode === "read" ? t("What do you want to know?") : t("What should it do?")} value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3}
          placeholder={mode === "read"
            ? t("e.g. List every invitation to quote: reference, agency, item, value and closing date.")
            : t("e.g. Update our company profile and save it.")} error={fields.instructions} />
        {mode !== "read" ? (
          <TextareaField label={mode === "tender" ? t("Known tender facts") : t("Values to fill in")} value={values} onChange={(e) => setValues(e.target.value)} rows={4}
            placeholder={t("One per line, e.g.\nCompany name: Qbot Studio Sdn Bhd\nTelephone: +60 3-2710 4455")}
            hint={t("It uses exactly these and asks you for anything missing. Leave empty if its SOPs or a colleague know them.")} />
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className={cn("grid gap-1.5", mode === "tender" && "opacity-60")}>
            <span className="text-[13px] font-medium">{t("Sign in with")}</span>
            <Select value={login} onValueChange={setLogin} label={t("Saved login")}
              options={[{ value: NONE, label: t("No login needed") }, ...(logins.data ?? []).map((l) => ({ value: l.name, label: l.name, hint: l.hosts.join(", ") }))]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Answer as")}</span>
            <Select value={mode === "tender" ? "report" : output} onValueChange={(v) => setOutput(v as "answer" | "report")} label={t("Answer as")}
              options={[{ value: "answer", label: t("A short answer") }, { value: "report", label: t("A report with a table") }]} />
          </div>
        </div>
        {!hasBrowser ? (
          <p className={cn("rounded-sm px-3 py-2 text-[12.5px]", agent.can_manage ? "bg-accent-soft text-accent" : "bg-warn/10 text-warn")}>
            {agent.can_manage
              ? t("{name} does not have the browser yet: starting this gives it the browser tools (sending forms still asks you).", { name: agent.name })
              : t("{name} does not have the browser. Ask whoever manages {name} to give it the browser tools.", { name: agent.name })}
          </p>
        ) : null}
        <FormError message={start.error && !Object.keys(fields).length ? errorMessage(start.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}
