/** Forms (P27): the company's own forms — claims, advances, monthly records, requests — in
 * one place. Everyone downloads the blank, hands back the filled one (with receipts and any
 * other files) before the deadline, or asks their AI worker to fill it in from what they say
 * and the photos they attach. Managers add ready-made forms or their own Excel, set when each
 * round opens and closes, and see who handed in, accepting or returning each one. */
import {
  ArchiveIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CloudArrowUpIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FileXlsIcon,
  FilesIcon,
  NotepadIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  UsersThreeIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { PageTabs } from "@/components/page-tabs";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { askTargetsQuery, deskKeys, uploadToDesk } from "@/lib/desk";
import { fileSize, fileUrl } from "@/lib/documents";
import {
  KINDS,
  addForm,
  addStarter,
  archiveForm,
  askForm,
  blankUrl,
  changeForm,
  formKeys,
  formsQuery,
  needsMe,
  reviewSubmission,
  roundQuery,
  startersQuery,
  submitForm,
  urgency,
  type CompanyForm,
  type FormFile,
  type FormKind,
  type Schedule,
  type Submission,
} from "@/lib/forms";
import { branchesQuery, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

import { PERSON, STATE_LABEL, monthName, periodText, scheduleText, whenText } from "./words";

// ---------------------------------------------------------------- page

type Tab = "todo" | "all" | "archived";

export function FormsPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: Tab; form?: string };
  const { data: me } = useQuery(meQuery);
  const { data: forms = [], isLoading, error } = useQuery(formsQuery());
  const manager = !!me && ["org.manage", "team.manage", "agents.manage"].some((p) => me.permissions.includes(p));
  const todo = forms.filter(needsMe);
  const tab: Tab = search.tab ?? (todo.length || manager ? (todo.length ? "todo" : "all") : "all");
  const go = (next: Tab) => void navigate({ to: "/forms", search: { tab: next }, replace: true });
  const [adding, setAdding] = useState(false);
  const [handing, setHanding] = useState<CompanyForm | null>(null);
  const [asking, setAsking] = useState<CompanyForm | null>(null);
  const [editing, setEditing] = useState<CompanyForm | null>(null);
  const [roundOf, setRoundOf] = useState<CompanyForm | null>(null);
  const [archiving, setArchiving] = useState<CompanyForm | null>(null);
  const qc = useQueryClient();
  const archived = useQuery({ ...formsQuery(true), enabled: tab === "archived" });
  const shown = tab === "todo" ? todo : tab === "archived" ? (archived.data ?? []) : forms;
  const sorted = [...shown].sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name));
  return (
    <Page wide>
      <PageHeader
        title={t("Forms")}
        icon={NotepadIcon}
        description={t("Claims, advances, monthly records and requests: download the blank, hand it back before the deadline, or let your AI worker fill it in for you.")}
        actions={manager ? <Button onClick={() => setAdding(true)}><PlusIcon size={16} /> {t("Add a form")}</Button> : undefined}
      />
      <PageTabs
        label={t("Forms")}
        guide="forms.tabs"
        value={tab}
        onChange={go}
        tabs={[
          { value: "todo", label: t("To hand in"), icon: CalendarBlankIcon, count: todo.length, attention: true },
          { value: "all", label: t("All forms"), icon: NotepadIcon, count: forms.length },
          ...(manager ? [{ value: "archived" as const, label: t("Archived"), icon: ArchiveIcon }] : []),
        ]}
      />
      {isLoading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
      ) : error ? (
        <EmptyState icon={WarningIcon} title={t("Could not load the forms")} body={errorMessage(error)} />
      ) : sorted.length ? (
        <ul className="grid gap-3" data-guide="forms.list">
          {sorted.map((f) => (
            <FormCard
              key={f.id}
              f={f}
              highlight={search.form === f.id}
              onHandIn={() => setHanding(f)}
              onAsk={() => setAsking(f)}
              onRound={() => setRoundOf(f)}
              onEdit={() => setEditing(f)}
              onArchive={() => setArchiving(f)}
              onRestore={async () => {
                try {
                  await changeForm(f.id, { status: "active" });
                  void qc.invalidateQueries({ queryKey: formKeys.all });
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            />
          ))}
        </ul>
      ) : tab === "todo" ? (
        <EmptyState
          icon={CheckCircleIcon}
          title={t("Nothing to hand in right now")}
          body={forms.length ? t("Every open form is handed in. The next rounds show here when they open.") : t("Your company has no forms here yet.")}
          action={forms.length ? <Button variant="outline" onClick={() => go("all")}>{t("See all forms")}</Button> : undefined}
        />
      ) : (
        <EmptyState
          icon={NotepadIcon}
          title={tab === "archived" ? t("No archived forms") : t("No forms yet")}
          body={manager ? t("Add a ready-made claim, travel claim, petty cash or leave form, or upload your company's own Excel form, and set when it is due.") : t("Your managers add the company's forms here: claims, records and requests to hand in.")}
          action={manager && tab !== "archived" ? <Button onClick={() => setAdding(true)}><PlusIcon size={16} /> {t("Add a form")}</Button> : undefined}
        />
      )}
      {adding ? <AddForm onClose={() => setAdding(false)} /> : null}
      {editing ? <EditForm f={editing} onClose={() => setEditing(null)} /> : null}
      {handing ? <HandIn f={handing} onClose={() => setHanding(null)} /> : null}
      {asking ? <AskAi f={asking} onClose={() => setAsking(null)} onDone={() => setAsking(null)} /> : null}
      {roundOf ? <Hands f={roundOf} onClose={() => setRoundOf(null)} /> : null}
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t("Archive {name}?", { name: archiving?.name ?? "" })}
        body={t("People stop seeing it. What was handed in is kept, and you can bring it back from Archived.")}
        confirmLabel={t("Archive")}
        danger
        onConfirm={async () => {
          if (!archiving) return;
          try {
            await archiveForm(archiving.id);
            void qc.invalidateQueries({ queryKey: formKeys.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Page>
  );
}

// ---------------------------------------------------------------- one form

function FormCard({ f, highlight, onHandIn, onAsk, onRound, onEdit, onArchive, onRestore }: {
  f: CompanyForm;
  highlight: boolean;
  onHandIn: () => void;
  onAsk: () => void;
  onRound: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useT();
  const s = STATE_LABEL[f.state];
  const kind = KINDS.find((k) => k.value === f.kind);
  const closed = f.status === "archived";
  const done = f.state === "accepted" || f.state === "submitted";
  // Managers who do not hand this form in themselves see its progress, not a personal status.
  const mineToo = f.expected || !!f.mine;
  return (
    <li className={cn("grid min-w-0 gap-3 rounded-[var(--radius-md)] border bg-surface p-4 transition-colors sm:p-5", highlight ? "border-accent/60 ring-3 ring-accent/15" : "border-border")}>
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={f.template?.name.match(/\.xls[xm]?$/i) ? FileXlsIcon : ClipboardTextIcon} tone={!mineToo ? "accent" : done ? "ok" : f.state === "late" || f.state === "returned" ? "danger" : "accent"} size="sm" />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-[15px] font-semibold">{f.name}</h3>
            {closed ? <Pill>{t("Archived")}</Pill> : mineToo ? <Pill tone={s.tone}>{t(s.label)}</Pill> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted">
            <Meta items={[kind ? t(kind.label) : null, f.branch_name ?? t("Every company"), f.department_name, scheduleText(t, f.schedule)]} />
          </div>
          {f.description ? <p className="line-clamp-2 text-[13px] text-muted">{f.description}</p> : null}
        </div>
        {f.can_manage ? (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t("More")}><DotsThreeIcon size={18} weight="bold" /></Button>
            </MenuTrigger>
            <MenuContent>
              {closed ? (
                <MenuItem icon={<ArchiveIcon size={15} />} onSelect={onRestore}>{t("Bring back")}</MenuItem>
              ) : (
                <>
                  <MenuItem icon={<PencilSimpleIcon size={15} />} onSelect={onEdit}>{t("Change")}</MenuItem>
                  <MenuItem icon={<ArchiveIcon size={15} />} danger onSelect={onArchive}>{t("Archive")}</MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      {!closed ? (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><CalendarBlankIcon size={14} /> {whenText(t, f)}</span>
            {f.mine?.submitted_at && f.state !== "draft" ? <span>{t("You handed in {when}", { when: timeAgo(f.mine.submitted_at) })}</span> : null}
            {f.progress && f.can_manage ? (
              <button type="button" onClick={onRound} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                <UsersThreeIcon size={14} />{" "}
                {f.schedule.every === "none" || !f.schedule.every
                  ? f.progress.waiting ? t("{n} waiting for your review", { n: f.progress.waiting }) : t("Nothing waiting for review")
                  : t("{a} of {b} handed in", { a: f.progress.submitted, b: f.progress.expected })}
              </button>
            ) : null}
          </div>
          {f.state === "returned" && f.mine?.review_note ? (
            <p className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">
              {t("Returned: {note}", { note: f.mine.review_note })}
            </p>
          ) : null}
          {f.state === "draft" && f.mine ? (
            <p className="rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px]">
              {f.mine.made_by === "agent" ? t("Your AI worker filled it in. Open it, check every line, then hand it in.") : t("Saved, not handed in yet.")}
            </p>
          ) : null}
          {f.mine?.files.length && !done ? <FileChips files={f.mine.files} /> : null}
          <div className="flex min-w-0 flex-wrap gap-2 max-sm:[&>*]:flex-1">
            {f.template ? (
              <Button size="sm" variant="outline" asChild>
                <a href={blankUrl(f.id)} download><DownloadSimpleIcon size={15} /> {t("Download blank")}</a>
              </Button>
            ) : null}
            {f.state !== "accepted" && mineToo ? (
              <>
                <Button size="sm" variant={done ? "outline" : "primary"} onClick={onHandIn}>
                  <CloudArrowUpIcon size={15} /> {f.state === "submitted" ? t("Hand in again") : f.state === "draft" ? t("Check and hand in") : t("Hand in")}
                </Button>
                {!done ? (
                  <Button size="sm" variant="outline" onClick={onAsk}>
                    <SparkleIcon size={15} /> {t("Ask AI to fill it")}
                  </Button>
                ) : null}
              </>
            ) : null}
            {f.progress && f.can_manage ? (
              <Button size="sm" variant="ghost" onClick={onRound}><UsersThreeIcon size={15} /> {t("Who handed in")}</Button>
            ) : null}
          </div>
        </>
      ) : null}
    </li>
  );
}

function FileChips({ files, onRemove }: { files: FormFile[]; onRemove?: (id: string) => void }) {
  const t = useT();
  return (
    <span className="flex max-w-full min-w-0 flex-wrap gap-1.5">
      {files.map((f) => (
        <span key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full border border-border bg-surface-2/60 py-0.5 pr-1 pl-2.5 text-[12px]">
          <FilesIcon size={12} className="shrink-0" />
          <a href={fileUrl(f.id)} download className="min-w-0 truncate hover:text-accent">{f.name}</a>
          <span className="shrink-0 text-muted">{fileSize(f.size)}</span>
          {onRemove ? (
            <button type="button" aria-label={t("Remove {name}", { name: f.name })} onClick={() => onRemove(f.id)} className="grid size-5 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg">
              <XIcon size={11} />
            </button>
          ) : <span className="w-1" />}
        </span>
      ))}
    </span>
  );
}

/** Upload any files to the person's own workspace; returns them as form files. */
function useUpload(onAdded: (files: FormFile[]) => void, branchId?: string | null) {
  const t = useT();
  return useMutation({
    mutationFn: async (list: File[]) => {
      const out: FormFile[] = [];
      for (const f of list) {
        const d = await uploadToDesk(f, branchId);
        out.push({ id: d.id, name: d.name, mime: d.mime, size: d.size });
      }
      return out;
    },
    onSuccess: onAdded,
    onError: (e) => toast.error(errorMessage(e) || t("Upload failed.")),
  });
}

function UploadButton({ label, busy, onFiles }: { label: string; busy: boolean; onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; if (l.length) onFiles(l); }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const l = Array.from(e.dataTransfer.files); if (l.length) onFiles(l); }}
        className="flex w-full flex-col items-center gap-1 rounded-sm border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted transition-colors hover:border-accent/50 hover:bg-accent-soft/30 disabled:opacity-60"
      >
        <CloudArrowUpIcon size={22} className="text-accent" />
        <span className="font-medium text-fg">{busy ? "…" : label}</span>
      </button>
    </>
  );
}

// ---------------------------------------------------------------- hand in

function HandIn({ f, onClose }: { f: CompanyForm; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [files, setFiles] = useState<FormFile[]>(f.state === "returned" || f.state === "draft" || f.state === "submitted" ? (f.mine?.files ?? []) : []);
  const [note, setNote] = useState(f.mine?.note ?? "");
  const upload = useUpload((added) => setFiles((now) => [...now, ...added.filter((a) => !now.some((n) => n.id === a.id))]), f.branch_id);
  const send = useMutation({
    mutationFn: () => submitForm(f.id, { file_ids: files.map((x) => x.id), note, period: f.mine?.period ?? undefined }),
    onSuccess: () => {
      toast.success(t("{name} handed in.", { name: f.name }));
      void qc.invalidateQueries({ queryKey: formKeys.all });
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Hand in: {name}", { name: f.name })}
      description={whenText(t, f)}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!files.length || upload.isPending} loading={send.isPending} onClick={() => send.mutate()}>
            <PaperPlaneTiltIcon size={15} /> {t("Hand in")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {f.guide ? <p className="rounded-sm bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-line">{f.guide}</p> : null}
        <ol className="grid gap-1 text-[13px] text-muted">
          {f.template ? <li>{t("1. Download the blank, fill it in on your computer or phone.")}</li> : null}
          <li>{f.template ? t("2. Upload the filled form with its receipts, photos or any other papers.") : t("Upload the filled form with its receipts, photos or any other papers.")}</li>
        </ol>
        {f.template ? (
          <Button variant="outline" asChild>
            <a href={blankUrl(f.id)} download><DownloadSimpleIcon size={15} /> {t("Download blank")}</a>
          </Button>
        ) : null}
        <UploadButton label={t("Choose files or drop them here (Excel, PDF, photos, anything)")} busy={upload.isPending} onFiles={(l) => upload.mutate(l)} />
        {files.length ? <FileChips files={files} onRemove={(id) => setFiles((now) => now.filter((x) => x.id !== id))} /> : null}
        <TextareaField label={t("Note for your manager (optional)")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        <FormError message={send.error ? errorMessage(send.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- ask AI

function AskAi({ f, onClose, onDone }: { f: CompanyForm; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: targets = [] } = useQuery(askTargetsQuery);
  const [agentId, setAgentId] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FormFile[]>([]);
  const target = targets.find((a) => a.id === agentId) ?? targets[0];
  const upload = useUpload((added) => setFiles((now) => [...now, ...added]), f.branch_id);
  const ask = useMutation({
    mutationFn: () => askForm(f.id, { text, file_ids: files.map((x) => x.id), agent_id: target?.id }),
    onSuccess: (r) => {
      toast.success(r.note ? t("{name} will do it: {note}", { name: r.agent.name, note: r.note }) : t("{name} is filling it in. It comes back here as a draft for you to check.", { name: r.agent.name }), {
        action: { label: t("Follow it"), onClick: () => window.location.assign(`/tasks?task=${r.task_id}`) },
      });
      void qc.invalidateQueries({ queryKey: formKeys.all });
      void qc.invalidateQueries({ queryKey: deskKeys.all });
      onDone();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Ask AI to fill: {name}", { name: f.name })}
      description={t("Tell it what goes in, attach receipts or photos. It fills the company's own form and leaves it as your draft: nothing is handed in until you check it.")}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!target || upload.isPending || (!text.trim() && !files.length)} loading={ask.isPending} onClick={() => ask.mutate()}>
            <SparkleIcon size={15} /> {target ? t("Ask {name}", { name: target.name }) : t("Ask my AI")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!targets.length ? (
          <p className="text-[13px] text-muted">{t("You have no AI worker yet.")} <Link to="/my-worker" className="text-accent hover:underline">{t("Hire one")}</Link></p>
        ) : targets.length > 1 ? (
          <Select label={t("Who should do it")} value={target?.id ?? ""} onValueChange={setAgentId}
            options={targets.map((a) => ({ value: a.id, label: a.is_twin ? t("{name} (your AI worker)", { name: a.name }) : a.name }))} />
        ) : null}
        <TextareaField
          label={t("What goes in it")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={t("e.g. Grab to the district office RM23.50 on 3 Oct, A4 paper RM45 on 8 Oct, toll RM6.80.")}
        />
        <UploadButton label={t("Attach receipts, photos or old forms")} busy={upload.isPending} onFiles={(l) => upload.mutate(l)} />
        {files.length ? <FileChips files={files} onRemove={(id) => setFiles((now) => now.filter((x) => x.id !== id))} /> : null}
        <FormError message={ask.error ? errorMessage(ask.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- who handed in (managers)

function Hands({ f, onClose }: { f: CompanyForm; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, isLoading } = useQuery(roundQuery(f.id, period));
  const [returning, setReturning] = useState<Submission | null>(null);
  const [why, setWhy] = useState("");
  const review = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "accept" | "return"; note?: string }) => reviewSubmission(id, decision, note),
    onSuccess: () => {
      setReturning(null);
      setWhy("");
      void qc.invalidateQueries({ queryKey: formKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const people = data?.people ?? [];
  const handed = people.filter((p) => p.submission).length;
  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={f.name}
      description={data?.period ? t("{a} of {b} handed in for {period}", { a: handed, b: people.length, period: periodText(data.period) }) : t("Everything handed in, newest first")}
      size="md"
    >
      <div className="grid gap-4">
        {data && data.periods.length > 1 ? (
          <Select label={t("Round")} value={data.period ?? ""} onValueChange={setPeriod}
            options={data.periods.map((p) => ({ value: p, label: periodText(p) }))} className="sm:w-64" />
        ) : null}
        {isLoading ? (
          <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-sm" />)}</div>
        ) : people.length ? (
          <ListCard>
            {people.map((p) => {
              const s = PERSON[p.state] ?? PERSON.missing!;
              const sub = p.submission;
              return (
                <ListRow
                  key={`${p.user_id}:${sub?.id ?? ""}`}
                  title={p.name || t("Someone")}
                  meta={
                    <>
                      {sub ? <Meta items={[sub.submitted_at ? timeAgo(sub.submitted_at) : null, sub.made_by === "agent" ? t("Filled by AI") : null, data?.period ? null : periodText(sub.period)]} /> : null}
                      {sub?.note ? <span className="basis-full text-[12.5px]">{sub.note}</span> : null}
                      {sub?.files.length ? <span className="basis-full pt-1"><FileChips files={sub.files} /></span> : null}
                      {sub?.review_note && sub.status === "returned" ? <span className="basis-full text-[12.5px] text-danger">{t("Returned: {note}", { note: sub.review_note })}</span> : null}
                      {returning?.id === sub?.id && sub ? (
                        <span className="grid basis-full gap-2 pt-2">
                          <Input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("What should they fix?")} aria-label={t("What should they fix?")} />
                          <span className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setReturning(null)}>{t("Cancel")}</Button>
                            <Button size="sm" variant="danger" disabled={!why.trim()} loading={review.isPending} onClick={() => review.mutate({ id: sub.id, decision: "return", note: why.trim() })}>{t("Return it")}</Button>
                          </span>
                        </span>
                      ) : null}
                    </>
                  }
                  trailing={
                    <>
                      <Pill tone={s.tone}>{t(s.label)}</Pill>
                      {sub && sub.status === "submitted" && returning?.id !== sub.id ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setReturning(sub); setWhy(""); }}>{t("Return")}</Button>
                          <Button size="sm" variant="outline" loading={review.isPending && review.variables?.id === sub.id} onClick={() => review.mutate({ id: sub.id, decision: "accept" })}>
                            <CheckCircleIcon size={14} /> {t("Accept")}
                          </Button>
                        </>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </ListCard>
        ) : (
          <p className="text-[13px] text-muted">{t("Nobody is expected to hand this in yet: add people to the company or department first.")}</p>
        )}
      </div>
    </SideSheet>
  );
}

// ---------------------------------------------------------------- add and change (managers)

function useCompanies() {
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const mine = me?.scope?.branch_id;
  return mine ? branches.filter((b) => b.id === mine) : branches;
}

const ANY = "_any";

function WhereFields({ branchId, setBranchId, deptId, setDeptId, lockCompany }: {
  branchId: string;
  setBranchId: (v: string) => void;
  deptId: string;
  setDeptId: (v: string) => void;
  lockCompany?: boolean;
}) {
  const t = useT();
  const companies = useCompanies();
  const depts = companies.find((b) => b.id === branchId)?.departments ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Company")}</span>
        <Select label={t("Company")} value={branchId} disabled={lockCompany} onValueChange={(v) => { setBranchId(v); setDeptId(ANY); }}
          options={companies.map((b) => ({ value: b.id, label: b.name }))} />
      </label>
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Who fills it in")}</span>
        <Select label={t("Who fills it in")} value={deptId} onValueChange={setDeptId}
          options={[{ value: ANY, label: t("Everyone in the company") }, ...depts.map((d) => ({ value: d.id, label: d.name }))]} />
      </label>
    </div>
  );
}

function AddForm({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const companies = useCompanies();
  const { data: starters = [] } = useQuery(startersQuery);
  const [mode, setMode] = useState<"ready" | "own">("ready");
  const [branchId, setBranchId] = useState(companies[0]?.id ?? "");
  const [deptId, setDeptId] = useState(ANY);
  const done = (f: CompanyForm) => {
    toast.success(t("{name} added. Everyone it is for sees it under Forms.", { name: f.name }));
    void qc.invalidateQueries({ queryKey: formKeys.all });
  };
  const add = useMutation({
    mutationFn: (key: string) => addStarter(key, branchId || null, deptId === ANY ? null : deptId),
    onSuccess: done,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Add a form")}
      description={t("Pick a ready-made form, or upload the Excel or Word form your company already uses.")}
      className="w-[min(96vw,42rem)]"
      footer={mode === "ready" ? <Button variant="ghost" onClick={onClose}>{t("Close")}</Button> : undefined}
    >
      <div className="grid gap-4">
        <Segmented label={t("Add")} value={mode} onChange={setMode}
          options={[{ value: "ready", label: t("Ready-made") }, { value: "own", label: t("Our own form") }]} />
        {mode === "ready" ? (
          <>
            <WhereFields branchId={branchId} setBranchId={setBranchId} deptId={deptId} setDeptId={setDeptId} />
            <ul className="grid gap-2">
              {starters.map((s) => (
                <li key={s.key} className="flex min-w-0 flex-wrap items-center gap-3 rounded-sm border border-border p-3">
                  <IconTile icon={FileXlsIcon} size="sm" tone="ok" />
                  <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
                    <span className="text-[13.5px] font-medium">{s.name}</span>
                    <span className="text-[12.5px] text-muted">{s.description}</span>
                    <span className="text-[12px] text-muted">{scheduleText(t, s.schedule)}</span>
                  </div>
                  <Button size="sm" variant="outline" loading={add.isPending && add.variables === s.key} disabled={!branchId} onClick={() => add.mutate(s.key)}>
                    <PlusIcon size={14} /> {t("Add")}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-muted">{t("Each is built in the company's language, with its name on top. Change the schedule after adding it.")}</p>
          </>
        ) : (
          <FormEditor branchId={branchId} setBranchId={setBranchId} deptId={deptId} setDeptId={setDeptId} onSaved={(f) => { done(f); onClose(); }} />
        )}
      </div>
    </ResponsiveDialog>
  );
}

function EditForm({ f, onClose }: { f: CompanyForm; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState(f.branch_id ?? "");
  const [deptId, setDeptId] = useState(f.department_id ?? ANY);
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Change {name}", { name: f.name })} className="w-[min(96vw,42rem)]">
      <FormEditor
        form={f}
        branchId={branchId}
        setBranchId={setBranchId}
        deptId={deptId}
        setDeptId={setDeptId}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: formKeys.all });
          toast.success(t("Saved."));
          onClose();
        }}
      />
    </ResponsiveDialog>
  );
}

function FormEditor({ form, branchId, setBranchId, deptId, setDeptId, onSaved }: {
  form?: CompanyForm;
  branchId: string;
  setBranchId: (v: string) => void;
  deptId: string;
  setDeptId: (v: string) => void;
  onSaved: (f: CompanyForm) => void;
}) {
  const t = useT();
  const [name, setName] = useState(form?.name ?? "");
  const [kind, setKind] = useState<FormKind>(form?.kind ?? "claim");
  const [description, setDescription] = useState(form?.description ?? "");
  const [guide, setGuide] = useState(form?.guide ?? "");
  const [file, setFile] = useState<FormFile | null>(form?.template ?? null);
  const [s, setS] = useState<Schedule>(form?.schedule.every ? form.schedule : { every: "month", from_day: 1, to_day: 15 });
  const upload = useUpload((added) => {
    setFile(added[0] ?? null);
    if (!name && added[0]) setName(added[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }, branchId || null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), kind, description, guide, schedule: s, department_id: deptId === ANY ? null : deptId };
      if (form) return changeForm(form.id, { ...body, ...(file && file.id !== form.template?.id ? { file_id: file.id } : {}) });
      return addForm({ ...body, branch_id: branchId || null, file_id: file?.id ?? null });
    },
    onSuccess: onSaved,
  });
  const num = (v: string, max: number) => Math.min(Math.max(Number.parseInt(v, 10) || 1, 1), max);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) })), []);
  return (
    <div className="grid gap-4">
      <div>
        <p className="mb-1.5 text-[13px] font-medium">{t("The blank form")}</p>
        {file ? (
          <div className="flex min-w-0 items-center gap-2 rounded-sm border border-border px-3 py-2 text-[13px]">
            <FileXlsIcon size={18} className="shrink-0 text-ok" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>{t("Replace")}</Button>
          </div>
        ) : (
          <UploadButton label={t("Upload your Excel, Word or PDF form")} busy={upload.isPending} onFiles={(l) => upload.mutate(l.slice(0, 1))} />
        )}
        <p className="mt-1 text-[12px] text-muted">{t("Everyone it is for can download it. With an Excel form, the AI fills the cells the way a person would, keeping your layout and formulas.")}</p>
      </div>
      <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder={t("e.g. Monthly travel claim")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Type")}</span>
          <Select label={t("Type")} value={kind} onValueChange={(v) => setKind(v as FormKind)} options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("When it is handed in")}</span>
          <Select label={t("When it is handed in")} value={s.every ?? "none"}
            onValueChange={(v) => setS(v === "month" ? { every: "month", from_day: s.from_day ?? 1, to_day: s.to_day ?? 15 } : v === "year" ? { every: "year", month: s.month ?? 12, from_day: s.from_day ?? 1, to_day: s.to_day ?? 31 } : v === "once" ? { every: "once", due_on: s.due_on ?? new Date().toISOString().slice(0, 10) } : { every: "none" })}
            options={[
              { value: "month", label: t("Every month") },
              { value: "year", label: t("Every year") },
              { value: "once", label: t("Once, by a date") },
              { value: "none", label: t("Whenever needed") },
            ]} />
        </label>
      </div>
      {s.every === "month" || s.every === "year" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {s.every === "year" ? (
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Month")}</span>
              <Select label={t("Month")} value={String(s.month ?? 12)} onValueChange={(v) => setS({ ...s, month: Number(v) })} options={months} />
            </label>
          ) : null}
          <Field label={t("Opens on day")} type="number" min={1} max={31} value={s.from_day ?? 1} onChange={(e) => setS({ ...s, from_day: num(e.target.value, 31) })} />
          <Field label={t("Due on day")} type="number" min={1} max={31} value={s.to_day ?? 15} onChange={(e) => setS({ ...s, to_day: num(e.target.value, 31) })}
            hint={s.every === "month" && (s.to_day ?? 15) < (s.from_day ?? 1) ? t("Runs into the next month.") : undefined} />
        </div>
      ) : s.every === "once" ? (
        <Field label={t("Due on")} type="date" value={s.due_on ?? ""} onChange={(e) => setS({ ...s, due_on: e.target.value })} />
      ) : null}
      {s.every !== "none" ? <p className="-mt-2 text-[12.5px] text-muted">{scheduleText(t, s)}</p> : null}
      <WhereFields branchId={branchId} setBranchId={setBranchId} deptId={deptId} setDeptId={setDeptId} lockCompany={!!form} />
      <Field label={t("Short description (optional)")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      <TextareaField label={t("How to fill it in (optional)")} value={guide} onChange={(e) => setGuide(e.target.value)} rows={3} maxLength={8000}
        hint={t("Shown to people and read by the AI, e.g. which receipts to attach, the amount limits, who signs.")} />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="flex justify-end gap-2">
        <Button disabled={!name.trim() || upload.isPending} loading={save.isPending} onClick={() => save.mutate()}>
          {form ? t("Save") : <><PlusIcon size={15} /> {t("Add the form")}</>}
        </Button>
      </div>
    </div>
  );
}
