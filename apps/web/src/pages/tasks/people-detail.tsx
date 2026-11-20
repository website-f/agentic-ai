/**
 * P109: a task for people in the task sheet, Trello-like: change everything in place (title,
 * status, kind of work, priority, start and due, who it is for and who follows it, labels,
 * details), tick the checklist, add sub-tasks and files. Every change refreshes the board live
 * (the API publishes task.updated; lib/live.ts invalidates the task queries).
 */
import { CheckIcon, DownloadSimpleIcon, EyeIcon, ListChecksIcon, NoteIcon, PaperclipIcon, PencilSimpleIcon, PlusIcon, TagIcon, TrashIcon, TreeStructureIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FileGlyph } from "@/components/file-drop";
import { Markdown } from "@/components/markdown";
import { PersonAvatar } from "@/components/person-avatar";
import { AttachBar } from "@/components/task-composer/attach-bar";
import { personOptions } from "@/components/task-composer/people-task-form";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { MultiSelect, SearchSelect, type PickOption } from "@/components/ui/search-select";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { fileSize, fileUrl } from "@/lib/documents";
import { movesFor, PERSON_STATUS, teamPeopleQuery } from "@/lib/people";
import {
  addChecklistItem, addSubtask, attachFiles, attachmentsQuery, CATEGORIES, changeChecklistItem, dayAt, isoDay, removeAttachment, removeChecklistItem, setPeople, watchableQuery,
} from "@/lib/people-tasks";
import { cn, timeAgo } from "@/lib/utils";
import { PRIORITY_INFO, STATUS_INFO, workKeys, type ChecklistItem, type Priority, type Task, type TaskDetail, type TaskStatus } from "@/lib/work";

import { DueChip } from "./team-views";

function Section({ icon: Icon, title, note, action, children }: { icon: typeof NoteIcon; title: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold">
          <Icon size={15} weight="duotone" className="text-muted" /> {title}
          {note ? <span className="font-normal text-muted">{note}</span> : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Stacked faces of the people a task is for (+N past four). */
export function AssigneeStack({ task, size = "xs", max = 4 }: { task: Task; size?: "xs" | "sm"; max?: number }) {
  const t = useT();
  const people = task.assignees?.length ? task.assignees : task.assignee_user_id ? [{ user_id: task.assignee_user_id, name: task.assignee_user_name ?? "?" }] : [];
  if (!people.length) return null;
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1.5" title={people.map((p) => p.name).join(", ")} aria-label={t("For {names}", { names: people.map((p) => p.name).join(", ") })}>
      {shown.map((p) => <PersonAvatar key={p.user_id} name={p.name} id={p.user_id} size={size} className="ring-2 ring-surface" />)}
      {people.length > max ? <span className="inline-grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-2 ring-surface">+{people.length - max}</span> : null}
    </span>
  );
}

/** Checklist progress as a thin bar and "2/5". */
export function ChecklistBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const t = useT();
  if (!total) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={t("Checklist")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span className={cn("block h-full rounded-full transition-[width]", done === total ? "bg-ok" : "bg-accent")} style={{ width: `${(done / total) * 100}%` }} />
      </span>
      <span className={cn("text-[11px] tabular", done === total ? "text-ok" : "text-muted")}>{done}/{total}</span>
    </span>
  );
}

function useRefresh(taskId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: workKeys.tasks });
    void qc.invalidateQueries({ queryKey: workKeys.task(taskId) });
  };
}

/** People pickers keep the people already on the task, even ones the viewer could not add. */
function withCurrent(options: PickOption[], current: { user_id: string; name: string }[]): PickOption[] {
  const have = new Set(options.map((o) => o.value));
  return [...options, ...current.filter((p) => !have.has(p.user_id)).map((p) => ({ value: p.user_id, label: p.name }))];
}

export function PeopleTaskDetail({ task, detail, canWrite }: { task: Task; detail: TaskDetail; canWrite: boolean }) {
  const t = useT();
  const refresh = useRefresh(task.id);
  const { data: people = [] } = useQuery({ ...teamPeopleQuery, enabled: canWrite });
  const { data: watchable = [] } = useQuery({ ...watchableQuery, enabled: canWrite });
  const [editingBrief, setEditingBrief] = useState(false);
  const [brief, setBrief] = useState(task.brief);
  const [labels, setLabels] = useState((task.labels ?? []).join(", "));
  const [title, setTitle] = useState(task.title);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Task>(`/api/tasks/${task.id}`, "PATCH", body),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const who = useMutation({
    mutationFn: (body: { assignee_user_ids?: string[]; watcher_user_ids?: string[] }) => setPeople(task.id, body),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const assignees = task.assignees ?? [];
  const watchers = task.watchers ?? [];
  const personOpts = withCurrent(personOptions(people, t), assignees);
  const watchOpts = withCurrent(
    watchable.filter((p) => !assignees.some((a) => a.user_id === p.user_id)).map((p) => ({ value: p.user_id, label: p.name, hint: [p.department_name, p.branch_name].filter(Boolean).join(" · ") || undefined })),
    watchers,
  );
  const moves = [task.status, ...movesFor(task)];
  const statusOpts = moves.map((s) => ({ value: s, label: t(PERSON_STATUS[s] ?? STATUS_INFO[s].label) }));
  const startDay = task.start_at ? isoDay(new Date(task.start_at)) : null;
  const dueDay = task.due_at ? isoDay(new Date(task.due_at)) : null;

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      {/* The facts, editable in place. */}
      <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3.5 sm:grid-cols-2">
        {canWrite ? (
          <div className="grid min-w-0 gap-1 sm:col-span-2">
            <dt className="text-[11.5px] text-muted">{t("Title")}</dt>
            <dd className="min-w-0">
              <Input value={title} maxLength={200} aria-label={t("Title")} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { if (title.trim() && title.trim() !== task.title) patch.mutate({ title: title.trim() }); else setTitle(task.title); }} />
            </dd>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-1">
          <dt className="text-[11.5px] text-muted">{t("Status")}</dt>
          <dd className="min-w-0">
            {canWrite ? (
              <Select value={task.status} onValueChange={(v) => v !== task.status && patch.mutate({ status: v as TaskStatus })} label={t("Status")} options={statusOpts} className="w-full" />
            ) : <Pill tone={STATUS_INFO[task.status].tone}>{t(PERSON_STATUS[task.status] ?? STATUS_INFO[task.status].label)}</Pill>}
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-[11.5px] text-muted">{t("What kind of task")}</dt>
          <dd className="min-w-0">
            {canWrite ? (
              <Select value={task.category ?? "general"} onValueChange={(v) => patch.mutate({ category: v })} label={t("What kind of task")} className="w-full"
                options={withCategory(task.category).map((c) => ({ value: c.value, label: t(c.label) }))} />
            ) : <span className="text-[13px]">{t(CATEGORIES.find((c) => c.value === task.category)?.label ?? "General")}</span>}
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-[11.5px] text-muted">{t("Priority")}</dt>
          <dd className="min-w-0">
            {canWrite ? (
              <Select value={task.priority} onValueChange={(v) => patch.mutate({ priority: v as Priority })} label={t("Priority")} className="w-full"
                options={(["low", "normal", "high", "urgent"] as Priority[]).map((p) => ({ value: p, label: t(PRIORITY_INFO[p].label) }))} />
            ) : <Pill tone={PRIORITY_INFO[task.priority].tone}>{t(PRIORITY_INFO[task.priority].label)}</Pill>}
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-[11.5px] text-muted">{t("Dates")}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
            {canWrite ? (
              <>
                <DatePicker value={startDay} max={dueDay ?? undefined} onChange={(d) => patch.mutate({ start_at: dayAt(d, 9) })} label={t("Starts")} className="min-w-0 flex-1 basis-32" />
                <DatePicker value={dueDay} min={startDay ?? undefined} onChange={(d) => patch.mutate({ due_at: dayAt(d, 17) })} label={t("Due")} className="min-w-0 flex-1 basis-32" />
              </>
            ) : <DueChip task={task} />}
          </dd>
        </div>
      </dl>

      <Section icon={UsersThreeIcon} title={t("Assigned to")} note={assignees.length > 1 ? t("{n} people", { n: assignees.length }) : undefined}>
        {canWrite ? (
          <MultiSelect selectAll={false} value={assignees.map((a) => a.user_id)} label={t("Assigned to")} options={personOpts} searchPlaceholder={t("Search by name or place")} emptyText={t("Nobody matches.")}
            onValueChange={(ids) => { if (ids.length) who.mutate({ assignee_user_ids: ids }); else toast(t("Pick at least one person.")); }} />
        ) : (
          <ul className="flex min-w-0 flex-wrap gap-2">
            {assignees.map((a) => <li key={a.user_id} className="inline-flex items-center gap-1.5 text-[13px]"><PersonAvatar name={a.name} id={a.user_id} size="xs" /> {a.name}</li>)}
          </ul>
        )}
      </Section>

      <Section icon={EyeIcon} title={t("Watchers")} note={watchers.length ? String(watchers.length) : undefined}>
        {canWrite ? (
          <MultiSelect selectAll={false} value={watchers.map((w) => w.user_id)} label={t("Watchers")} options={watchOpts} placeholder={t("Nobody yet")} searchPlaceholder={t("Search by name or place")} emptyText={t("Nobody matches.")}
            onValueChange={(ids) => who.mutate({ watcher_user_ids: ids })} />
        ) : watchers.length ? (
          <p className="text-[13px]">{watchers.map((w) => w.name).join(", ")}</p>
        ) : <p className="text-[13px] text-muted">{t("Nobody yet")}</p>}
      </Section>

      <Section icon={NoteIcon} title={t("Details")}
        action={canWrite && !editingBrief ? <Button size="sm" variant="ghost" onClick={() => { setBrief(task.brief); setEditingBrief(true); }}><PencilSimpleIcon size={14} /> {t("Edit")}</Button> : null}>
        {editingBrief ? (
          <div className="grid gap-2">
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} aria-label={t("Details")} autoFocus
              className="w-full rounded-[var(--radius-md)] border border-border bg-bg px-3.5 py-2.5 text-[14px] leading-relaxed focus-visible:border-accent focus-visible:outline-none max-sm:text-[16px]" />
            <div className="flex gap-2">
              <Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ brief }, { onSuccess: () => setEditingBrief(false) })}>{t("Save")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingBrief(false)}>{t("Cancel")}</Button>
            </div>
          </div>
        ) : task.brief ? <Markdown className="text-[13.5px]">{task.brief}</Markdown> : <p className="text-[13px] text-muted">{t("No details yet.")}</p>}
      </Section>

      <Checklist taskId={task.id} items={detail.checklist ?? []} canWrite={canWrite} />

      <SubTasks task={task} kids={detail.children} canWrite={canWrite} options={personOptions(people, t)} />

      <Attachments taskId={task.id} branchId={task.branch_id ?? null} canWrite={canWrite} />

      <Section icon={TagIcon} title={t("Labels")}>
        {canWrite ? (
          <Input value={labels} onChange={(e) => setLabels(e.target.value)} aria-label={t("Labels")} placeholder={t("e.g. audit, maju")}
            onBlur={() => {
              const next = labels.split(",").map((l) => l.trim()).filter(Boolean);
              if (next.join(",") !== (task.labels ?? []).join(",")) patch.mutate({ labels: next });
            }} />
        ) : task.labels?.length ? <span className="flex flex-wrap gap-1">{task.labels.map((l) => <Pill key={l}>{l}</Pill>)}</span> : null}
      </Section>
    </div>
  );
}

function withCategory(current: string | null | undefined) {
  return current && !CATEGORIES.some((c) => c.value === current) ? [...CATEGORIES, { value: current, label: current.replace(/_/g, " ") }] : CATEGORIES;
}

/** A task's checklist: tick, rename, remove, add (any task: people's or an agent's). */
export function Checklist({ taskId, items, canWrite }: { taskId: string; items: ChecklistItem[]; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const refresh = useRefresh(taskId);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The ticks show at once; the server's list replaces them when it answers.
  const put = (list: ChecklistItem[]) => qc.setQueryData<TaskDetail>(workKeys.task(taskId), (d) => (d ? { ...d, checklist: list } : d));
  const call = useMutation({
    mutationFn: (fn: () => Promise<ChecklistItem[]>) => fn(),
    onSuccess: (list) => { put(list); refresh(); },
    onError: (e) => { toast.error(errorMessage(e)); refresh(); },
  });
  const done = items.filter((i) => i.done).length;
  const add = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    call.mutate(() => addChecklistItem(taskId, v));
  };
  if (!items.length && !canWrite) return null;
  return (
    <Section icon={ListChecksIcon} title={t("Checklist")} note={items.length ? t("{done} of {total} done", { done, total: items.length }) : undefined}>
      {items.length ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={t("Checklist")} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
          <div className={cn("h-full rounded-full transition-[width]", done === items.length ? "bg-ok" : "bg-accent")} style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      ) : null}
      <ul className="grid min-w-0 gap-0.5">
        {items.map((i) => (
          <li key={i.id} className="group flex min-h-11 min-w-0 items-center gap-2.5 rounded-sm px-1.5 hover:bg-surface-2/50">
            <button type="button" role="checkbox" aria-checked={i.done} disabled={!canWrite} aria-label={i.text}
              onClick={() => { put(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x))); call.mutate(() => changeChecklistItem(taskId, i.id, { done: !i.done })); }}
              className={cn("grid size-5 shrink-0 place-items-center rounded-[5px] border transition-colors pointer-coarse:size-6", i.done ? "border-ok bg-ok text-white" : "border-border bg-surface hover:border-accent")}>
              {i.done ? <CheckIcon size={12} weight="bold" /> : null}
            </button>
            {editing === i.id ? (
              <Input value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} aria-label={t("Rename item")} className="h-9 min-w-0 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) { setEditing(null); call.mutate(() => changeChecklistItem(taskId, i.id, { text: draft.trim() })); }
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={() => { if (draft.trim() && draft.trim() !== i.text) call.mutate(() => changeChecklistItem(taskId, i.id, { text: draft.trim() })); setEditing(null); }} />
            ) : (
              <button type="button" disabled={!canWrite} onClick={() => { setEditing(i.id); setDraft(i.text); }}
                className={cn("min-w-0 flex-1 text-left text-[13.5px] break-words", i.done && "text-muted line-through")}
                title={i.done && i.done_by_name ? t("Ticked by {name}", { name: i.done_by_name }) : undefined}>
                {i.text}
              </button>
            )}
            {canWrite ? (
              <button type="button" aria-label={t("Remove {name}", { name: i.text })} onClick={() => call.mutate(() => removeChecklistItem(taskId, i.id))}
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted opacity-60 group-hover:opacity-100 hover:bg-surface-2 hover:text-danger"><TrashIcon size={13} /></button>
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        <div className="flex min-w-0 gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Add an item and press Enter")} aria-label={t("New checklist item")} maxLength={300}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="min-w-0 flex-1" />
          <Button variant="outline" size="icon" className="size-10 shrink-0" aria-label={t("Add item")} disabled={!text.trim()} onClick={add}><PlusIcon size={15} /></Button>
        </div>
      ) : null}
    </Section>
  );
}

function SubTasks({ task, kids, canWrite, options }: { task: Task; kids: Task[]; canWrite: boolean; options: PickOption[] }) {
  const t = useT();
  const refresh = useRefresh(task.id);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState("");
  const add = useMutation({
    mutationFn: () => addSubtask(task.id, { title: title.trim(), assignee_user_id: who || null }),
    onSuccess: () => { setTitle(""); setWho(""); refresh(); toast.success(t("Sub-task added.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const done = kids.filter((k) => k.status === "done").length;
  if (!kids.length && !canWrite) return null;
  return (
    <Section icon={TreeStructureIcon} title={t("Sub-tasks")} note={kids.length ? t("{done} of {total} done", { done, total: kids.length }) : undefined}>
      {kids.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
          {kids.map((c) => (
            <li key={c.id}>
              <Link to="/tasks" search={{ task: c.id }} className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2/60">
                {c.status === "done" ? <CheckIcon size={15} weight="bold" className="shrink-0 text-ok" /> : <AssigneeStack task={c} />}
                <span className="min-w-0 flex-1">
                  <span className={cn("line-clamp-2 text-[13px] font-medium break-words", c.status === "done" && "text-muted line-through")}>{c.title}</span>
                  <span className="block truncate text-[12px] text-muted">{c.assignee_user_name ?? c.assignee_name ?? t("Unassigned")}</span>
                </span>
                <DueChip task={c} />
                <Pill tone={STATUS_INFO[c.status].tone} className="shrink-0">{t(PERSON_STATUS[c.status] ?? STATUS_INFO[c.status].label)}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_auto]"
          onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Add a sub-task")} aria-label={t("Sub-task title")} maxLength={200} />
          <SearchSelect value={who} onValueChange={setWho} options={options} label={t("Who does it")} placeholder={t("Same as the task")} />
          <Button type="submit" variant="outline" disabled={!title.trim()} loading={add.isPending}><PlusIcon size={14} /> {t("Add")}</Button>
        </form>
      ) : null}
    </Section>
  );
}

function Attachments({ taskId, branchId, canWrite }: { taskId: string; branchId: string | null; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const refresh = useRefresh(taskId);
  const { data: files = [] } = useQuery(attachmentsQuery(taskId));
  const again = () => { void qc.invalidateQueries({ queryKey: attachmentsQuery(taskId).queryKey }); refresh(); };
  const attach = useMutation({
    mutationFn: (ids: string[]) => attachFiles(taskId, ids),
    onSuccess: (done) => { again(); toast.success(done.length === 1 ? t("File added to the task.") : t("{n} files added to the task.", { n: done.length })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeAttachment(taskId, id),
    onSuccess: () => again(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!files.length && !canWrite) return null;
  return (
    <Section icon={PaperclipIcon} title={t("Files")} note={files.length ? String(files.length) : undefined}>
      {files.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
          {files.map((f) => (
            <li key={f.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-1.5">
              <FileGlyph mime={f.mime} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{f.title || f.name}</span>
                <span className="block truncate text-[12px] text-muted">{[fileSize(f.size), timeAgo(f.created_at)].join(" · ")}</span>
              </span>
              <a href={fileUrl(f.id)} download className="grid size-10 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Download {name}", { name: f.name })}>
                <DownloadSimpleIcon size={16} />
              </a>
              {canWrite ? (
                <button type="button" onClick={() => remove.mutate(f.id)} aria-label={t("Take {name} off the task", { name: f.name })}
                  className="grid size-10 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-danger"><XIcon size={14} /></button>
              ) : <span />}
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? <AttachBar compact files={[]} branchId={branchId} busy={attach.isPending} onAdd={(fs) => attach.mutate(fs.map((f) => f.id))} /> : null}
    </Section>
  );
}
