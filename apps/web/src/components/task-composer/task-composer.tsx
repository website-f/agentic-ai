/**
 * The task composer: one place to hand work to an agent, from anywhere in the app.
 * What do you need (typed or spoken) → how (a task, web research, a website, a workflow) →
 * who (an agent, busy or free) → when (now, or on repeat as a schedule) → more options.
 * A full screen on phones, a wide panel docked right on bigger screens. Ctrl/Cmd+Enter sends.
 */
import {
  BrowserIcon, CaretRightIcon, ClipboardTextIcon, CursorClickIcon, FileIcon, FileTextIcon, FlowArrowIcon, GlobeIcon,
  HourglassMediumIcon, LightningIcon, MagnifyingGlassIcon, PaperclipIcon, RepeatIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, RadioGroup } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { ObjectivePicker } from "@/components/objective-bits";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { VoiceInput } from "@/components/voice-input";
import { locale, msg, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { teamKeys, type Schedule } from "@/lib/teams";
import { cn } from "@/lib/utils";
import { agentsQuery, canShareTasks, VISIBILITY, workKeys, type Priority, type Task, type Visibility } from "@/lib/work";
import { runKeys, workflowsQuery, type Run } from "@/lib/workflows";
import { TaskPicker, type TaskRef } from "@/pages/tasks/accountable";

import { AgentPicker, NOBODY } from "./agent-picker";
import { BrowseWhere, canBrowseOn, ON_SERVER, useMyDevicesFor } from "./browse-where";
import { cronFor, researchBrief, titleFrom, type RepeatPreset } from "./briefs";
import { lastAgent, rememberAgent, useComposerStore, type ComposerKind, type ComposerPrefill, type ComposerResult } from "./store";

const NONE = "none";
const EPEROLEHAN = "https://www.eperolehan.gov.my/";
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const KINDS: { kind: ComposerKind; icon: typeof GlobeIcon; title: string; body: string }[] = [
  { kind: "general", icon: ClipboardTextIcon, title: msg("General task"), body: msg("Any work: it follows its SOPs and asks before risky steps.") },
  { kind: "research", icon: GlobeIcon, title: msg("Research the web"), body: msg("Searches, reads the best pages and cites every source.") },
  { kind: "browse", icon: BrowserIcon, title: msg("Browse a website"), body: msg("Opens a site to read or fill in. You can watch it live.") },
  { kind: "workflow", icon: FlowArrowIcon, title: msg("Follow a workflow"), body: msg("Runs one of your mapped procedures, step by step.") },
];

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: "weekdays", label: msg("Every weekday") },
  { value: "monday", label: msg("Every Monday") },
  { value: "monthly", label: msg("1st of each month") },
  { value: "daily", label: msg("Every day") },
  { value: "custom", label: msg("Custom") },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Mounted once (app shell, full-screen chat): renders the composer while it is open. */
export function TaskComposerHost() {
  const open = useComposerStore((s) => s.open);
  const seq = useComposerStore((s) => s.seq);
  const prefill = useComposerStore((s) => s.prefill);
  const close = useComposerStore((s) => s.close);
  if (!open) return null;
  return <TaskComposer key={seq} prefill={prefill} onClose={close} />;
}

function Block({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-[13px] font-semibold tracking-[0.02em]">{title}</h3>
        {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ModeChoice({ value, title, body, icon: Icon }: { value: string; title: string; body: string; icon: typeof BrowserIcon }) {
  return (
    <RadioGroup.Item value={value}
      className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50">
      <Icon size={17} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[12px] text-muted">{body}</span>
      </span>
    </RadioGroup.Item>
  );
}

export function TaskComposer({ prefill, onClose }: { prefill: ComposerPrefill; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: agents = [], isLoading: loadingAgents } = useQuery(agentsQuery);
  const { data: workflows = [] } = useQuery(workflowsQuery);
  // Only agents the person may instruct: colleagues' agents they just watch are left out.
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of && !a.view_only);
  const twin = usable.find((a) => a.is_twin && a.owner_user_id === me.user.id) ?? null;
  const canShare = canShareTasks(me.permissions);

  // ---- what
  const [text, setText] = useState(prefill.brief ?? "");
  const [title, setTitle] = useState(prefill.title ?? "");
  const [titleEdited, setTitleEdited] = useState(!!prefill.title);
  const box = useRef<HTMLTextAreaElement>(null);

  // ---- how
  const [kind, setKind] = useState<ComposerKind>(prefill.kind ?? (prefill.url ? "browse" : prefill.workflowId ? "workflow" : "general"));
  const [output, setOutput] = useState<"answer" | "report">("answer");
  const [url, setUrl] = useState(prefill.url ?? "");
  const [mode, setMode] = useState<"read" | "interact" | "tender">("read");
  const [values, setValues] = useState("");
  const [login, setLogin] = useState(NONE);
  const [tenderRef, setTenderRef] = useState("");
  const [flow, setFlow] = useState(prefill.workflowId ?? "");
  const [flowMode, setFlowMode] = useState<"follow" | "run">("follow");

  // ---- who: the agent asked for, else your AI worker, else the last one you used here.
  const [picked, setPicked] = useState<string | null>(null);
  const fallback = (() => {
    if (prefill.agentId && usable.some((a) => a.id === prefill.agentId)) return prefill.agentId;
    if (twin) return twin.id;
    const last = lastAgent();
    if (last && usable.some((a) => a.id === last)) return last;
    return usable[0]?.id ?? NOBODY;
  })();
  const agentId = picked ?? fallback;
  const agent = usable.find((a) => a.id === agentId) ?? null;

  // ---- when
  const [repeat, setRepeat] = useState(!!prefill.repeat);
  const [preset, setPreset] = useState<RepeatPreset>("weekdays");
  const [time, setTime] = useState("09:00");
  const [custom, setCustom] = useState("0 9 * * 1-5");
  const [runNow, setRunNow] = useState(false);

  // ---- more
  const [more, setMore] = useState(!!prefill.files?.length || !!prefill.objectiveId);
  const [priority, setPriority] = useState<Priority>("normal");
  const [review, setReview] = useState(prefill.fromTask?.requiresReview ?? true);
  const [goal, setGoal] = useState("");
  const [labels, setLabels] = useState("");
  const [files, setFiles] = useState(prefill.files ?? []);
  const [picking, setPicking] = useState(!!prefill.pickFile);
  const [objective, setObjective] = useState<string | null>(prefill.objectiveId ?? null);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [after, setAfter] = useState<TaskRef[]>([]);
  const [startNow, setStartNow] = useState(true);

  const firstFlow = workflows.find((w) => w.status === "active") ?? workflows[0];
  const flowId = flow || firstFlow?.id || "";
  const runMode = kind === "workflow" && flowMode === "run";
  const canRepeat = kind === "general" || kind === "research";
  const repeatOn = repeat && canRepeat;
  const shownTitle = (titleEdited ? title : titleFrom(text)).trim();
  const cron = cronFor(preset, time, custom);
  const branchId = agent?.branch_id ?? null;
  const needsAgent = kind === "research" || kind === "browse" || repeatOn;
  const hasAgent = !!agent;

  // P31: browse on the person's own computer (only their own AI, only a computer that is on).
  const [where, setWhere] = useState(ON_SERVER);
  const myDevices = useMyDevicesFor(kind === "browse" ? agent : null, me.user.id);
  const deviceId = myDevices.find((d) => d.id === where && canBrowseOn(d))?.id ?? null;

  const logins = useQuery({
    queryKey: ["agent-logins", agentId],
    queryFn: () => api<{ name: string; hosts: string[] }[]>(`/api/agents/${agentId}/logins`),
    enabled: kind === "browse" && hasAgent,
  });
  const preview = useQuery({
    queryKey: ["cron-preview", cron],
    queryFn: () => api<{ ok: boolean; next: string[]; error?: string }>(`/api/schedules/preview?cron=${encodeURIComponent(cron)}`),
    enabled: repeatOn && cron.split(" ").length === 5,
  });

  // Tender mode: the company's tender SOP is in every agent's instructions already, so a one-line
  // ask is enough; it follows the tender reference until the person edits it.
  const tenderAsk = (ref: string) =>
    t("Prepare tender {ref} on ePerolehan up to, but not including, final submission, following our ePerolehan tender SOP. If any of it was done before, skip what is already done and tell me what you skipped.",
      { ref: ref.trim() || "QT…" });
  const pickMode = (next: "read" | "interact" | "tender") => {
    setMode(next);
    if (next === "tender") {
      if (!url.trim()) setUrl(EPEROLEHAN);
      if (!text.trim()) setText(tenderAsk(tenderRef));
      const ep = (logins.data ?? []).find((l) => l.hosts.some((h) => h.includes("eperolehan")));
      if (ep && login === NONE) setLogin(ep.name);
    }
  };

  const hasBrowser = !!agent && ["browser_open", "browser_read"].every((k) => (agent.tools ?? {})[k] && agent.tools[k] !== "deny");
  const noSearch = !!agent && agent.tools?.web_search === "deny";

  const labelList = labels.split(",").map((l) => l.trim()).filter(Boolean);
  const ready = (() => {
    if (needsAgent && !hasAgent) return false;
    if (repeatOn) return !!shownTitle && preview.data?.ok !== false && cron.split(" ").length === 5;
    if (kind === "research") return text.trim().length >= 3 && !!shownTitle;
    if (kind === "browse") return url.trim().length > 3 && text.trim().length > 2;
    if (kind === "workflow") return !!flowId && !!shownTitle;
    return !!shownTitle;
  })();

  const submit = useMutation({
    mutationFn: async (): Promise<ComposerResult> => {
      const brief = kind === "research" ? researchBrief(text, output) : text;
      if (repeatOn) {
        const ft = prefill.fromTask;
        const same = ft && ft.agentId === agentId && ft.brief === text && ft.title.trim() === shownTitle;
        const s = same
          ? await api<Schedule>(`/api/tasks/${ft.id}/repeat`, "POST", { cron, name: shownTitle, requires_review: review })
          : await api<Schedule>("/api/schedules", "POST", {
            name: shownTitle.slice(0, 160), agent_id: agentId, title: shownTitle.slice(0, 180), brief: brief.slice(0, 8000), cron, requires_review: review,
          });
        if (runNow) await api<Schedule>(`/api/schedules/${s.id}/run`, "POST");
        return { kind: "schedule", id: s.id, name: s.name };
      }
      if (kind === "browse") {
        const task = await api<Task>(`/api/agents/${agentId}/web-task`, "POST", {
          url, instructions: text, mode, values: mode === "read" ? "" : values,
          output: mode === "tender" ? "report" : output, login: login === NONE ? null : login,
          title: shownTitle || null, requires_review: review, labels: labelList, device_id: deviceId,
        });
        return { kind: "task", task };
      }
      if (runMode) {
        // Each step to its suggested agent, else to the agent picked here.
        const plan = await api<{ suggested: Record<string, string>; needs: { node_id: string }[] }>(
          `/api/workflows/${flowId}/assignments${branchId ? `?branch_id=${branchId}` : ""}`,
        );
        const assign = Object.fromEntries(
          plan.needs.map((n) => [n.node_id, plan.suggested[n.node_id] ?? (hasAgent ? agentId : null)]).filter(([, v]) => v),
        );
        const run = await api<Run>(`/api/workflows/${flowId}/runs`, "POST", {
          title: shownTitle, input: text, branch_id: branchId, assign, file_ids: files.map((f) => f.id),
        });
        return { kind: "run", run };
      }
      const task = await api<Task>("/api/tasks", "POST", {
        title: shownTitle, brief, priority, requires_review: review, goal: goal.trim() || null,
        labels: kind === "research" ? ["research", ...labelList] : labelList,
        assignee_agent_id: hasAgent ? agentId : null,
        start: hasAgent && (kind === "research" || startNow),
        file_ids: files.map((f) => f.id), workflow_id: kind === "workflow" ? flowId : null,
        blocked_by: after.map((a) => a.id), objective_id: objective,
        ...(canShare ? { visibility } : {}),
      });
      return { kind: "task", task };
    },
    onSuccess: (r) => {
      for (const k of [workKeys.tasks, workKeys.agents, keys.status, ["office"], runKeys.all, teamKeys.schedules]) void qc.invalidateQueries({ queryKey: k });
      if (hasAgent) rememberAgent(agentId);
      if (r.kind === "schedule") toast.success(runNow ? t("Scheduled, and the first run has started.") : t("Scheduled."));
      else if (r.kind === "run") toast.success(t("Started. Each step goes to its agent; decisions come to you."));
      else if (kind === "browse") toast.success(t("{name} is on it. Watch the browser here.", { name: agent?.name ?? "" }));
      else {
        const task = r.task;
        toast.success(task.status === "blocked" ? t("Created. It starts when the tasks it waits for are done.")
          : task.status === "ready" || task.status === "running" || task.run_count ? t("{name} is on it.", { name: task.assignee_name ?? agent?.name ?? "" })
          : t("Task created."));
      }
      onClose();
      if (prefill.onCreated) {
        prefill.onCreated(r);
        return;
      }
      if (r.kind === "schedule") void navigate({ to: "/schedules" });
      else if (r.kind === "run") void navigate({ to: "/workflows", search: { run: r.run.id } });
      else void navigate({ to: "/tasks", search: { task: r.task.id } });
    },
  });
  const fields = submit.error instanceof ApiError ? submit.error.fields : {};
  const send = () => {
    if (ready && !submit.isPending) submit.mutate();
  };

  // Ready to type on open (touch screens wait for a tap, so the keyboard does not cover it).
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) box.current?.focus();
  }, []);

  const primary = repeatOn ? t("Create schedule")
    : kind === "browse" ? t("Start browsing")
    : kind === "research" ? t("Start research")
    : runMode ? t("Start the workflow")
    : hasAgent && startNow ? t("Start task") : t("Create task");
  const PrimaryIcon = repeatOn ? RepeatIcon : kind === "browse" ? BrowserIcon : kind === "research" ? GlobeIcon : runMode ? FlowArrowIcon : LightningIcon;
  const placeholder = kind === "research" ? t("e.g. Which suppliers in Selangor sell food-grade gloves, and at what price per box?")
    : kind === "browse" ? (mode === "read" ? t("e.g. List every invitation to quote: reference, agency, item, value and closing date.") : t("e.g. Update our company profile and save it."))
    : t("e.g. Reconcile September bank statements and list anything that does not match.");

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          className={cn(
            "fixed inset-0 z-50 flex max-w-[100vw] flex-col bg-surface outline-none",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[min(100vw,45rem)] sm:border-l sm:border-border sm:shadow-[var(--shadow-pop)]",
            "data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
          )}
        >
          <div className="flex min-w-0 shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-semibold">{prefill.fromTask ? t("Repeat on a schedule") : t("Give a task")}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[13px] text-muted">
                {t("Say what you need. Pick how, who and when; the agent follows its SOPs and asks you before anything risky.")}
              </Dialog.Description>
            </div>
            <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Close")}>
              <XIcon size={18} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
              {/* ---- what */}
              <section className="grid min-w-0 gap-2.5">
                <label htmlFor="composer-what" className="text-[19px] leading-snug font-semibold">{t("What do you need?")}</label>
                <div className="relative min-w-0">
                  <textarea
                    id="composer-what"
                    ref={box}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    placeholder={placeholder}
                    aria-invalid={fields.instructions || fields.brief ? true : undefined}
                    className="block min-h-36 w-full resize-y rounded-[var(--radius-md)] border border-border bg-bg px-4 py-3 pr-14 text-[15.5px] leading-relaxed placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none max-sm:text-[16px]"
                  />
                  <div className="absolute right-2 bottom-2">
                    <VoiceInput round onText={(said) => { setText((d) => (d.trim() ? `${d.trimEnd()} ${said}` : said)); box.current?.focus(); }} />
                  </div>
                </div>
                {fields.instructions ? <p role="alert" className="text-[12.5px] text-danger">{fields.instructions}</p> : null}
                <div className="grid min-w-0 gap-1">
                  <label htmlFor="composer-title" className="text-[12px] text-muted">{t("Title")}{titleEdited ? null : <span> · {t("from the first line; change it if you like")}</span>}</label>
                  <Input id="composer-title" maxLength={200} value={titleEdited ? title : titleFrom(text)} placeholder={t("A short name for the task")}
                    onChange={(e) => { setTitle(e.target.value); setTitleEdited(!!e.target.value); }} aria-invalid={fields.title ? true : undefined} />
                  {fields.title ? <p role="alert" className="text-[12.5px] text-danger">{fields.title}</p> : null}
                </div>
              </section>

              {/* ---- how */}
              <Block title={t("How")}>
                <div role="radiogroup" aria-label={t("How")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {KINDS.map((k) => {
                    const on = kind === k.kind;
                    const off = k.kind === "workflow" && !workflows.length;
                    return (
                      <button key={k.kind} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => setKind(k.kind)}
                        title={off ? t("No workflows yet. Map one on the Workflows page.") : undefined}
                        className={cn(
                          "flex min-w-0 flex-col items-start gap-1.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors disabled:opacity-50",
                          on ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-border bg-surface hover:border-accent/40 hover:bg-surface-2/50",
                        )}>
                        <k.icon size={20} weight={on ? "fill" : "duotone"} className="text-accent" />
                        <span className="text-[13.5px] leading-tight font-medium">{t(k.title)}</span>
                        <span className="text-[11.5px] leading-snug text-muted">{off ? t("No workflows yet.") : t(k.body)}</span>
                      </button>
                    );
                  })}
                </div>

                {kind === "research" ? (
                  <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
                    <Segmented label={t("Answer as")} value={output} onChange={setOutput} className="w-full [&>button]:flex-1 [&>button]:justify-center"
                      options={[{ value: "answer", label: t("A short answer with links") }, { value: "report", label: t("A report with sources") }]} />
                    <p className="text-[12px] text-muted">{t("It searches the web, reads the best pages and cites every source. Reading a page may ask your approval first, depending on the agent's settings.")}</p>
                    {noSearch ? <p className="rounded-sm bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t("{name} may not search the web. Ask whoever manages {name} to allow web search, or pick another agent.", { name: agent?.name ?? "" })}</p> : null}
                  </div>
                ) : null}

                {kind === "browse" ? (
                  <div className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
                    <Field label={t("Link")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("https://… or portal.example.com/page")} error={fields.url} inputMode="url" />
                    {myDevices.length ? <BrowseWhere devices={myDevices} value={deviceId ?? ON_SERVER} onChange={setWhere} /> : null}
                    <RadioGroup.Root value={mode} onValueChange={(v) => pickMode(v as "read" | "interact" | "tender")} aria-label={t("What it may do")} className="grid gap-2 sm:grid-cols-3">
                      <ModeChoice value="read" icon={MagnifyingGlassIcon} title={t("Find information")} body={t("Reads the page (and the pages it links to). Fills in nothing.")} />
                      <ModeChoice value="interact" icon={CursorClickIcon} title={t("Interact and fill in")} body={t("Clicks, types and fills forms. Sending a form waits for your approval.")} />
                      <ModeChoice value="tender" icon={FileTextIcon} title={t("Prepare a tender")} body={t("Researches, drafts the technical proposal and fills only verified values. Submission waits for approval.")} />
                    </RadioGroup.Root>
                    {mode === "tender" ? (
                      <Field label={t("Tender reference")} value={tenderRef} placeholder="QT2600000000XXXXX"
                        hint={t("Your company's SOPs are followed automatically: the ask below is enough.")}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (text === tenderAsk(tenderRef)) setText(tenderAsk(next));
                          setTenderRef(next);
                        }} />
                    ) : null}
                    {mode !== "read" ? (
                      <TextareaField label={mode === "tender" ? t("Known tender facts") : t("Values to fill in")} value={values} onChange={(e) => setValues(e.target.value)} rows={3}
                        placeholder={t("One per line, e.g.\nCompany name: Qbot Studio Sdn Bhd\nTelephone: +60 3-2710 4455")}
                        hint={t("It uses exactly these and asks you for anything missing. Leave empty if its SOPs or a colleague know them.")} />
                    ) : null}
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <span className="text-[13px] font-medium">{t("Sign in with")}</span>
                        <Select value={login} onValueChange={setLogin} label={t("Saved login")}
                          options={[{ value: NONE, label: t("No login needed") }, ...(logins.data ?? []).map((l) => ({ value: l.name, label: l.name, hint: l.hosts.join(", ") }))]} />
                      </div>
                      <div className="grid gap-1.5">
                        <span className="text-[13px] font-medium">{t("Answer as")}</span>
                        <Select value={mode === "tender" ? "report" : output} onValueChange={(v) => setOutput(v as "answer" | "report")} label={t("Answer as")} disabled={mode === "tender"}
                          options={[{ value: "answer", label: t("A short answer") }, { value: "report", label: t("A report with a table") }]} />
                      </div>
                    </div>
                    {agent && !hasBrowser ? (
                      <p className={cn("rounded-sm px-3 py-2 text-[12.5px]", agent.can_manage ? "bg-accent-soft text-accent" : "bg-warn/10 text-warn")}>
                        {agent.can_manage
                          ? t("{name} does not have the browser yet: starting this gives it the browser tools (sending forms still asks you).", { name: agent.name })
                          : t("{name} does not have the browser. Ask whoever manages {name} to give it the browser tools.", { name: agent.name })}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {kind === "workflow" && workflows.length ? (
                  <div className="grid min-w-0 gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
                    <div className="grid gap-1.5">
                      <span className="text-[13px] font-medium">{t("Workflow")}</span>
                      <Select value={flowId} onValueChange={setFlow} label={t("Workflow")}
                        options={workflows.map((w) => ({ value: w.id, label: w.name, hint: w.status === "active" ? t("{n} steps · active", { n: w.steps }) : t("{n} steps", { n: w.steps }) }))} />
                    </div>
                    <Segmented label={t("How")} value={flowMode} onChange={setFlowMode} className="w-full [&>button]:flex-1 [&>button]:justify-center"
                      options={[{ value: "follow", label: t("Agent follows it") }, { value: "run", label: t("Run step by step") }]} />
                    <p className="text-[12px] text-muted">
                      {flowMode === "follow"
                        ? t("The agent gets the workflow's steps with this brief and works through them, asking you where a step needs a person.")
                        : t("Each step becomes its own task for the right agent (the one picked below fills any gaps); decisions, answers and reviews come to you.")}
                    </p>
                  </div>
                ) : null}
              </Block>

              {/* ---- who */}
              <Block title={t("Who")} hint={runMode ? t("Fills any step without its own agent.") : undefined}>
                {loadingAgents ? <p className="text-[13px] text-muted">{t("Loading…")}</p> : usable.length ? (
                  <AgentPicker agents={usable} value={agentId} onChange={setPicked} twinId={twin?.id} label={t("Who")}
                    allowNobody={(kind === "general" || (kind === "workflow" && !runMode)) && !repeatOn} />
                ) : (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-4 text-[13px] text-muted">{t("No agent you can give work to yet.")}</p>
                )}
                {needsAgent && !hasAgent && usable.length ? <p className="text-[12.5px] text-warn">{t("Pick an agent for this.")}</p> : null}
              </Block>

              {/* ---- when */}
              <Block title={t("When")} hint={!canRepeat ? t("Repeating works for general tasks and web research.") : undefined}>
                <Segmented label={t("When")} value={repeatOn ? "repeat" : "now"} onChange={(v) => setRepeat(v === "repeat")} className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center"
                  options={[{ value: "now", label: t("Now") }, ...(canRepeat ? [{ value: "repeat" as const, label: t("Repeat") }] : [])]} />
                {repeatOn ? (
                  <div className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3">
                    <div role="radiogroup" aria-label={t("How often")} className="flex flex-wrap gap-1.5">
                      {PRESETS.map((p) => (
                        <button key={p.value} type="button" role="radio" aria-checked={preset === p.value} onClick={() => setPreset(p.value)}
                          className={cn("h-9 rounded-full border px-3.5 text-[13px] transition-colors", preset === p.value ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-accent/40")}>
                          {t(p.label)}
                        </button>
                      ))}
                    </div>
                    {preset === "custom" ? (
                      <Field label={t("Cron expression")} value={custom} onChange={(e) => setCustom(e.target.value)} className="font-mono"
                        hint={t("minute hour day month weekday, e.g. 30 8 * * 1-5. At most every 15 minutes.")} />
                    ) : (
                      <label className="flex items-center gap-2.5 text-[13px]">
                        <span className="font-medium">{t("At")}</span>
                        <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" aria-label={t("Time")} />
                      </label>
                    )}
                    {preview.data?.ok === false ? <p role="alert" className="text-[12.5px] text-danger">{preview.data.error}</p> : null}
                    {preview.data?.ok ? <p className="text-[12.5px] text-muted">{t("Next: {times}", { times: preview.data.next.slice(0, 3).map(when).join(" · ") })}</p> : null}
                    <SwitchField checked={runNow} onCheckedChange={setRunNow} label={t("Also run it once now")} hint={t("Each run is a fresh task for the agent; it appears on the board.")} />
                  </div>
                ) : null}
              </Block>

              {/* ---- more */}
              <section className="grid min-w-0 gap-3">
                <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
                  className="flex min-h-10 items-center gap-2 justify-self-start rounded-sm text-[13px] font-semibold hover:text-accent">
                  <CaretRightIcon size={13} weight="bold" className={cn("transition-transform", more && "rotate-90")} /> {t("More options")}
                  {!more && files.length ? <span className="font-normal text-muted">{t("{n} files", { n: files.length })}</span> : null}
                </button>
                {more ? (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-[var(--radius-md)] border border-border p-3 sm:p-4">
                    <SwitchField checked={review} onCheckedChange={setReview} label={t("I review the result")} hint={t("Finished work waits in review until you accept it or send it back.")} />
                    {!repeatOn && kind !== "browse" ? (
                      <>
                        {kind === "general" && hasAgent ? (
                          <SwitchField checked={startNow} onCheckedChange={setStartNow} label={after.length ? t("Start by itself when they are done") : t("Start now")}
                            hint={after.length ? t("Off: it moves to Ready when they are done, and waits for you to start it.") : t("Otherwise it waits in Ready until you start it.")} />
                        ) : null}
                        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                          <div className="grid gap-1.5">
                            <span className="text-[13px] font-medium">{t("Priority")}</span>
                            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} label={t("Priority")}
                              options={[{ value: "low", label: t("Low") }, { value: "normal", label: t("Normal") }, { value: "high", label: t("High") }, { value: "urgent", label: t("Urgent") }]} />
                          </div>
                          {canShare ? (
                            <div className="grid gap-1.5">
                              <span className="text-[13px] font-medium">{t("Who can see it")}</span>
                              <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)} label={t("Who can see it")}
                                options={VISIBILITY.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) }))} />
                            </div>
                          ) : null}
                        </div>
                        <Field label={t("Keep going until (optional)")} value={goal} onChange={(e) => setGoal(e.target.value)}
                          placeholder={t("e.g. all 12 invoices are reconciled and the totals match")}
                          hint={t("If set, the agent keeps working and a check re-runs it until this is true (up to a few tries).")} />
                        <div className="grid min-w-0 gap-1.5">
                          <span className="text-[13px] font-medium">{t("Files for the agent")} {files.length ? <span className="font-normal text-muted">({files.length})</span> : null}</span>
                          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-sm border border-dashed border-border bg-surface-2/40 p-2">
                            {files.map((f) => (
                              <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
                                <FileIcon size={13} className="shrink-0 text-muted" />
                                <span className="truncate">{f.name}</span>
                                <button type="button" aria-label={t("Remove {name}", { name: f.name })} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
                                  className="grid size-6 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
                              </span>
                            ))}
                            <Button size="sm" variant="outline" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> {files.length ? t("Add more") : t("Attach or upload")}</Button>
                          </div>
                        </div>
                        {!runMode ? <ObjectivePicker value={objective} onChange={setObjective} branchId={branchId} /> : null}
                        <Field label={t("Labels (optional)")} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("e.g. tender, invoice")}
                          hint={t("What kind of work this is. The company overview counts work by label per branch.")} />
                        {kind === "general" ? (
                          <div className="grid min-w-0 gap-2">
                            <span className="flex items-center gap-1.5 text-[13px] font-medium"><HourglassMediumIcon size={14} className="shrink-0 text-muted" /> {t("Start after other tasks (optional)")}</span>
                            <TaskPicker value={after} onChange={setAfter} />
                          </div>
                        ) : null}
                      </>
                    ) : kind === "browse" && !repeatOn ? (
                      <Field label={t("Labels (optional)")} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("e.g. tender, invoice")} />
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          </div>

          <div className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-border px-4 py-3 sm:px-6">
            <FormError message={submit.error && !Object.keys(fields).length ? errorMessage(submit.error) : null} />
            <div className="flex min-w-0 items-center gap-2">
              <span className="mr-auto hidden text-[11.5px] text-muted sm:inline">{IS_MAC ? t("⌘ Enter to send") : t("Ctrl+Enter to send")}</span>
              <Button variant="outline" onClick={onClose} className="max-sm:flex-1">{t("Cancel")}</Button>
              <Button disabled={!ready} loading={submit.isPending} onClick={send} className="max-sm:flex-[2]">
                <PrimaryIcon size={15} weight="bold" /> {primary}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={branchId} title={t("Files for this task")}
        onPick={(f) => { setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }])); setMore(true); }} />
    </Dialog.Root>
  );
}
