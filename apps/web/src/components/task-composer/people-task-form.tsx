/**
 * P109: the task composer's "For people" side, Trello-like: what it is and what kind of work,
 * a description (Markdown, with a preview), priority, start and due dates, who it is for (one
 * or many people the giver may give work to) and who follows it, a checklist, sub-tasks (each
 * its own person's task), labels and files (upload, Files, Library, screenshots). Every
 * assignee hears of it in the office and by email with a link (when the office's mail is set up).
 */
import { CheckSquareIcon, EyeIcon, ListChecksIcon, PaperclipIcon, PencilSimpleIcon, PlusIcon, TagIcon, TreeStructureIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormError, Input } from "@/components/ui/field";
import { MultiSelect, SearchSelect, type PickOption } from "@/components/ui/search-select";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { teamPeopleQuery, type TeamPerson } from "@/lib/people";
import { CATEGORIES, dayAt, watchableQuery } from "@/lib/people-tasks";
import { keys, meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { canShareTasks, VISIBILITY, workKeys, type Priority, type Task, type Visibility } from "@/lib/work";

import { AttachBar, type PickedFile } from "./attach-bar";
import type { ComposerPrefill } from "./store";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const TEXTAREA =
  "block min-h-28 w-full resize-y rounded-[var(--radius-md)] border border-border bg-bg px-3.5 py-2.5 text-[14.5px] leading-relaxed placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none max-sm:text-[16px]";

/** A titled block of the form. */
function Part({ icon: Icon, title, hint, children }: { icon: typeof TagIcon; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] font-semibold">
        <Icon size={15} weight="duotone" className="shrink-0 self-center text-muted" /> {title}
        {hint ? <span className="text-[12px] font-normal text-muted">{hint}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** The people a giver may give work to, as picker options (me first, then my team). */
export function personOptions(people: TeamPerson[], t: (s: string, v?: Record<string, string | number>) => string): PickOption[] {
  return people.map((p) => ({
    value: p.user_id,
    label: p.me ? t("Me ({name})", { name: p.name }) : p.name,
    hint: [p.department_name, p.branch_name].filter(Boolean).join(" · ") || undefined,
    keywords: [p.email],
    group: p.me || p.reports_to_me ? t("Your team") : t("Others"),
  }));
}

interface SubDraft {
  key: number;
  title: string;
  assignee: string;
}

export function PeopleTaskForm({ prefill, onClose }: { prefill: ComposerPrefill; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: people = [], isLoading: loadingPeople } = useQuery(teamPeopleQuery);
  const { data: watchable = [] } = useQuery(watchableQuery);
  const canShare = canShareTasks(me.permissions);

  const [title, setTitle] = useState(prefill.title ?? "");
  const [brief, setBrief] = useState(prefill.brief ?? "");
  const [preview, setPreview] = useState(false);
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState<Priority>("normal");
  const [start, setStart] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  // Who: the person asked for, else nobody yet for someone with a team, else themselves.
  const leads = people.some((p) => p.reports_to_me) || people.length > 1;
  const [picked, setPicked] = useState<string[] | null>(prefill.assigneeUserIds ?? null);
  const assignees = picked ?? (loadingPeople || leads ? [] : [me.user.id]);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [subs, setSubs] = useState<SubDraft[]>([]);
  const [labels, setLabels] = useState("");
  const [files, setFiles] = useState<PickedFile[]>(prefill.files?.map((f) => ({ id: f.id, name: f.name })) ?? []);
  const [review, setReview] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>("private");

  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) document.getElementById("people-title")?.focus();
  }, []);

  const options = personOptions(people, t);
  const watchOptions: PickOption[] = watchable
    .filter((p) => !assignees.includes(p.user_id))
    .map((p) => ({ value: p.user_id, label: p.me ? t("Me ({name})", { name: p.name }) : p.name, hint: [p.department_name, p.branch_name].filter(Boolean).join(" · ") || undefined }));
  const forOthers = assignees.some((a) => a !== me.user.id);
  const labelList = labels.split(",").map((l) => l.trim()).filter(Boolean);
  const badDates = !!start && !!due && start > due;
  const ready = !!title.trim() && assignees.length > 0 && !badDates;

  const addItem = () => {
    const text = item.trim();
    if (!text) return;
    setChecklist((c) => [...c, text]);
    setItem("");
  };

  const submit = useMutation({
    mutationFn: () =>
      api<Task>("/api/tasks", "POST", {
        title: title.trim(),
        brief,
        priority,
        category,
        start_at: start ? dayAt(start, 9) : null,
        due_at: due ? dayAt(due, 17) : null,
        assignee_user_ids: assignees,
        watcher_user_ids: watchers.filter((w) => !assignees.includes(w)),
        checklist,
        subtasks: subs.filter((s) => s.title.trim()).map((s) => ({ title: s.title.trim(), assignee_user_id: s.assignee || null })),
        labels: labelList,
        file_ids: files.map((f) => f.id),
        requires_review: forOthers ? review : false,
        ...(canShare ? { visibility } : {}),
      }),
    onSuccess: (task) => {
      for (const k of [workKeys.tasks, keys.status]) void qc.invalidateQueries({ queryKey: k });
      const others = assignees.filter((a) => a !== me.user.id).length;
      toast.success(others ? (others === 1 ? t("Task created. 1 person was told.") : t("Task created. {n} people were told.", { n: others })) : t("Task created."));
      onClose();
      if (prefill.onCreated) {
        prefill.onCreated({ kind: "task", task });
        return;
      }
      void navigate({ to: "/tasks", search: { task: task.id } });
    },
  });
  const fields = submit.error instanceof ApiError ? submit.error.fields : {};
  const send = () => {
    if (ready && !submit.isPending) submit.mutate();
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); } }}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor="people-title" className="text-[13px] font-semibold">{t("Title")}</label>
            <Input id="people-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Prepare the audit pack for Maju")}
              aria-invalid={fields.title ? true : undefined} className="text-[15px]" />
            {fields.title ? <p role="alert" className="text-[12.5px] text-danger">{fields.title}</p> : null}
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("What kind of task")}</span>
              <Select value={category} onValueChange={setCategory} label={t("What kind of task")} options={CATEGORIES.map((c) => ({ value: c.value, label: t(c.label) }))} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("Priority")}</span>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} label={t("Priority")}
                options={[{ value: "low", label: t("Low") }, { value: "normal", label: t("Normal") }, { value: "high", label: t("High") }, { value: "urgent", label: t("Urgent") }]} />
            </div>
          </div>

          <div className="grid min-w-0 gap-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <label htmlFor="people-brief" className="text-[13px] font-semibold">{t("Details")}</label>
              <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-muted hover:text-fg">
                {preview ? <PencilSimpleIcon size={13} /> : <EyeIcon size={13} />} {preview ? t("Edit") : t("Preview")}
              </button>
            </div>
            {preview ? (
              <div className="min-h-28 rounded-[var(--radius-md)] border border-border bg-surface-2/30 px-3.5 py-2.5">
                {brief.trim() ? <Markdown className="text-[14px]">{brief}</Markdown> : <p className="text-[13px] text-muted">{t("Nothing written yet.")}</p>}
              </div>
            ) : (
              <textarea id="people-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} className={TEXTAREA}
                placeholder={t("What needs doing, by when and how. **Bold**, lists and links work.")} />
            )}
          </div>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("Starts")}</span>
              <div className="flex min-w-0 items-center gap-1">
                <DatePicker value={start} onChange={setStart} label={t("Starts")} className="min-w-0 flex-1" />
                {start ? <button type="button" aria-label={t("Clear the start date")} onClick={() => setStart(null)} className="grid size-10 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2"><XIcon size={14} /></button> : null}
              </div>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-[13px] font-medium">{t("Due")}</span>
              <div className="flex min-w-0 items-center gap-1">
                <DatePicker value={due} onChange={setDue} label={t("Due")} min={start ?? undefined} className="min-w-0 flex-1" />
                {due ? <button type="button" aria-label={t("Clear the due date")} onClick={() => setDue(null)} className="grid size-10 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2"><XIcon size={14} /></button> : null}
              </div>
            </div>
            {badDates ? <p role="alert" className="text-[12.5px] text-danger sm:col-span-2">{t("The start is after the due date.")}</p> : null}
          </div>

          <Part icon={UsersThreeIcon} title={t("Assign to")} hint={t("One or more people. Each one is told, with a link.")}>
            <MultiSelect value={assignees} onValueChange={setPicked} options={options} label={t("Assign to")} placeholder={t("Pick one or more people")}
              searchPlaceholder={t("Search by name or place")} emptyText={t("Nobody matches.")} />
            {!loadingPeople && people.length <= 1 ? <p className="text-[12px] text-muted">{t("You can give tasks to yourself and the people who report to you.")}</p> : null}
          </Part>

          <Part icon={EyeIcon} title={t("Watchers")} hint={t("Optional. They follow it and see every change.")}>
            <MultiSelect value={watchers} onValueChange={setWatchers} options={watchOptions} label={t("Watchers")} placeholder={t("Nobody yet")}
              searchPlaceholder={t("Search by name or place")} emptyText={t("Nobody matches.")} />
          </Part>

          <Part icon={ListChecksIcon} title={t("Checklist")} hint={checklist.length ? t("{n} items", { n: checklist.length }) : undefined}>
            {checklist.length ? (
              <ul className="grid min-w-0 gap-1">
                {checklist.map((c, i) => (
                  <li key={`${i}-${c}`} className="flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 py-1.5 text-[13.5px]">
                    <CheckSquareIcon size={15} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 break-words">{c}</span>
                    <button type="button" aria-label={t("Remove {name}", { name: c })} onClick={() => setChecklist((l) => l.filter((_, k) => k !== i))}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex min-w-0 gap-2">
              <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder={t("Add an item and press Enter")} aria-label={t("New checklist item")} maxLength={300}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addItem(); } }} className="min-w-0 flex-1" />
              <Button variant="outline" size="icon" className="size-10 shrink-0" aria-label={t("Add item")} disabled={!item.trim()} onClick={addItem}><PlusIcon size={15} /></Button>
            </div>
          </Part>

          <Part icon={TreeStructureIcon} title={t("Sub-tasks")} hint={t("Each one is its own task, with its own person and status.")}>
            {subs.map((s) => (
              <div key={s.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
                <Input value={s.title} maxLength={200} placeholder={t("What is this step?")} aria-label={t("Sub-task title")}
                  onChange={(e) => setSubs((l) => l.map((x) => (x.key === s.key ? { ...x, title: e.target.value } : x)))} className="min-w-0" />
                <button type="button" aria-label={t("Remove this sub-task")} onClick={() => setSubs((l) => l.filter((x) => x.key !== s.key))}
                  className="grid size-10 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg sm:order-last"><XIcon size={14} /></button>
                <SearchSelect value={s.assignee} onValueChange={(v) => setSubs((l) => l.map((x) => (x.key === s.key ? { ...x, assignee: v } : x)))} options={options}
                  label={t("Who does it")} placeholder={t("Same as the task")} className="col-span-2 min-w-0 sm:col-span-1" />
              </div>
            ))}
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setSubs((l) => [...l, { key: Date.now(), title: "", assignee: "" }])}>
              <PlusIcon size={14} /> {t("Add a sub-task")}
            </Button>
          </Part>

          <Part icon={TagIcon} title={t("Labels")} hint={t("Optional, separated by commas.")}>
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder={t("e.g. audit, maju")} aria-label={t("Labels")} />
          </Part>

          <Part icon={PaperclipIcon} title={t("Files")} hint={files.length ? t("{n} files", { n: files.length }) : undefined}>
            <AttachBar files={files} onAdd={(fs) => setFiles((cur) => [...cur, ...fs.filter((f) => !cur.some((c) => c.id === f.id))])}
              onRemove={(id) => setFiles((cur) => cur.filter((f) => f.id !== id))} />
          </Part>

          <div className={cn("grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border p-3", !forOthers && !canShare && "hidden")}>
            {forOthers ? <SwitchField checked={review} onCheckedChange={setReview} label={t("I check it when it is done")} hint={t("When they mark it done, it waits for you to accept it or send it back.")} /> : null}
            {canShare ? (
              <div className="grid gap-1.5">
                <span className="text-[13px] font-medium">{t("Who can see it")}</span>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)} label={t("Who can see it")}
                  options={VISIBILITY.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) }))} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 flex-col gap-2 border-t border-border px-4 py-3 sm:px-6">
        <FormError message={submit.error && !Object.keys(fields).length ? errorMessage(submit.error) : null} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="mr-auto hidden text-[11.5px] text-muted sm:inline">{IS_MAC ? t("⌘ Enter to send") : t("Ctrl+Enter to send")}</span>
          <Button variant="outline" onClick={onClose} className="max-sm:flex-1">{t("Cancel")}</Button>
          <Button disabled={!ready} loading={submit.isPending} onClick={send} className="max-sm:flex-[2]">
            <PlusIcon size={15} weight="bold" /> {t("Create task")}
          </Button>
        </div>
      </div>
    </>
  );
}
