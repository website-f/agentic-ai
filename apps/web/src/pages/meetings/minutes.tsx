/** Meetings > People meetings: upload a recording of a real meeting and get minutes.
 * Pipeline (worker): extract audio -> transcribe in parts -> write minutes -> library. */
import {
  ArrowClockwiseIcon, BooksIcon, CheckCircleIcon, CheckIcon, CircleNotchIcon, ClockIcon, DotsThreeIcon, FileDocIcon,
  FilePdfIcon, GearSixIcon, KanbanIcon, ListChecksIcon, MicrophoneIcon, NotePencilIcon, PauseIcon, PlayIcon, SparkleIcon,
  SpeakerSlashIcon, TranslateIcon, TrashIcon, UploadSimpleIcon, UsersThreeIcon, WarningCircleIcon, WaveformIcon, XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { parseScope, scopeOptions, ScopeSelect, WHOLE } from "@/components/library-toggle";
import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Section, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, t, useLang, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fileSize } from "@/lib/documents";
import {
  ACCEPT, audioUrl, clock, duration, isActive, isRecording, minutesExportUrl, minutesKeys, minutesListQuery, minutesQuery,
  minutesSettingsQuery, speakerClipUrl, speakerColor, speakerNumber, stageOf, uploadRecording, type ActionItem,
  type MinutesLanguage, type Recording, type RecordingDetail, type Speaker, type Stage,
} from "@/lib/minutes";
import { branchesQuery, meQuery, membersQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

const LANGS: { value: MinutesLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ms", label: "Bahasa Melayu" },
];

const STATUS: Record<Recording["status"], { label: string; tone: "accent" | "ok" | "danger" | "info" | "neutral"; icon: Icon; tile: Tone }> = {
  uploading: { label: msg("Uploading"), tone: "info", icon: UploadSimpleIcon, tile: "info" },
  queued: { label: msg("Queued"), tone: "neutral", icon: ClockIcon, tile: "neutral" },
  extracting: { label: msg("Extracting audio"), tone: "info", icon: WaveformIcon, tile: "info" },
  transcribing: { label: msg("Transcribing"), tone: "info", icon: MicrophoneIcon, tile: "info" },
  writing: { label: msg("Writing minutes"), tone: "accent", icon: NotePencilIcon, tile: "accent" },
  ready: { label: msg("Ready"), tone: "ok", icon: CheckCircleIcon, tile: "ok" },
  failed: { label: msg("Failed"), tone: "danger", icon: WarningCircleIcon, tile: "danger" },
};

function statusLabel(r: Recording): string {
  if (r.status === "transcribing" && r.chunks_total) return t("Transcribing {done}/{total}", { done: Math.min(r.chunks_done + 1, r.chunks_total), total: r.chunks_total });
  if (r.status === "extracting" && r.speakers_total) return t("Separating speakers…");
  return t(STATUS[r.status].label);
}

/** "Aisyah", or "Speaker 2" until someone names the voice. */
function speakerName(label: string, sp?: Pick<Speaker, "name">): string {
  return sp?.name || t("Speaker {n}", { n: speakerNumber(label) });
}

function SpeakerDot({ label, className }: { label: string; className?: string }) {
  return <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", className)} style={{ background: speakerColor(label) }} />;
}

function SpeakerChip({ label, name }: { label: string; name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[12px] font-medium">
      <SpeakerDot label={label} className="size-2" />
      <span className="truncate">{name}</span>
    </span>
  );
}

const SPEAKER_COUNTS = ["auto", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, id?: string) {
  qc.invalidateQueries({ queryKey: minutesKeys.list });
  if (id) qc.invalidateQueries({ queryKey: minutesKeys.one(id) });
}

// ---------------------------------------------------------------- upload

interface Job {
  name: string;
  size: number;
  progress: number;
  controller: AbortController;
}

function UploadCard({ onUploaded }: { onUploaded: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: limits } = useQuery(minutesSettingsQuery);
  const options = scopeOptions(me, branches);
  const [picked, setPicked] = useState<string | null>(null);
  const scope = picked && options.some((o) => o.value === picked) ? picked : (options[0]?.value ?? WHOLE);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<MinutesLanguage>("en");
  const [separate, setSeparate] = useState(true);
  const [people, setPeople] = useState<string>("auto");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const maxMb = limits?.max_upload_mb ?? 1024;
  const maxLabel = maxMb >= 1024 ? `${Math.round(maxMb / 1024)} GB` : `${maxMb} MB`;

  const start = async (file: File) => {
    setError(null);
    if (!isRecording(file)) return setError(t("{name} is not an audio or video recording.", { name: file.name }));
    if (file.size > maxMb * 1024 * 1024) return setError(t("{name} is {size}; recordings can be up to {max}.", { name: file.name, size: fileSize(file.size), max: maxLabel }));
    const controller = new AbortController();
    setJob({ name: file.name, size: file.size, progress: 0, controller });
    try {
      const params = { title, language, speakers: separate, speaker_count: people === "auto" ? null : Number(people), ...parseScope(scope, branches) };
      const rec = await uploadRecording(file, params, (p) => setJob((j) => (j ? { ...j, progress: p } : j)), controller.signal);
      toast.success(t("Uploaded. The minutes are being prepared; you can leave this page."));
      setTitle("");
      invalidate(qc);
      onUploaded(rec.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "aborted")) setError(errorMessage(e));
    } finally {
      setJob(null);
      if (input.current) input.current.value = "";
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !job) void start(f);
  };
  const pct = job ? Math.round(job.progress * 100) : 0;

  return (
    <Card data-guide="minutes.upload">
      <CardHeader icon={<IconTile icon={MicrophoneIcon} size="sm" />} title={t("Upload a recording")}
        description={t("A voice or video recording of a meeting. You get a transcript with timestamps and minutes you can edit, export and turn into tasks.")} />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label={t("Title (optional)")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("e.g. Monthly management meeting")} disabled={!!job} />
          <label className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-medium">{t("Who it is for")}</span>
            <ScopeSelect value={scope} onChange={setPicked} className="w-full" />
          </label>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Write the minutes in")}</span>
          <Segmented label={t("Minutes language")} value={language} onChange={setLanguage} options={LANGS.map((l) => ({ ...l, label: t(l.label) }))} className="w-fit" />
          <span className="text-[12.5px] text-muted">{t("The meeting itself can be in English, Malay or both.")}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] md:items-center">
          <SwitchField checked={separate} onCheckedChange={setSeparate} disabled={!!job} label={t("Separate speakers")}
            hint={t("Tells the voices apart on this server, so the minutes say who said what. Nothing is sent anywhere else for this.")} />
          {separate ? (
            <label className="grid min-w-0 gap-1">
              <span className="text-[12px] text-muted">{t("How many people talk")}</span>
              <Select value={people} onValueChange={setPeople} label={t("How many people talk")} disabled={!!job} className="w-full"
                options={SPEAKER_COUNTS.map((n) => ({ value: n, label: n === "auto" ? t("Find out (auto)") : t("{n} people", { n }) }))} />
            </label>
          ) : null}
        </div>
        {job ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-4" role="status" aria-live="polite">
            <div className="flex min-w-0 items-center gap-3">
              <IconTile icon={UploadSimpleIcon} tone="accent" size="sm" />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-[13.5px] font-medium">{job.name}</span>
                <span className="text-[12.5px] text-muted tabular">{pct < 100 ? t("{pct}% of {size} · keep this tab open until it finishes", { pct, size: fileSize(job.size) }) : t("Uploaded. Starting…")}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => job.controller.abort()}><XIcon size={14} /> {t("Cancel")}</Button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <label
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            className={cn(
              "grid cursor-pointer place-items-center gap-2 rounded-[var(--radius-md)] border border-dashed px-4 py-7 text-center transition-colors",
              over ? "border-accent bg-accent-soft/50" : "border-border bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2/70",
            )}
          >
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); }} />
            <IconTile icon={UploadSimpleIcon} tone="accent" />
            <span className="text-[14px] font-medium">{t("Drop a recording here, or tap to choose")}</span>
            <span className="max-w-[52ch] text-[12.5px] text-muted">
              {t("mp3, m4a, wav, ogg, webm, mp4, mov · up to {max} and {hours} hours", { max: maxLabel, hours: limits?.max_hours ?? 4 })}
            </span>
          </label>
        )}
        <FormError message={error} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- progress

const STEPS: { key: Stage; label: string }[] = [
  { key: "upload", label: msg("Uploaded") },
  { key: "extract", label: msg("Extracting audio") },
  { key: "speakers", label: msg("Separating speakers…") },
  { key: "transcribe", label: msg("Transcribing") },
  { key: "write", label: msg("Writing minutes") },
  { key: "ready", label: msg("Ready") },
];

export function Timeline({ r }: { r: Recording }) {
  const t = useT();
  const failed = r.status === "failed";
  const steps = r.separate_speakers ? STEPS : STEPS.filter((s) => s.key !== "speakers");
  const index = (k: Stage) => steps.findIndex((s) => s.key === k);
  // A failed recording: no length yet = stopped reading the file; parts left = while hearing.
  const at = failed ? index(!r.duration_seconds ? "extract" : r.chunks_total && r.chunks_done < r.chunks_total ? "transcribe" : "write") : index(stageOf(r));
  return (
    <ol aria-label={t("Progress")} className="grid grid-cols-[minmax(0,1fr)] gap-0">
      {steps.map((s, i) => {
        const done = i < at || r.status === "ready";
        const current = !failed && i === at && r.status !== "ready";
        const broke = failed && i === at;
        const label = s.key === "transcribe" && r.chunks_total ? t("Transcribing {done}/{total}", { done: Math.min(r.chunks_done + (current ? 1 : 0), r.chunks_total), total: r.chunks_total }) : t(s.label);
        const bar = current && s.key === "transcribe" && r.chunks_total ? r.chunks_done / r.chunks_total : current && s.key === "speakers" && r.speakers_total ? r.speakers_done / r.speakers_total : null;
        return (
          <li key={s.key} className="relative flex min-w-0 gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 ? <span aria-hidden className={cn("absolute top-6 bottom-0 left-[11px] w-px", done ? "bg-ok/50" : "bg-border")} /> : null}
            <span className={cn("relative z-[1] grid size-6 shrink-0 place-items-center rounded-full border",
              done ? "border-ok/40 bg-ok/12 text-ok" : broke ? "border-danger/40 bg-danger/10 text-danger" : current ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface text-muted")}>
              {done ? <CheckIcon size={12} weight="bold" /> : broke ? <XIcon size={12} weight="bold" /> : current ? <CircleNotchIcon size={13} weight="bold" className="motion-safe:animate-spin" /> : <span className="size-1.5 rounded-full bg-current opacity-50" />}
            </span>
            <span className="grid min-w-0 gap-1 pt-0.5">
              <span className={cn("text-[13.5px]", current ? "font-semibold" : broke ? "font-semibold text-danger" : done ? "font-medium" : "text-muted")}>{broke ? t("{label}: stopped here", { label }) : label}</span>
              {bar !== null ? (
                <span className="block h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${bar * 100}%` }} />
                </span>
              ) : null}
              {current && s.key === "speakers" ? <span className="text-[12.5px] text-muted">{t("Telling the voices apart on this server. About a minute for every 10 minutes of audio.")}</span> : null}
              {current && r.stage_detail ? <span className="text-[12.5px] text-muted">{r.stage_detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- minutes text

/** "Rewrite with names": the minutes written again from the saved transcript with the speakers'
 * names; the current minutes stay as a document version. Asks first when tasks exist. */
function RewriteWithNames({ r, size = "sm" }: { r: RecordingDetail; size?: "sm" | "md" }) {
  const t = useT();
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const go = useMutation({
    mutationFn: () => api<RecordingDetail>(`/api/minutes/${r.id}/rewrite`, "POST", { language: r.language }),
    onSuccess: (d) => { qc.setQueryData(minutesKeys.one(r.id), d); invalidate(qc, r.id); toast.success(t("Writing the minutes again with the names.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const tasks = r.action_items.some((a) => a.task_id);
  return (
    <>
      <Button size={size} loading={go.isPending} onClick={() => (tasks ? setAsk(true) : go.mutate())}><SparkleIcon size={14} /> {t("Rewrite with names")}</Button>
      <ConfirmDialog open={ask} onOpenChange={setAsk} title={t("Rewrite the minutes with the names?")}
        body={t("The minutes and their action items are written again. Tasks already made stay on the board; the current minutes stay as an earlier version.")}
        confirmLabel={t("Rewrite")} onConfirm={() => go.mutate()} />
    </>
  );
}

function SpeakerNotes({ r, onSpeakers }: { r: RecordingDetail; onSpeakers: () => void }) {
  const t = useT();
  if (!r.can_edit || !r.speakers.length) return null;
  const unnamed = r.speakers.filter((s) => !s.name).length;
  if (r.speakers_stale) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px]">
        <span className="min-w-0">{t("The speaker names changed after these minutes were written.")}</span>
        <RewriteWithNames r={r} />
      </div>
    );
  }
  if (!unnamed) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-info/30 bg-info/8 px-3 py-2 text-[13px]">
      <span className="min-w-0">{unnamed === r.speakers.length ? t("{n} speakers found. Name them so the minutes say who said what.", { n: r.speakers.length }) : t("{n} speakers still have no name.", { n: unnamed })}</span>
      <Button size="sm" variant="outline" onClick={onSpeakers}><UsersThreeIcon size={14} /> {t("Name speakers")}</Button>
    </div>
  );
}

function MinutesText({ r, onSpeakers }: { r: RecordingDetail; onSpeakers: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const locked = r.document_status === "approved";
  const save = useMutation({
    mutationFn: (body: string) => api<RecordingDetail>(`/api/minutes/${r.id}/markdown`, "PUT", { body }),
    onSuccess: (d) => { qc.setQueryData(minutesKeys.one(r.id), d); setDraft(null); toast.success(t("Minutes saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const publish = useMutation({
    mutationFn: () => api<RecordingDetail>(`/api/minutes/${r.id}/publish`, "POST"),
    onSuccess: (d) => { qc.setQueryData(minutesKeys.one(r.id), d); invalidate(qc); toast.success(t("Published to the library. Agents can now search it.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="flex items-start gap-2 rounded-sm bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted">
        <WarningCircleIcon size={15} className="mt-px shrink-0 text-warn" />
        <span className="min-w-0">{r.speakers.length
          ? t("Speakers were told apart by their voices. Now and then a few words go to the wrong person: check names, figures and decisions before sharing.")
          : t("Speaker names are as heard in the conversation: speech-to-text does not reliably tell voices apart. Check names, figures and decisions before sharing.")}</span>
      </p>
      {draft === null ? <SpeakerNotes r={r} onSpeakers={onSpeakers} /> : null}
      {r.can_edit && r.published_stale && draft === null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-info/30 bg-info/8 px-3 py-2 text-[13px]">
          <span className="min-w-0">{r.published_at ? t("Changed since it was published to the library.") : t("Not in the library yet.")}</span>
          <Button size="sm" variant="outline" loading={publish.isPending} onClick={() => publish.mutate()}><BooksIcon size={14} /> {t("Publish to library")}</Button>
        </div>
      ) : null}
      {draft !== null ? (
        <>
          <label htmlFor="minutes-md" className="sr-only">{t("Minutes (markdown)")}</label>
          <textarea id="minutes-md" value={draft} onChange={(e) => setDraft(e.target.value)} rows={22} spellCheck
            className="min-h-[50dvh] w-full rounded-sm border border-border bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-border bg-surface pt-3 pb-1">
            <Button variant="outline" onClick={() => setDraft(null)} disabled={save.isPending}>{t("Cancel")}</Button>
            <Button loading={save.isPending} disabled={draft === r.markdown} onClick={() => save.mutate(draft)}><CheckIcon size={15} /> {t("Save minutes")}</Button>
          </div>
        </>
      ) : (
        <>
          {r.can_edit ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={locked} onClick={() => setDraft(r.markdown)}><NotePencilIcon size={14} /> {t("Edit")}</Button>
              {r.document_id ? <Button size="sm" variant="ghost" asChild><Link to="/documents" search={{ d: r.document_id }}>{t("Open in Documents")}</Link></Button> : null}
              {locked ? <span className="self-center text-[12.5px] text-muted">{t("Approved in Documents: reopen it there to edit.")}</span> : null}
            </div>
          ) : null}
          <div className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-4 sm:px-6">
            <Markdown>{r.markdown}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- action items

function ActionRow({ r, a }: { r: RecordingDetail; a: ActionItem }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const mine = agents.filter((x) => x.status === "active");
  const [owner, setOwner] = useState(a.owner);
  const [due, setDue] = useState(a.due_date);
  const [agent, setAgent] = useState("person");
  const done = (d: RecordingDetail) => { qc.setQueryData(minutesKeys.one(r.id), d); invalidate(qc); };
  const edit = useMutation({
    mutationFn: (body: { owner?: string; due_date?: string }) => api<RecordingDetail>(`/api/minutes/${r.id}/actions/${a.index}`, "PATCH", body),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const task = useMutation({
    mutationFn: () => api<RecordingDetail>(`/api/minutes/${r.id}/actions/${a.index}/task`, "POST", {
      agent_id: agent === "person" ? null : agent, owner, due_date: due || null,
    }),
    onSuccess: (d) => { done(d); toast.success(t("Task created.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveOwner = () => { if (owner.trim() !== a.owner) edit.mutate({ owner: owner.trim() }); };
  const saveDue = (v: string) => { setDue(v); if (v !== a.due_date) edit.mutate({ due_date: v }); };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={a.task_id ? CheckCircleIcon : ListChecksIcon} tone={a.task_id ? "ok" : "neutral"} size="sm" />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="text-[14px] font-medium break-words">{a.what}</p>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-muted">
            <Meta items={[a.owner ? t("Named: {name}", { name: a.owner }) : t("No owner named"), a.due ? t("Said: {due}", { due: a.due }) : null]} />
          </span>
        </div>
        {a.task_id ? <Button size="sm" variant="ghost" asChild><Link to="/tasks" search={{ task: a.task_id }}><KanbanIcon size={14} /> {t("Task")}</Link></Button> : null}
      </div>
      {a.task_id ? (
        <p className="pl-11 text-[12.5px] text-muted max-sm:pl-0">{a.due_date ? t("Owner {name} · due {date}", { name: a.owner_label || t("not set"), date: a.due_date }) : t("Owner {name}", { name: a.owner_label || t("not set") })}</p>
      ) : r.can_edit ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pl-11 max-sm:pl-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] sm:items-end">
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">{t("Owner")}</span>
            <Select value={agent} onValueChange={setAgent} label={t("Who does it")} className="w-full" options={[
              { value: "person", label: owner.trim() ? t("{name} (person)", { name: owner.trim() }) : t("A person") },
              ...mine.map((x) => ({ value: x.id, label: t("{name} (agent)", { name: x.name }) })),
            ]} />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">{t("Person's name")}</span>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={saveOwner} placeholder={t("As named")} className="h-10" maxLength={120} />
          </label>
          <label className="grid min-w-0 gap-1">
            <span className="text-[12px] text-muted">{t("Due")}</span>
            <Input type="date" value={due} onChange={(e) => saveDue(e.target.value)} className="h-10" />
          </label>
          <Button loading={task.isPending} onClick={() => task.mutate()}><KanbanIcon size={15} /> {t("Create task")}</Button>
        </div>
      ) : null}
    </li>
  );
}

function ActionItems({ r }: { r: RecordingDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const open = r.action_items.filter((a) => !a.task_id).length;
  const all = useMutation({
    mutationFn: () => api<RecordingDetail>(`/api/minutes/${r.id}/actions/tasks`, "POST"),
    onSuccess: (d) => { qc.setQueryData(minutesKeys.one(r.id), d); invalidate(qc); toast.success(t("Tasks created.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!r.action_items.length) {
    return <EmptyState icon={ListChecksIcon} title={t("No action items")} body={t("Nobody was given a task in this meeting, or the minutes did not pick one up. Add them in the minutes text if needed.")} />;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] text-muted">
          {open ? t("{n} without a task. A person's task waits in triage with their name on it; an agent's is ready to work on.", { n: open }) : t("Every action item has a task.")}
        </p>
        {r.can_edit && open > 1 ? <Button size="sm" loading={all.isPending} onClick={() => all.mutate()}><KanbanIcon size={14} /> {t("Create all {n} tasks", { n: open })}</Button> : null}
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        {r.action_items.map((a) => <ActionRow key={`${a.index}-${a.task_id ?? ""}`} r={r} a={a} />)}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- speakers

function SpeakerRow({ r, s, name, onName, names, playing, onPlay }: {
  r: RecordingDetail; s: Speaker; name: string; onName: (v: string) => void; names: string; playing: boolean; onPlay: () => void;
}) {
  const t = useT();
  const pct = Math.round(s.share * 100);
  const showSuggestion = r.can_edit && s.suggested && !name.trim();
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] md:items-start">
      <div className="flex min-w-0 items-center gap-3">
        {s.has_clip ? (
          <button type="button" onClick={onPlay} aria-pressed={playing}
            aria-label={playing ? t("Stop the clip of {name}", { name: speakerName(s.label, s) }) : t("Play a clip of {name}", { name: speakerName(s.label, s) })}
            className="grid size-10 shrink-0 place-items-center rounded-full border-2 bg-surface transition-colors hover:bg-surface-2" style={{ borderColor: speakerColor(s.label) }}>
            {playing ? <PauseIcon size={15} weight="fill" /> : <PlayIcon size={15} weight="fill" />}
          </button>
        ) : <span className="grid size-10 shrink-0 place-items-center"><SpeakerDot label={s.label} className="size-3.5" /></span>}
        <div className="grid min-w-0 flex-1 gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">{speakerName(s.label, s)}</span>
            {s.name ? <span className="shrink-0 text-[12px] text-muted">{t("Speaker {n}", { n: speakerNumber(s.label) })}</span> : null}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: speakerColor(s.label) }} />
            </span>
            <span className="shrink-0 text-[12px] text-muted tabular">{t("{time} · {pct}%", { time: duration(s.seconds) || "0 s", pct })}</span>
          </span>
        </div>
      </div>
      {r.can_edit ? (
        <div className="grid min-w-0 gap-1.5">
          <label className="grid min-w-0 gap-1">
            <span className="sr-only">{t("Name of {speaker}", { speaker: t("Speaker {n}", { n: speakerNumber(s.label) }) })}</span>
            <Input value={name} onChange={(e) => onName(e.target.value)} list={names} maxLength={80} placeholder={t("Name, or pick from the list")} autoComplete="off" />
          </label>
          {showSuggestion ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-sm bg-accent-soft/50 px-2.5 py-1.5 text-[12.5px]">
              <SparkleIcon size={13} className="shrink-0 text-accent" />
              <span className="min-w-0 font-medium">{t("Suggested: {name}", { name: s.suggested })}</span>
              <button type="button" onClick={() => onName(s.suggested)} className="ml-auto rounded-sm px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft pointer-coarse:py-1.5">{t("Use")}</button>
              {s.evidence ? <span className="w-full min-w-0 break-words text-muted">{t("Heard: {quote}", { quote: s.evidence })}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Speakers({ r }: { r: RecordingDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({ ...membersQuery, retry: false });
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(r.speakers.map((s) => [s.label, s.name])));
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const listId = useId();
  const dirty = r.speakers.some((s) => (names[s.label] ?? "").trim() !== s.name);
  const save = useMutation({
    mutationFn: () => api<RecordingDetail>(`/api/minutes/${r.id}/speakers`, "PUT", { names: Object.fromEntries(r.speakers.map((s) => [s.label, (names[s.label] ?? "").trim()])) }),
    onSuccess: (d) => { qc.setQueryData(minutesKeys.one(r.id), d); toast.success(t("Speaker names saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const choices = [...new Set([...(r.minutes?.attendees ?? []), ...members.filter((m) => m.is_active).map((m) => m.name)].filter(Boolean))];
  const play = (label: string) => {
    const el = player.current;
    if (!el) return;
    if (playing === label) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = speakerClipUrl(r.id, label);
    setPlaying(label);
    void el.play().catch(() => { setPlaying(null); toast.error(t("Could not play that clip.")); });
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="text-[13px] text-muted">
        {r.audio_available
          ? t("{n} voices were told apart. Play a short clip to hear who it is, then name them. Names are used in the minutes after Rewrite with names.", { n: r.speakers.length })
          : t("{n} voices were told apart. The audio is no longer kept, so clips can't be played; you can still name them from the transcript.", { n: r.speakers.length })}
      </p>
      {r.speakers_stale && r.can_edit && !dirty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px]">
          <span className="min-w-0">{t("The speaker names changed after these minutes were written.")}</span>
          <RewriteWithNames r={r} />
        </div>
      ) : null}
      <audio ref={player} preload="none" onEnded={() => setPlaying(null)} className="hidden" />
      <datalist id={listId}>{choices.map((n) => <option key={n} value={n} />)}</datalist>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        {r.speakers.map((s) => (
          <SpeakerRow key={s.label} r={r} s={s} name={names[s.label] ?? ""} names={listId} playing={playing === s.label}
            onName={(v) => setNames((n) => ({ ...n, [s.label]: v }))} onPlay={() => play(s.label)} />
        ))}
      </ul>
      {r.can_edit ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty ? <Button variant="ghost" onClick={() => setNames(Object.fromEntries(r.speakers.map((s) => [s.label, s.name])))} disabled={save.isPending}>{t("Undo changes")}</Button> : null}
          <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}><CheckIcon size={15} /> {t("Save names")}</Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- transcript

function Transcript({ r }: { r: RecordingDetail }) {
  const t = useT();
  const player = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [q, setQ] = useState("");
  const [who, setWho] = useState("all");
  const byLabel = new Map(r.speakers.map((s) => [s.label, s]));
  const labelled = r.speakers.length > 0;
  const needle = q.trim().toLowerCase();
  const shown = r.transcript.filter((p) => (!needle || p.text.toLowerCase().includes(needle)) && (who === "all" || p.s === who));
  const play = (at: number) => {
    const el = player.current;
    if (!el) return;
    el.currentTime = at;
    void el.play().catch(() => undefined);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {r.audio_available ? (
        <div className="sticky top-0 z-[2] -mx-1 grid gap-1 bg-surface px-1 pb-2">
          <audio ref={player} controls preload="metadata" src={audioUrl(r.id)} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} className="h-10 w-full" />
          {r.audio_expires_at ? <span className="text-[12px] text-muted">{t("Audio kept until {date}, then deleted. The transcript stays.", { date: new Date(r.audio_expires_at).toLocaleDateString(locale()) })}</span> : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-sm bg-surface-2/60 px-3 py-2 text-[12.5px] text-muted"><SpeakerSlashIcon size={15} className="shrink-0" /> {t("The audio is no longer kept; the transcript stays.")}</p>
      )}
      <SearchInput value={q} onChange={setQ} placeholder={t("Search the transcript")} label={t("Search the transcript")} />
      {labelled ? (
        <Segmented size="sm" label={t("Show who")} value={who} onChange={setWho} options={[
          { value: "all", label: t("Everyone") },
          ...r.speakers.map((s) => ({ value: s.label, label: speakerName(s.label, s) })),
        ]} />
      ) : null}
      <p className="text-[12.5px] text-muted">{r.audio_available ? `${t("Tap a time to hear that moment.")} ` : null}{labelled ? t("Speakers are told apart by voice; name them in the Speakers tab.") : t("No speaker labels: speech-to-text does not tell voices apart.")}</p>
      {shown.length ? (
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {shown.map((p) => {
            const live = r.audio_available && now >= p.t && now < p.e;
            return (
              <li key={p.t} className={cn("flex min-w-0 gap-3 rounded-sm px-2 py-2", live && "bg-accent-soft/60")}
                style={p.s ? { boxShadow: `inset 3px 0 0 ${speakerColor(p.s)}` } : undefined}>
                {r.audio_available ? (
                  <button type="button" onClick={() => play(p.t)} aria-label={t("Play from {time}", { time: clock(p.t) })}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-border px-2 font-mono text-[12px] text-muted tabular transition-colors hover:border-accent/50 hover:text-accent pointer-coarse:h-9">
                    <PlayIcon size={11} weight="fill" /> {clock(p.t)}
                  </button>
                ) : <span className="w-12 shrink-0 pt-0.5 font-mono text-[12px] text-muted tabular">{clock(p.t)}</span>}
                <div className="grid min-w-0 flex-1 gap-1 pt-1">
                  {p.s ? <span><SpeakerChip label={p.s} name={speakerName(p.s, byLabel.get(p.s))} /></span> : null}
                  <p className="min-w-0 text-[14px] leading-relaxed break-words">{p.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="py-6 text-center text-[13px] text-muted">{needle ? t("Nothing in the transcript matches.") : t("No transcript yet.")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- the sheet

type Tab = "minutes" | "actions" | "transcript" | "speakers";

function MinutesSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const { data: r, isLoading, error } = useQuery(minutesQuery(id));
  const [tab, setTab] = useState<Tab>("minutes");
  const [confirm, setConfirm] = useState<"delete" | "audio" | null>(null);
  const act = useMutation({
    mutationFn: (v: { path: string; body?: unknown; ok: string }) => api<RecordingDetail>(`/api/minutes/${id}${v.path}`, "POST", v.body ?? {}),
    onSuccess: (d, v) => { qc.setQueryData(minutesKeys.one(id), d); invalidate(qc); toast.success(v.ok); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async () => {
    try {
      await api(`/api/minutes/${id}`, "DELETE");
      invalidate(qc);
      toast.success(t("Deleted."));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const dropAudio = async () => {
    try {
      const d = await api<RecordingDetail>(`/api/minutes/${id}/audio`, "DELETE");
      qc.setQueryData(minutesKeys.one(id), d);
      toast.success(t("Audio deleted. The transcript and minutes stay."));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const ready = r?.status === "ready";
  const other: MinutesLanguage = r?.language === "ms" ? "en" : "ms";

  const actions = r ? (
    <>
      {ready ? (
        <>
          <Button size="sm" variant="outline" asChild><a href={minutesExportUrl(r.id, "pdf")}><FilePdfIcon size={14} /> PDF</a></Button>
          <Button size="sm" variant="outline" asChild><a href={minutesExportUrl(r.id, "docx")}><FileDocIcon size={14} /> Word</a></Button>
          {r.can_edit ? <Button size="sm" variant="outline" loading={act.isPending && act.variables?.path === "/publish"} onClick={() => act.mutate({ path: "/publish", ok: t("Published to the library.") })}><BooksIcon size={14} /> {r.published_at ? t("Republish") : t("Publish to library")}</Button> : null}
        </>
      ) : null}
      {r.status === "failed" && r.can_edit ? <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "/retry", ok: t("Trying again.") })}><ArrowClockwiseIcon size={14} /> {t("Retry")}</Button> : null}
      {r.can_edit && !isActive(r.status) ? (
        <Menu>
          <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={t("More")}><DotsThreeIcon size={18} weight="bold" /></Button></MenuTrigger>
          <MenuContent>
            {r.transcript.length ? <MenuItem icon={<TranslateIcon />} onSelect={() => act.mutate({ path: "/rewrite", body: { language: other }, ok: t("Writing the minutes again.") })}>{t("Rewrite in {language}", { language: other === "ms" ? "Bahasa Melayu" : "English" })}</MenuItem> : null}
            {r.audio_available ? <MenuItem icon={<SpeakerSlashIcon />} onSelect={() => setConfirm("audio")}>{t("Delete the audio now")}</MenuItem> : null}
            <MenuSeparator />
            <MenuItem danger icon={<TrashIcon />} onSelect={() => setConfirm("delete")}>{t("Delete everything")}</MenuItem>
          </MenuContent>
        </Menu>
      ) : null}
    </>
  ) : undefined;

  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="xl" title={r?.title ?? t("Meeting minutes")}
      description={r ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill tone={STATUS[r.status].tone} live={isActive(r.status)}>{statusLabel(r)}</Pill>
          <Meta items={[duration(r.duration_seconds), r.scope_label, t(LANGS.find((l) => l.value === r.language)?.label ?? ""), t("by {name}", { name: r.created_by_name }), timeAgo(r.created_at)]} />
        </span>
      ) : undefined}
      actions={actions}>
      {isLoading ? <Skeleton className="h-64" /> : error || !r ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {!ready ? (
            <Card>
              <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-4">
                <Timeline r={r} />
                {r.status === "failed" ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] break-words text-danger">{r.error}</p> : (
                  <p className="text-[12.5px] text-muted">{t("An hour of talk usually takes a few minutes. You can close this and come back; it carries on in the background.")}</p>
                )}
              </CardBody>
            </Card>
          ) : (
            <>
              {r.minutes?.summary ? <p className="text-[14px] leading-relaxed break-words">{r.minutes.summary}</p> : null}
              <Segmented label={t("Minutes view")} value={tab} onChange={setTab} options={[
                // "Minutes" alone is "Minit mesyuarat"; the tab needs the short word to fit a phone.
                { value: "minutes", label: lang === "ms" ? t("Minutes (tab)") : "Minutes" },
                { value: "actions", label: t("Action items"), count: r.action_items.length },
                { value: "transcript", label: t("Transcript") },
                ...(r.speakers.length ? [{ value: "speakers" as const, label: t("Speakers"), count: r.speakers.length }] : []),
              ]} />
              {tab === "minutes" ? <MinutesText r={r} onSpeakers={() => setTab("speakers")} />
                : tab === "actions" ? <ActionItems r={r} />
                : tab === "speakers" && r.speakers.length ? <Speakers key={r.speakers.map((s) => s.name).join("|")} r={r} />
                : <Transcript r={r} />}
            </>
          )}
        </div>
      )}
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} danger title={t("Delete these minutes?")}
        body={t("The recording, transcript, minutes document and the library copy are all deleted. Tasks already made stay.")} confirmLabel={t("Delete")} onConfirm={remove} />
      <ConfirmDialog open={confirm === "audio"} onOpenChange={(o) => !o && setConfirm(null)} title={t("Delete the audio now?")}
        body={t("The transcript and minutes stay, but you can no longer play moments from the meeting.")} confirmLabel={t("Delete audio")} onConfirm={dropAudio} />
    </SideSheet>
  );
}

// ---------------------------------------------------------------- settings (admins)

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery(minutesSettingsQuery);
  const [days, setDays] = useState<string | null>(null);
  const value = days ?? String(data?.audio_days ?? 30);
  const save = useMutation({
    mutationFn: () => api("/api/minutes/settings", "PUT", { audio_days: Number(value) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: minutesKeys.settings }); toast.success(t("Saved.")); onClose(); },
  });
  const n = Number(value);
  const bad = !Number.isInteger(n) || n < 0 || n > 365;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Recording settings")}
      description={t("The uploaded file is deleted once its audio is extracted. A small audio copy is kept so the transcript can play each moment.")}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        <Button loading={save.isPending} disabled={bad} onClick={() => save.mutate()}>{t("Save")}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t("Keep the audio for (days)")} type="number" min={0} max={365} value={value} onChange={(e) => setDays(e.target.value)}
          hint={t("0 deletes it as soon as the minutes are written. Transcripts and minutes are kept.")} error={bad ? t("Pick 0 to 365 days.") : undefined} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- the tab

export function PeopleMeetings({ canWrite, rec, onOpen }: { canWrite: boolean; rec?: string; onOpen: (id: string | undefined) => void }) {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const { data = [], isLoading, error } = useQuery(minutesListQuery);
  const { data: limits } = useQuery(minutesSettingsQuery);
  const [settings, setSettings] = useState(false);
  const admin = !!me?.permissions.includes("org.manage");
  const busy = data.filter((r) => isActive(r.status)).length;
  const ready = data.filter((r) => r.status === "ready");
  const openActions = ready.reduce((n, r) => n + r.open_actions, 0);
  const decisions = ready.reduce((n, r) => n + r.decision_count, 0);

  const row = (r: Recording) => (
    <ListRow key={r.id} onClick={() => onOpen(r.id)} active={r.id === rec}
      leading={<IconTile icon={STATUS[r.status].icon} tone={STATUS[r.status].tile} size="sm" />}
      title={<span className="block whitespace-normal break-words">{r.title}</span>}
      meta={<Meta items={[duration(r.duration_seconds), r.scope_label, r.created_by_name, timeAgo(r.created_at)]} />}
      trailing={<>
        {r.status === "ready" && r.open_actions ? <Pill tone="warn">{t("{n} to assign", { n: r.open_actions })}</Pill> : null}
        <Pill tone={STATUS[r.status].tone} live={isActive(r.status)}>{statusLabel(r)}</Pill>
      </>}>
      {r.status === "ready" && r.summary ? <span className="mt-1 line-clamp-2 text-[13px] break-words text-muted">{r.summary}</span> : null}
      {r.status === "failed" && r.error ? <span className="mt-1 line-clamp-2 text-[13px] break-words text-danger">{r.error}</span> : null}
    </ListRow>
  );

  return (
    <>
      {canWrite ? <UploadCard onUploaded={(id) => onOpen(id)} /> : null}
      {isLoading ? <Skeleton className="h-40 rounded-[var(--radius-md)]" /> : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !data.length ? (
        <EmptyState icon={MicrophoneIcon} title={t("No recorded meetings yet")}
          body={t("Record the meeting on a phone or laptop (or save the Zoom, Meet or Teams recording), then upload it. Minutes are saved to the library so agents can look up past decisions.")} />
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Minutes ready")} value={ready.length} icon={CheckCircleIcon} tone="ok" hint={t("of {n} recordings", { n: data.length })} />
            <Stat label={t("Processing")} value={busy} icon={WaveformIcon} tone="info" hint={busy ? t("Being transcribed now") : t("Nothing in progress")} />
            <Stat label={t("Decisions recorded")} value={decisions} icon={BooksIcon} tone="accent" hint={t("Searchable in the library")} />
            <Stat label={t("Action items to assign")} value={openActions} icon={ListChecksIcon} tone={openActions ? "warn" : "neutral"} hint={openActions ? t("Turn them into tasks") : t("All assigned")} />
          </StatGrid>
          <Section title={t("Recorded meetings")}
            description={limits ? (limits.audio_days ? t("Audio is kept for {n} days; transcripts and minutes stay.", { n: limits.audio_days }) : t("Audio is kept only until the minutes are written; transcripts and minutes stay.")) : undefined}
            actions={admin ? <Button size="sm" variant="ghost" onClick={() => setSettings(true)}><GearSixIcon size={14} /> {t("Settings")}</Button> : undefined}>
            <ListCard data-guide="minutes.list">{data.map(row)}</ListCard>
          </Section>
        </>
      )}
      {rec ? <MinutesSheet key={rec} id={rec} onClose={() => onOpen(undefined)} /> : null}
      {settings ? <SettingsDialog onClose={() => setSettings(false)} /> : null}
    </>
  );
}
