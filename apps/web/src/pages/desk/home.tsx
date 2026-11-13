/** P97 (Fitri, 11 Nov 2026: "revamp the workspace ... organized ... easy to access; pin anything
 * to their workspace since it is their virtual desk, with access to anywhere from there"): the
 * desk's overview as one calm column, the most important first.
 *
 * - One bar to get anywhere (the command palette: pages, people, tasks, documents, agents) and
 *   a few quick actions: new task, ask my AI, upload, pin a page.
 * - Today: what needs the person now (their AI's questions, approvals, reviews, forms) next to
 *   the work on their plate, and today's meetings from their own calendar.
 * - Pinned: anything, in their own folders and order, renamed as they like; a pin to something
 *   they can no longer open shows as unavailable and opens nothing.
 * - Recent, My AI, How do I…?, Go to.
 * Each person shows, hides and orders these blocks (kept on the server, same on phone and PC). */
import { MyAssignedTasks } from "@/components/my-assigned-tasks";
import { assignedTasksQuery } from "@/lib/people";
import {
  AppWindowIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  BrainIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FilesIcon,
  FlowArrowIcon,
  FolderSimpleIcon,
  FolderSimplePlusIcon,
  GlobeIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  NotepadIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SpinnerGapIcon,
  StackIcon,
  SunHorizonIcon,
  UserFocusIcon,
  VideoCameraIcon,
  type Icon,
} from "@phosphor-icons/react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AllowanceMeter } from "@/components/allowance-meter";
import { IconTile, type Tone } from "@/components/page";
import { PinButton } from "@/components/pin-button";
import { GiveTaskPanel } from "@/components/task-composer/quick-kinds";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { msg, useLang, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  changePin,
  deskKeys,
  layoutOf,
  meetingsQuery,
  pinItem,
  pinTarget,
  renameFolder,
  reorderPins,
  saveLayout,
  unpinItem,
  uploadToDesk,
  workGroup,
  type Desk,
  type DeskLayout,
  type DeskSectionId,
  type Pin,
  type PinKind,
} from "@/lib/desk";
import { fileUrl } from "@/lib/documents";
import { formsQuery, needsMe, urgency } from "@/lib/forms";
import { meQuery } from "@/lib/queries";
import { usePalette } from "@/lib/stores";
import { cn, timeAgo } from "@/lib/utils";
import { toolText } from "@/lib/work";
import type { Workflow } from "@/lib/workflows";
import { ALL_NAV, navItemFor, pathAllowed } from "@/nav";
import { StartRunDialog } from "@/pages/workflows/run";
import { whenText } from "@/pages/forms/words";

import { AskPanel } from "./ask";
import { DeskShortcuts, HowDoI } from "./hub";
import type { DeskTab } from "./index";

// ---------------------------------------------------------------- what a pin is

export const PIN_ICON: Record<PinKind, Icon> = {
  sop: FileTextIcon,
  workflow: FlowArrowIcon,
  file: FilesIcon,
  document: FilesIcon,
  template: StackIcon,
  page: BrainIcon,
  task: KanbanIcon,
  agent: UserFocusIcon,
  search: MagnifyingGlassIcon,
  route: AppWindowIcon,
  link: GlobeIcon,
  report: ClipboardTextIcon,
};

const PIN_TONE: Record<PinKind, Tone> = {
  sop: "info",
  workflow: "violet",
  file: "accent",
  document: "accent",
  template: "orange",
  page: "pink",
  task: "neutral",
  agent: "ok",
  search: "neutral",
  route: "info",
  link: "neutral",
  report: "orange",
};

const KIND_LABEL: Record<PinKind, string> = {
  sop: msg("SOP"),
  workflow: msg("Workflow"),
  file: msg("File"),
  document: msg("Document"),
  template: msg("Template"),
  page: msg("Wiki page"),
  task: msg("Task"),
  agent: msg("Agent"),
  search: msg("Saved search"),
  route: msg("Page"),
  link: msg("Web link"),
  report: msg("Report"),
};

/** The office path of a screen pin, without its ?query or #hash. */
const pathOf = (ref: string) => ref.split(/[?#]/)[0] || "/";

/** A pin the person can no longer open: deleted, out of their sight, or a page their role
 * does not open (the page's own rule, checked again when it opens). */
export function unavailable(p: Pin, perms: string[]): boolean {
  if (p.missing) return true;
  return p.kind === "route" && !p.ref.startsWith("/prima/") && !pathAllowed(pathOf(p.ref), perms);
}

/** A page pin the person did not rename shows the page's name in their language now (it was
 * pinned with the name it had in the language of that day). */
function pinTitle(p: Pin, t: (s: string) => string): string {
  if (p.kind !== "route" || p.label) return p.title;
  const prima = /^\/prima#(@?[a-z0-9-]+)$/.exec(p.ref);
  if (prima) {
    const screen = PRIMA_SCREENS.find((x) => x.hash === prima[1]);
    return screen ? t(screen.label) : p.title;
  }
  const item = navItemFor(pathOf(p.ref));
  return item && item.to === pathOf(p.ref) && !p.ref.includes("?") ? t(item.label) : p.title;
}

function pinIcon(p: Pin): Icon {
  if (p.kind === "route") return navItemFor(pathOf(p.ref))?.icon ?? AppWindowIcon;
  return PIN_ICON[p.kind] ?? PushPinIcon;
}

/** Open a pin: a page of the office in place, Prima as its own app, a web link in a new tab. */
function useOpenPin() {
  const navigate = useNavigate();
  return (p: Pin) => {
    const to = pinTarget(p);
    if (to.how === "tab") window.open(to.href, "_blank", "noopener,noreferrer");
    else if (to.how === "page") window.location.assign(to.href);
    else void navigate({ href: to.href });
  };
}

// ---------------------------------------------------------------- the sections

const SECTION_TEXT: Record<DeskSectionId, { title: string; hint: string; icon: Icon }> = {
  today: { title: msg("Today"), hint: msg("What needs you now, your tasks and today's meetings."), icon: SunHorizonIcon },
  pinned: { title: msg("Pinned"), hint: msg("Anything you keep close, in your own folders."), icon: PushPinIcon },
  recent: { title: msg("Recent"), hint: msg("What you and your AI worked on lately."), icon: ClockCounterClockwiseIcon },
  ai: { title: msg("My AI"), hint: msg("Give your AI a task and see today's allowance."), icon: SparkleIcon },
  howto: { title: msg("How do I…?"), hint: msg("Find how a job is done here, step by step."), icon: FlowArrowIcon },
  goto: { title: msg("Go to"), hint: msg("Every page you use, one tap away."), icon: AppWindowIcon },
};

/** The overview of the desk. */
export function DeskHome({ desk, onTab, customizing, onCustomize }: {
  desk: Desk;
  onTab: (tab: DeskTab) => void;
  customizing: boolean;
  onCustomize: (open: boolean) => void;
}) {
  const t = useT();
  const layout = layoutOf(desk);
  const blocks: Record<DeskSectionId, ReactNode> = {
    today: <Today desk={desk} onTab={onTab} />,
    pinned: <Pinned desk={desk} folders={layout.folders} />,
    recent: <Recent desk={desk} onTab={onTab} />,
    ai: <MyAi desk={desk} />,
    howto: <section aria-label={t("How do I…?")}><SectionHead id="howto" /><HowDoI desk={desk} headless /></section>,
    goto: <GoTo desk={desk} onTab={onTab} />,
  };
  return (
    <div className="grid min-w-0 gap-6 sm:gap-7">
      <CommandBar desk={desk} />
      {layout.sections.filter((s) => !s.hidden).map((s) => (
        <div key={s.id} className="min-w-0" data-desk-section={s.id}>{blocks[s.id]}</div>
      ))}
      <div className="flex justify-center pt-1">
        <Button variant="ghost" size="sm" onClick={() => onCustomize(true)}>
          <SlidersHorizontalIcon size={15} /> {t("Customize my desk")}
        </Button>
      </div>
      <CustomizeDialog open={customizing} onOpenChange={onCustomize} layout={layout} />
    </div>
  );
}

/** A section's heading: a quiet label, a count and its actions on the right. */
function SectionHead({ id, count, actions }: { id: DeskSectionId; count?: number; actions?: ReactNode }) {
  const t = useT();
  const s = SECTION_TEXT[id];
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
        <s.icon size={18} className="shrink-0 text-accent" weight="duotone" />
        <span className="truncate">{t(s.title)}</span>
        {count ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold text-muted tabular">{count}</span> : null}
      </h2>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one bar to anywhere

function CommandBar({ desk }: { desk: Desk }) {
  const t = useT();
  const qc = useQueryClient();
  const palette = usePalette();
  const input = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState(false);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await uploadToDesk(f);
      return files.length;
    },
    onSuccess: (n) => {
      toast.success(t("{n} file(s) added to your workspace.", { n }));
      void qc.invalidateQueries({ queryKey: deskKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const chip = "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-fg transition-colors hover:border-accent/40 hover:bg-accent-soft/40 active:scale-[0.98] pointer-coarse:h-11";
  return (
    <section aria-label={t("Search or jump anywhere")} className="grid min-w-0 gap-3" data-guide="desk.ask">
      <button
        type="button"
        onClick={() => palette.setOpen(true)}
        className="group flex h-14 w-full min-w-0 items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.05)] transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
      >
        <MagnifyingGlassIcon size={20} className="shrink-0 text-muted group-hover:text-accent" />
        <span className="min-w-0 flex-1 truncate text-[15px] text-muted">{t("Search or jump to anything: pages, people, tasks, documents, agents")}</span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-[5px] border border-border bg-surface-2 px-1.5 font-sans text-[11.5px] text-muted">Ctrl</kbd>
          <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-[5px] border border-border bg-surface-2 px-1.5 font-sans text-[11.5px] text-muted">K</kbd>
        </span>
      </button>
      <div className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {desk.can_ask ? (
          <button type="button" className={chip} onClick={() => openTaskComposer()}>
            <PlusIcon size={16} className="text-accent" /> {t("New task")}
          </button>
        ) : null}
        {desk.can_ask ? (
          <button type="button" className={chip} onClick={() => setAsking(true)}>
            <SparkleIcon size={16} className="text-accent" /> {t("Ask my AI")}
          </button>
        ) : null}
        {desk.can_ask ? (
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) upload.mutate(list); }} />
            <button type="button" className={chip} onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <SpinnerGapIcon size={16} className="animate-spin" /> : <CloudArrowUpIcon size={16} className="text-accent" />} {t("Upload a file")}
            </button>
          </>
        ) : null}
        <button type="button" className={chip} onClick={() => setAdding(true)}>
          <PushPinIcon size={16} className="text-accent" /> {t("Pin a page or link")}
        </button>
      </div>
      <ResponsiveDialog open={asking} onOpenChange={setAsking} title={t("Ask my AI")}
        description={t("Search the company's documents, or hand the question to your AI: it answers with the sources and keeps what it makes on your desk.")}
        className="w-[min(94vw,44rem)]">
        <AskPanel bare />
      </ResponsiveDialog>
      <AddPinDialog open={adding} onOpenChange={setAdding} folders={layoutOf(desk).folders} pins={desk.pins} />
    </section>
  );
}

// ---------------------------------------------------------------- today

interface NeedRow { key: string; icon: Icon; tone: string; title: string; hint: string; to: ReactNode }

function Today({ desk, onTab }: { desk: Desk; onTab: (tab: DeskTab) => void }) {
  const t = useT();
  const w = desk.waiting;
  const { data: forms = [] } = useQuery(formsQuery());
  const due = forms.filter(needsMe).sort((a, b) => urgency(a) - urgency(b)).slice(0, 4);
  const go = (label: string, el: ReactNode) => <span aria-label={label} className="text-[12.5px] font-medium text-accent">{el}</span>;
  const needs: NeedRow[] = [
    ...w.approvals.map((a) => ({
      key: a.id,
      icon: a.kind === "question" ? SparkleIcon : SealCheckIcon,
      tone: "text-warn",
      title: a.kind === "question" ? (a.reason || a.task_title) : a.task_title,
      hint: a.kind === "question" ? t("Your AI asks you · {task}", { task: a.task_title }) : t("Waiting for your OK: {what}", { what: toolText(a) }),
      to: <Link to="/approvals" className="hit">{go(t("Answer"), t("Answer"))}</Link>,
    })),
    ...w.documents.map((d) => ({
      key: d.id,
      icon: FileTextIcon,
      tone: "text-info",
      title: d.title,
      hint: t("Made by AI, waiting for your review"),
      to: <Link to="/documents" search={{ d: d.id }} className="hit">{go(t("Review"), t("Review"))}</Link>,
    })),
    ...w.reviews.map((r) => ({
      key: r.id,
      icon: CheckCircleIcon,
      tone: "text-info",
      title: r.title,
      hint: t("Finished, waiting for you to accept"),
      to: <Link to="/tasks" search={{ task: r.id }} className="hit">{go(t("Review"), t("Review"))}</Link>,
    })),
    ...due.map((f) => ({
      key: f.id,
      icon: NotepadIcon,
      tone: f.state === "late" || f.state === "returned" ? "text-danger" : "text-warn",
      title: f.name,
      hint: whenText(t, f),
      to: <Link to="/forms" search={{ tab: "todo", form: f.id }} className="hit">{go(t("Fill in"), t("Fill in"))}</Link>,
    })),
  ];
  // P97: tasks people gave this person (team's MyAssignedTasks) sit first under Today when there
  // are any; "On my plate" keeps the work they gave and what their AI does.
  const mine = desk.work.filter((x) => workGroup(x.status) !== "done").slice(0, 5);
  const total = needs.length;
  return (
    <section data-guide="desk.waiting" aria-label={t("Today")}>
      <SectionHead id="today" count={total || undefined} />
      <AssignedToMe />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title={t("Needs you")} description={total ? t("Answer these first.") : undefined}
            icon={<IconTile icon={SealCheckIcon} size="sm" tone={total ? "warn" : "ok"} />} />
          {needs.length ? (
            <ul className="divide-y divide-border">
              {needs.slice(0, 8).map((r) => (
                <li key={r.key} className="flex min-w-0 items-start gap-3 px-4 py-3 sm:px-5">
                  <r.icon size={18} className={cn("mt-0.5 shrink-0", r.tone)} weight="duotone" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-[14px] font-medium break-words line-clamp-2">{r.title}</span>
                    <span className="truncate text-[12.5px] text-muted">{r.hint}</span>
                  </span>
                  <span className="shrink-0 pt-0.5">{r.to}</span>
                </li>
              ))}
              {needs.length > 8 ? (
                <li className="px-4 py-2.5 text-[12.5px] sm:px-5">
                  <Link to="/approvals" className="font-medium text-accent hover:underline">{t("{n} more", { n: needs.length - 8 })}</Link>
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="flex items-center gap-3 px-4 py-5 text-[13.5px] text-muted sm:px-5">
              <CheckCircleIcon size={22} weight="duotone" className="shrink-0 text-ok" />
              <span>{t("Nothing needs you right now. Your AI asks here before anything important.")}</span>
            </div>
          )}
          <Meetings show={!!desk.may_assist} />
        </Card>
        <Card className="min-w-0 overflow-hidden" data-slot="assigned-to-me" data-guide="desk.stats">
          <CardHeader title={t("On my plate")} description={t("Work you gave and what your AI is doing.")}
            icon={<IconTile icon={KanbanIcon} size="sm" tone="info" />}
            actions={<button type="button" onClick={() => onTab("work")} className="hit text-[12.5px] font-medium text-accent hover:underline">{t("All my work")}</button>} />
          {mine.length ? (
            <ul className="divide-y divide-border">
              {mine.map((x) => (
                <li key={x.id}>
                  <Link to="/tasks" search={{ task: x.id }} className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:px-5">
                    {x.status === "running" ? <SpinnerGapIcon size={18} className="shrink-0 animate-spin text-info" /> : <KanbanIcon size={18} className="shrink-0 text-muted" weight="duotone" />}
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-[14px] font-medium">{x.title}</span>
                      <span className="truncate text-[12.5px] text-muted">{[x.agent_name, timeAgo(x.updated_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <WorkPill status={x.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-3 px-4 py-5 text-[13.5px] text-muted sm:px-5">
              <span>{t("Nothing on your plate. Give your AI a task, or start one yourself.")}</span>
              {desk.can_ask ? (
                <span><Button size="sm" variant="outline" onClick={() => openTaskComposer()}><PlusIcon size={14} /> {t("New task")}</Button></span>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger" }> = {
  triage: { label: msg("Queued"), tone: "neutral" },
  ready: { label: msg("Queued"), tone: "neutral" },
  running: { label: msg("Working"), tone: "info" },
  blocked: { label: msg("Needs you"), tone: "warn" },
  review: { label: msg("Review"), tone: "warn" },
  done: { label: msg("Done"), tone: "ok" },
  failed: { label: msg("Failed"), tone: "danger" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
};

function WorkPill({ status }: { status: string }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.ready!;
  return <Pill tone={s.tone}>{t(s.label)}</Pill>;
}

/** Today's meetings from the person's own calendar (people with assistants and Google). */
function Meetings({ show }: { show: boolean }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { data } = useQuery(meetingsQuery(show));
  if (!show || !data) return null;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(lang === "ms" ? "ms-MY" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="border-t border-border px-4 py-3 sm:px-5">
      <p className="flex items-center gap-2 pb-2 text-[12.5px] font-semibold text-muted">
        <CalendarDotsIcon size={15} /> {t("Meetings today")}
      </p>
      {!data.connected ? (
        <p className="text-[12.5px] text-muted">
          {t("Connect Google on My assistants to see today's meetings here.")}{" "}
          <Link to="/assistants" className="font-medium text-accent hover:underline">{t("Connect")}</Link>
        </p>
      ) : data.events.length ? (
        <ul className="grid gap-1.5">
          {data.events.map((e) => (
            <li key={e.id} className="flex min-w-0 items-center gap-3 text-[13.5px]">
              <span className="w-[6.5rem] shrink-0 text-[12.5px] text-muted tabular">{e.all_day ? t("All day") : `${hm(e.start)}–${hm(e.end)}`}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}{e.location ? <span className="text-muted"> · {e.location}</span> : null}</span>
              {e.meet ? (
                <a href={e.meet} target="_blank" rel="noopener noreferrer" className="hit inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
                  <VideoCameraIcon size={14} /> {t("Join")}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">{data.problem ? t("Your calendar could not be read just now.") : t("No meetings today.")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pinned

type Dialog =
  | { kind: "edit"; pin: Pin }
  | { kind: "folder-new" }
  | { kind: "folder-rename"; name: string }
  | { kind: "add" }
  | null;

/** Put the desk's pins in this order (and folders) at once, before the server answers. */
function useLocalPins() {
  const qc = useQueryClient();
  return (fn: (pins: Pin[]) => Pin[]) =>
    qc.setQueryData<Desk>(deskKeys.desk, (d) => (d ? { ...d, pins: fn(d.pins) } : d));
}

function Pinned({ desk, folders }: { desk: Desk; folders: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const local = useLocalPins();
  const me = useQuery(meQuery);
  const perms = me.data?.permissions ?? [];
  const [arranging, setArranging] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [running, setRunning] = useState<Workflow | null>(null);
  const pins = desk.pins;
  // Ungrouped first, then each folder in the person's order (and any folder only a pin names).
  const names = [...folders, ...pins.map((p) => p.folder).filter((f): f is string => !!f && !folders.includes(f))]
    .filter((f, i, all) => all.indexOf(f) === i);
  const groups: { name: string | null; pins: Pin[] }[] = [
    { name: null, pins: pins.filter((p) => !p.folder || !names.includes(p.folder)) },
    ...names.map((name) => ({ name, pins: pins.filter((p) => p.folder === name) })),
  ];
  const refresh = () => void qc.invalidateQueries({ queryKey: deskKeys.all });
  const order = useMutation({
    mutationFn: (ids: string[]) => reorderPins(ids),
    onSettled: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unpin = useMutation({
    mutationFn: (id: string) => unpinItem(id),
    onMutate: (id) => local((all) => all.filter((p) => p.id !== id)),
    onSuccess: () => toast.success(t("Taken off your workspace.")),
    onSettled: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeFolder = useMutation({
    mutationFn: (name: string) => renameFolder(name, null),
    onSuccess: () => toast.success(t("Folder removed. Its pins stay on your desk.")),
    onSettled: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (id: string) => api<Workflow>(`/api/workflows/${id}`),
    onSuccess: setRunning,
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** A group's new order: the whole list in display order goes to the server. */
  const reorderGroup = (name: string | null, ids: string[]) => {
    const all = groups.flatMap((g) => (g.name === name ? ids : g.pins.map((p) => p.id)));
    local((cur) => all.map((id) => cur.find((p) => p.id === id)).filter((p): p is Pin => !!p));
    order.mutate(all);
  };
  const move = (g: { name: string | null; pins: Pin[] }, id: string, by: -1 | 1) => {
    const ids = g.pins.map((p) => p.id);
    const i = ids.indexOf(id);
    if (i + by < 0 || i + by >= ids.length) return;
    reorderGroup(g.name, arrayMove(ids, i, i + by));
  };
  const actions = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "add" })}><PlusIcon size={15} /> {t("Add")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "folder-new" })}><FolderSimplePlusIcon size={15} /> {t("New folder")}</Button>
      {pins.length > 1 ? (
        <Button size="sm" variant={arranging ? "secondary" : "ghost"} aria-pressed={arranging} onClick={() => setArranging((v) => !v)}>
          <DotsSixVerticalIcon size={15} /> {arranging ? t("Done") : t("Arrange")}
        </Button>
      ) : null}
    </>
  );
  return (
    <section data-guide="desk.pinned" aria-label={t("Pinned")}>
      <SectionHead id="pinned" count={pins.length || undefined} actions={actions} />
      {arranging ? (
        <p className="-mt-1 pb-3 text-[12.5px] text-muted">{t("Drag a pin by its handle, or focus the handle and use Space and the arrow keys. Move pins between folders with Edit.")}</p>
      ) : null}
      {pins.length || names.length ? (
        <div className="grid min-w-0 gap-5">
          {groups.map((g) =>
            g.name === null && !g.pins.length ? null : (
              <div key={g.name ?? ""} className="grid min-w-0 gap-2.5">
                {g.name !== null ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderSimpleIcon size={16} weight="duotone" className="shrink-0 text-muted" />
                    <h3 className="min-w-0 truncate text-[13px] font-semibold text-muted">{g.name}</h3>
                    <span className="text-[12px] text-muted/80 tabular">{g.pins.length}</span>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" className="size-7" aria-label={t("Folder {name}: more", { name: g.name })}><DotsThreeIcon size={16} /></Button>
                      </MenuTrigger>
                      <MenuContent align="start">
                        <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setDialog({ kind: "folder-rename", name: g.name! })}>{t("Rename folder")}</MenuItem>
                        <MenuItem icon={<FolderSimpleIcon />} onSelect={() => removeFolder.mutate(g.name!)}>{t("Remove folder (keep its pins)")}</MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                ) : null}
                {g.pins.length ? (
                  <PinGrid
                    pins={g.pins}
                    perms={perms}
                    arranging={arranging}
                    onOrder={(ids) => reorderGroup(g.name, ids)}
                    menu={(p, i) => (
                      <>
                        {p.kind === "workflow" && !unavailable(p, perms) ? (
                          <MenuItem icon={<PlayIcon />} onSelect={() => run.mutate(p.ref)}>{t("Run")}</MenuItem>
                        ) : null}
                        {p.kind === "file" && !unavailable(p, perms) ? (
                          <MenuItem icon={<DownloadSimpleIcon />} onSelect={() => window.location.assign(fileUrl(p.ref))}>{t("Download")}</MenuItem>
                        ) : null}
                        <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setDialog({ kind: "edit", pin: p })}>{t("Rename or move to a folder")}</MenuItem>
                        {i > 0 ? <MenuItem icon={<ArrowUpIcon />} onSelect={() => move(g, p.id, -1)}>{t("Move up")}</MenuItem> : null}
                        {i < g.pins.length - 1 ? <MenuItem icon={<ArrowDownIcon />} onSelect={() => move(g, p.id, 1)}>{t("Move down")}</MenuItem> : null}
                        <MenuSeparator />
                        <MenuItem danger icon={<PushPinSlashIcon />} onSelect={() => unpin.mutate(p.id)}>{t("Unpin")}</MenuItem>
                      </>
                    )}
                  />
                ) : (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-3 text-[12.5px] text-muted">
                    {t("Empty folder. Choose Rename or move to a folder on a pin to put it here.")}
                  </p>
                )}
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-surface/60 px-5 py-6 text-[13.5px] text-muted sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <PushPinIcon size={22} weight="duotone" className="text-accent" />
          <p>{t("Pin anything you use often: a page, a task, a file, a document, an agent, a report or a web link. Press the pin next to it, or Ctrl K and Pin this page.")}</p>
          <Button size="sm" onClick={() => setDialog({ kind: "add" })}><PlusIcon size={15} /> {t("Pin a page or link")}</Button>
        </div>
      )}
      {dialog?.kind === "edit" ? <EditPinDialog pin={dialog.pin} folders={names} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "folder-new" || dialog?.kind === "folder-rename" ? (
        <FolderDialog rename={dialog.kind === "folder-rename" ? dialog.name : null} folders={names} onClose={() => setDialog(null)} />
      ) : null}
      <AddPinDialog open={dialog?.kind === "add"} onOpenChange={(o) => setDialog(o ? { kind: "add" } : null)} folders={names} pins={pins} />
      {running ? <StartRunDialog wf={running} onClose={() => setRunning(null)} /> : null}
    </section>
  );
}

function PinGrid({ pins, perms, arranging, onOrder, menu }: {
  pins: Pin[];
  perms: string[];
  arranging: boolean;
  onOrder: (ids: string[]) => void;
  menu: (p: Pin, index: number) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = pins.map((p) => p.id);
  const onDragEnd = (e: DragEndEvent) => {
    const from = ids.indexOf(String(e.active.id));
    const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    onOrder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {pins.map((p, i) => (
            <PinTile key={p.id} pin={p} off={unavailable(p, perms)} arranging={arranging} menu={menu(p, i)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function PinTile({ pin: p, off, arranging, menu }: { pin: Pin; off: boolean; arranging: boolean; menu: ReactNode }) {
  const t = useT();
  const open = useOpenPin();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: !arranging });
  const IconCmp = pinIcon(p);
  const title = pinTitle(p, t);
  const sub = off
    ? t("Not available: removed, or you can no longer open it")
    : p.kind === "route"
      ? (p.ref.startsWith("/prima") ? "Prima" : t(KIND_LABEL.route))
      : [t(KIND_LABEL[p.kind]), p.kind === "sop" ? null : p.sub].filter(Boolean).join(" · ");
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative flex min-h-[3.75rem] min-w-0 items-center gap-1 rounded-[var(--radius-md)] border border-border bg-surface pr-1 transition-[border-color,box-shadow]",
        !off && "hover:border-accent/40 hover:shadow-[var(--shadow-soft)]",
        isDragging && "z-10 border-accent shadow-[var(--shadow-pop)]",
      )}
    >
      {arranging ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("Move {name}", { name: title })}
          className="hit ml-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
        >
          <DotsSixVerticalIcon size={18} />
        </button>
      ) : null}
      <button
        type="button"
        disabled={off || arranging}
        onClick={() => open(p)}
        title={off ? t("Not available: removed, or you can no longer open it") : title}
        className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] py-2.5 text-left focus-visible:outline-none", arranging ? "pl-1" : "pl-3", off && "cursor-not-allowed opacity-55")}
      >
        <IconTile icon={IconCmp} tone={off ? "neutral" : PIN_TONE[p.kind]} size="sm" />
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-[14px] font-medium">{title}</span>
          <span className="truncate text-[12px] text-muted">{sub}</span>
        </span>
        {p.kind === "link" && !off ? <ArrowSquareOutIcon size={14} className="shrink-0 text-muted" aria-label={t("Opens in a new tab")} /> : null}
      </button>
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={t("{name}: more", { name: title })}>
            <DotsThreeIcon size={18} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">{menu}</MenuContent>
      </Menu>
    </li>
  );
}

function EditPinDialog({ pin, folders, onClose }: { pin: Pin; folders: string[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [label, setLabel] = useState(pin.label ?? pin.title);
  const NEW = "\u0000new";
  const NONE = "\u0000none";
  const [folder, setFolder] = useState<string>(pin.folder ?? NONE);
  const [newFolder, setNewFolder] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const name = label.trim();
      const own = name && name !== (pin.name ?? pin.title) ? name : "";
      const where = folder === NEW ? newFolder.trim() || null : folder === NONE ? null : folder;
      if (folder === NEW && where && !folders.includes(where)) await saveLayout({ folders: [...folders, where] });
      return changePin(pin.id, { label: own, folder: where });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(t("Saved."));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Rename or move")}
      description={pin.name && pin.name !== pin.title ? t("Its own name: {name}", { name: pin.name }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button>
        </>
      }>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={t("Name on your desk")} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)}
          hint={t("Only you see this name. Leave it as it is to keep the original.")} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Folder")}</span>
          <Select label={t("Folder")} value={folder} onValueChange={setFolder}
            options={[
              { value: NONE, label: t("No folder") },
              ...folders.map((f) => ({ value: f, label: f })),
              { value: NEW, label: t("New folder…") },
            ]} />
        </div>
        {folder === NEW ? (
          <Field label={t("New folder name")} value={newFolder} maxLength={60} autoFocus onChange={(e) => setNewFolder(e.target.value)} placeholder={t("e.g. Tenders, Every month")} />
        ) : null}
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  );
}

function FolderDialog({ rename, folders, onClose }: { rename: string | null; folders: string[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(rename ?? "");
  const clean = name.trim().replace(/\s+/g, " ");
  const taken = !!clean && clean !== rename && folders.includes(clean);
  const save = useMutation({
    mutationFn: () => (rename ? renameFolder(rename, clean) : saveLayout({ folders: [...folders, clean] })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={rename ? t("Rename folder") : t("New folder")}
      description={rename ? undefined : t("Group your pins, for example by job or by month.")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!clean || taken} loading={save.isPending} onClick={() => save.mutate()}>{rename ? t("Save") : t("Create")}</Button>
        </>
      }>
      <form onSubmit={(e) => { e.preventDefault(); if (clean && !taken) save.mutate(); }}>
        <Field label={t("Folder name")} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)}
          placeholder={t("e.g. Tenders, Every month")} error={taken ? t("You already have a folder with that name.") : undefined} />
      </form>
    </ResponsiveDialog>
  );
}

/** A few Prima screens people keep close (each opens through the office's Prima page, which
 * checks the person may use Prima; Prima decides the rest). */
const PRIMA_SCREENS: { hash: string; label: string }[] = [
  { hash: "clock", label: msg("Prima: Clock in") },
  { hash: "mine", label: msg("Prima: My work") },
  { hash: "home", label: msg("Prima: Home") },
  { hash: "@hr", label: msg("Prima: HR") },
  { hash: "@pay", label: msg("Prima: Pay") },
  { hash: "@ops", label: msg("Prima: Operations") },
  { hash: "reports", label: msg("Prima: Reports") },
];

function AddPinDialog({ open, onOpenChange, folders, pins }: { open: boolean; onOpenChange: (o: boolean) => void; folders: string[]; pins: Pin[] }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useQuery(meQuery);
  const perms = useMemo(() => me.data?.permissions ?? [], [me.data]);
  const [mode, setMode] = useState<"page" | "link">("page");
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const NONE = "\u0000none";
  const [folder, setFolder] = useState(NONE);
  const pages = useMemo(() => {
    const items = ALL_NAV.filter((n) => !n.hidden && n.to !== "/workspace" && pathAllowed(n.to, perms)).map((n) => ({ ref: n.to as string, label: t(n.label), icon: n.icon }));
    if (pathAllowed("/prima", perms)) items.push(...PRIMA_SCREENS.map((s) => ({ ref: `/prima#${s.hash}`, label: t(s.label), icon: ShieldCheckIcon })));
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;
  }, [perms, q, t]);
  const pinned = new Set(pins.filter((p) => p.kind === "route").map((p) => p.ref));
  const where = folder === NONE ? null : folder;
  const add = useMutation({
    mutationFn: (v: { kind: PinKind; ref: string; title: string }) => pinItem(v.kind, v.ref, v.title, where),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      toast.success(t("Pinned to your workspace."));
      if (p.kind === "link" || mode === "link") {
        setUrl("");
        setName("");
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** A link to this site becomes a page pin (opens in place); any other site is a web link. */
  const addLink = () => {
    let u: URL;
    try {
      u = new URL(url.trim().match(/^[a-z][a-z0-9+.-]*:/i) ? url.trim() : `https://${url.trim()}`);
    } catch {
      toast.error(t("That is not a web address."));
      return;
    }
    if (u.origin === window.location.origin) add.mutate({ kind: "route", ref: `${u.pathname}${u.search}${u.hash}`, title: name.trim() || u.pathname });
    else add.mutate({ kind: "link", ref: u.href, title: name.trim() || u.hostname });
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Pin to my desk")}
      description={t("To pin a task, file, document, agent or report, press the pin next to it. On any page, Ctrl K then Pin this page.")}
      className="w-[min(94vw,36rem)]">
      <div className="grid gap-4">
        <Segmented label={t("What to pin")} value={mode} onChange={setMode}
          options={[{ value: "page", label: t("A page") }, { value: "link", label: t("A web link") }]} />
        {folders.length ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Into folder")}</span>
            <Select label={t("Into folder")} value={folder} onValueChange={setFolder}
              options={[{ value: NONE, label: t("No folder") }, ...folders.map((f) => ({ value: f, label: f }))]} />
          </div>
        ) : null}
        {mode === "page" ? (
          <div className="grid gap-2">
            <SearchInput value={q} onChange={setQ} placeholder={t("Find a page")} />
            <ul className="grid max-h-[46dvh] gap-1 overflow-y-auto overscroll-contain">
              {pages.map((p) => {
                const done = pinned.has(p.ref);
                return (
                  <li key={p.ref}>
                    <button type="button" disabled={done || add.isPending} onClick={() => add.mutate({ kind: "route", ref: p.ref, title: p.label })}
                      className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-sm px-2.5 text-left text-[13.5px] hover:bg-surface-2 disabled:opacity-60">
                      <p.icon size={18} weight="duotone" className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">{p.label}</span>
                      {done ? <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-accent"><CheckCircleIcon size={14} weight="fill" /> {t("Pinned")}</span> : <PushPinIcon size={15} className="shrink-0 text-muted" />}
                    </button>
                  </li>
                );
              })}
              {!pages.length ? <li className="px-2.5 py-3 text-[13px] text-muted">{t("No page has that name.")}</li> : null}
            </ul>
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (url.trim()) addLink(); }}>
            <Field label={t("Web address")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" autoComplete="off"
              hint={t("A page of this office or Prima opens in place; any other site opens in a new tab.")} />
            <Field label={t("Name on your desk")} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. ePerolehan")} />
            <div className="flex justify-end">
              <Button type="submit" disabled={!url.trim()} loading={add.isPending}><PushPinIcon size={15} /> {t("Pin it")}</Button>
            </div>
          </form>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- recent

function Recent({ desk, onTab }: { desk: Desk; onTab: (tab: DeskTab) => void }) {
  const t = useT();
  const navigate = useNavigate();
  type Row = { key: string; kind: PinKind; id: string; title: string; when: string; meta: string; url: string; icon: Icon };
  const rows: Row[] = [
    ...desk.work.map((w) => ({ key: `t${w.id}`, kind: "task" as const, id: w.id, title: w.title, when: w.updated_at, meta: t("Task"), url: w.url, icon: KanbanIcon })),
    ...desk.documents.map((d) => ({ key: `d${d.id}`, kind: "document" as const, id: d.id, title: d.title, when: d.updated_at, meta: t("Document"), url: d.url, icon: FileTextIcon })),
    ...desk.files.map((f) => ({ key: `f${f.id}`, kind: "file" as const, id: f.id, title: f.title, when: f.created_at, meta: t("File"), url: f.url, icon: FilesIcon })),
  ]
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .slice(0, 6);
  return (
    <section aria-label={t("Recent")}>
      <SectionHead id="recent" actions={<Button size="sm" variant="ghost" onClick={() => onTab("files")}>{t("My files")} <ArrowRightIcon size={14} /></Button>} />
      <Card className="min-w-0 overflow-hidden">
        {rows.length ? (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key} className="flex min-w-0 items-center gap-1 pr-2">
                <button type="button" onClick={() => void navigate({ href: r.url })} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 sm:px-5">
                  <r.icon size={18} weight="duotone" className="shrink-0 text-muted" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-[14px] font-medium">{r.title}</span>
                    <span className="truncate text-[12.5px] text-muted">{r.meta} · {timeAgo(r.when)}</span>
                  </span>
                </button>
                <PinButton kind={r.kind} refId={r.id} title={r.title} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-[13.5px] text-muted sm:px-5">{t("What you and your AI work on shows up here.")}</p>
        )}
        {desk.recent_searches.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border px-4 py-3 sm:px-5">
            <span className="mr-1 text-[12px] text-muted">{t("Recent searches")}</span>
            {desk.recent_searches.map((q) => (
              <span key={q} className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-surface pr-1 text-[12.5px]">
                <Link to="/search" search={{ q }} className="truncate py-1 pl-3 hover:text-accent">{q}</Link>
                <PinButton kind="search" refId={q} title={q} className="size-6" />
              </span>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------- my AI, go to

function MyAi({ desk }: { desk: Desk }) {
  const t = useT();
  const mainAgent = desk.agents.find((a) => a.is_twin && a.status === "active") ?? desk.agents.find((a) => a.status === "active");
  const me = useQuery(meQuery);
  if (!desk.can_ask) return null;
  return (
    <section aria-label={t("My AI")} className="grid min-w-0 gap-3">
      <SectionHead id="ai" />
      {mainAgent ? (
        <GiveTaskPanel agent={mainAgent} guide="desk.give" title={mainAgent.is_twin ? t("Give my AI a task") : undefined} />
      ) : (
        <Card className="flex flex-wrap items-center gap-3 px-4 py-4 text-[13.5px] text-muted sm:px-5">
          <SparkleIcon size={20} weight="duotone" className="text-accent" />
          <span className="min-w-0 flex-1">{t("You have no AI worker yet.")}</span>
          {me.data?.permissions.includes("agents.own") ? <Button size="sm" asChild><Link to="/my-worker">{t("Hire one")}</Link></Button> : null}
        </Card>
      )}
      <AllowanceMeter />
    </section>
  );
}

function GoTo({ desk, onTab }: { desk: Desk; onTab: (tab: DeskTab) => void }) {
  return (
    <section>
      <SectionHead id="goto" />
      <DeskShortcuts desk={desk} onTab={onTab} />
    </section>
  );
}

// ---------------------------------------------------------------- customize

function CustomizeDialog({ open, onOpenChange, layout }: { open: boolean; onOpenChange: (o: boolean) => void; layout: DeskLayout }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (sections: DeskLayout["sections"]) => saveLayout({ sections }),
    onMutate: (sections) => qc.setQueryData<Desk>(deskKeys.desk, (d) => (d ? { ...d, layout: { ...layoutOf(d), sections } } : d)),
    onSettled: () => void qc.invalidateQueries({ queryKey: deskKeys.desk }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = layout.sections;
  const set = (next: DeskLayout["sections"]) => save.mutate(next);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Customize my desk")}
      description={t("Show what you use, hide the rest, and put the most important first. Kept for you on every device.")}
      footer={<Button variant="ghost" onClick={() => set([...list].sort((a, b) => DESK_ORDER(a.id) - DESK_ORDER(b.id)).map((s) => ({ ...s, hidden: false })))}>{t("Back to the first layout")}</Button>}>
      <ol className="grid gap-2">
        {list.map((s, i) => {
          const txt = SECTION_TEXT[s.id];
          return (
            <li key={s.id} className={cn("flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2.5", s.hidden && "bg-surface-2/50")}>
              <txt.icon size={18} weight="duotone" className={cn("shrink-0", s.hidden ? "text-muted" : "text-accent")} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={cn("truncate text-[14px] font-medium", s.hidden && "text-muted")}>{t(txt.title)}</span>
                <span className="line-clamp-2 text-[12px] text-muted">{t(txt.hint)}</span>
              </span>
              <Button size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t("Move {name} up", { name: t(txt.title) })} onClick={() => set(arrayMove(list, i, i - 1))}><ArrowUpIcon size={15} /></Button>
              <Button size="icon-sm" variant="ghost" disabled={i === list.length - 1} aria-label={t("Move {name} down", { name: t(txt.title) })} onClick={() => set(arrayMove(list, i, i + 1))}><ArrowDownIcon size={15} /></Button>
              <label className="hit relative inline-flex shrink-0 cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" checked={!s.hidden} aria-label={t("Show {name}", { name: t(txt.title) })}
                  onChange={(e) => set(list.map((x) => (x.id === s.id ? { ...x, hidden: !e.target.checked } : x)))} />
                <span aria-hidden className="h-6 w-10 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-3 peer-focus-visible:ring-accent/30" />
                <span aria-hidden className="absolute left-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </label>
            </li>
          );
        })}
      </ol>
    </ResponsiveDialog>
  );
}

const DESK_ORDER = (id: DeskSectionId) => ["today", "pinned", "recent", "ai", "howto", "goto"].indexOf(id);

/** "Good morning" and so on, by the person's own clock. */
export function greeting(hour: number): string {
  return hour < 12 ? msg("Good morning, {name}") : hour < 18 ? msg("Good afternoon, {name}") : msg("Good evening, {name}");
}

/** P97: work a manager or colleague gave this person, shown only when there is some. */
function AssignedToMe() {
  const { data } = useQuery(assignedTasksQuery);
  if (!Array.isArray(data?.items) || !data.items.length) return null;
  return <MyAssignedTasks className="mb-4" />;
}
