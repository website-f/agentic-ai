/** "Browse for me": give a browser agent a link and say what you want, read or fill in. */
import { BrowserIcon, CursorClickIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
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
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"read" | "interact">("read");
  const [values, setValues] = useState("");
  const [login, setLogin] = useState(NONE);
  const [output, setOutput] = useState<"answer" | "report">("answer");
  const logins = useQuery({
    queryKey: ["agent-logins", agent.id],
    queryFn: () => api<{ name: string; hosts: string[] }[]>(`/api/agents/${agent.id}/logins`),
    enabled: open,
  });
  const hasBrowser = BROWSER_TOOLS.every((t) => (agent.tools ?? {})[t] && agent.tools[t] !== "deny");
  const start = useMutation({
    mutationFn: () => api<Task>(`/api/agents/${agent.id}/web-task`, "POST", {
      url, instructions, mode, values: mode === "interact" ? values : "", output,
      login: login === NONE ? null : login,
    }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: ["office"] });
      toast.success(`${agent.name} is on it. Watch the browser here.`);
      onStarted?.(t);
      onOpenChange(false);
    },
  });
  const fields = start.error instanceof ApiError ? start.error.fields : {};
  const ready = url.trim().length > 3 && instructions.trim().length > 2;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Browse for me: ${agent.name}`}
      description="Give a link and say what you want. You can watch the browser live while it works."
      className="w-[min(94vw,36rem)]"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!ready} loading={start.isPending} onClick={() => start.mutate()}><BrowserIcon size={15} /> Start</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) start.mutate(); }}>
        <Field label="Link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or portal.example.com/page" autoFocus error={fields.url} />
        <RadioGroup.Root value={mode} onValueChange={(v) => setMode(v as "read" | "interact")} aria-label="What it may do" className="grid gap-2 sm:grid-cols-2">
          <Choice value="read" icon={MagnifyingGlassIcon} title="Find information" body="Reads the page (and the pages it links to). Fills in nothing." />
          <Choice value="interact" icon={CursorClickIcon} title="Interact and fill in" body="Clicks, types and fills forms. Sending a form waits for your approval." />
        </RadioGroup.Root>
        <TextareaField label={mode === "read" ? "What do you want to know?" : "What should it do?"} value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3}
          placeholder={mode === "read"
            ? "e.g. List every invitation to quote: reference, agency, item, value and closing date."
            : "e.g. Update our company profile and save it."} error={fields.instructions} />
        {mode === "interact" ? (
          <TextareaField label="Values to fill in" value={values} onChange={(e) => setValues(e.target.value)} rows={4}
            placeholder={"One per line, e.g.\nCompany name: Qbot Studio Sdn Bhd\nTelephone: +60 3-2710 4455"}
            hint="It uses exactly these and asks you for anything missing. Leave empty if its SOPs or a colleague know them." />
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Sign in with</span>
            <Select value={login} onValueChange={setLogin} label="Saved login"
              options={[{ value: NONE, label: "No login needed" }, ...(logins.data ?? []).map((l) => ({ value: l.name, label: l.name, hint: l.hosts.join(", ") }))]} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Answer as</span>
            <Select value={output} onValueChange={(v) => setOutput(v as "answer" | "report")} label="Answer as"
              options={[{ value: "answer", label: "A short answer" }, { value: "report", label: "A report with a table" }]} />
          </div>
        </div>
        {!hasBrowser ? (
          <p className={cn("rounded-sm px-3 py-2 text-[12.5px]", agent.can_manage ? "bg-accent-soft text-accent" : "bg-warn/10 text-warn")}>
            {agent.can_manage
              ? `${agent.name} does not have the browser yet: starting this gives it the browser tools (sending forms still asks you).`
              : `${agent.name} does not have the browser. Ask whoever manages ${agent.name} to give it the browser tools.`}
          </p>
        ) : null}
        <FormError message={start.error && !Object.keys(fields).length ? errorMessage(start.error) : null} />
      </form>
    </ResponsiveDialog>
  );
}
