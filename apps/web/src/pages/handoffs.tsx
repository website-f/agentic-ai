/**
 * P109: Library > For other companies. Upload files for other companies (several at once, each
 * for one or more companies, a title typed or written by the AI when it reads the file, and the
 * task that asked for it), check each one (preview, fix the title or company) and approve it:
 * then it goes to that company's Library and leaves your view, keeping only a line here. Heads
 * of a company's departments (or its managers) see what came in for it under Received, and are
 * told when it arrives. The rules are the server's (api/routers/handoffs.py, org/handoffs.py).
 */
import {
  ArrowSquareOutIcon, CheckIcon, FilePlusIcon, PencilSimpleIcon, SparkleIcon, TrayArrowDownIcon, TrashIcon, UploadSimpleIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { MultiSelect, SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { fileSize } from "@/lib/documents";
import {
  approveHandoff, editHandoff, handoffFileUrl, handoffKeys, incomingQuery, mineQuery, takeBackHandoff, targetsQuery, uploadFor, type Handoff,
} from "@/lib/handoffs";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { LibraryHeader } from "./library-hub/hub";

export type HandoffTab = "upload" | "check" | "done" | "received";
export const HANDOFF_TABS: HandoffTab[] = ["upload", "check", "done", "received"];

const when = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

interface Pick { key: string; file: File; title: string; ai: boolean; companies: string[] }

/** The files picked, each with its title (or the AI's) and companies; "apply to all" on top. */
function UploadPanel({ companies, onDone }: { companies: { id: string; name: string }[]; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [all, setAll] = useState<string[]>([]);
  const [task, setTask] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const tasks = useQuery({ queryKey: ["me", "assigned-tasks"], queryFn: () => api<{ items: { id: string; title: string }[] }>("/api/me/assigned-tasks") });
  const options = companies.map((c) => ({ value: c.id, label: c.name }));
  const add = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setPicks((p) => [...p, ...files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, title: "", ai: true, companies: [...all] }))]);
  };
  const set = (key: string, change: Partial<Pick>) => setPicks((p) => p.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const ready = picks.length > 0 && picks.every((p) => p.companies.length > 0 && (p.ai || p.title.trim()));
  const send = async () => {
    setBusy(true);
    let ok = 0;
    const left: Pick[] = [];
    for (const p of picks) {
      try {
        await uploadFor(p.file, p.companies, p.ai ? "" : p.title, task || null);
        ok += 1;
      } catch (e) {
        left.push(p);
        toast.error(`${p.file.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    setPicks(left);
    qc.invalidateQueries({ queryKey: handoffKeys.all });
    if (ok) {
      toast.success(ok === 1 ? t("1 file uploaded. Check it, then approve it.") : t("{n} files uploaded. Check them, then approve them.", { n: ok }));
      if (!left.length) onDone();
    }
  };
  return (
    <div className="grid gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={cn("grid justify-items-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed p-5 text-center transition-colors",
          over ? "border-accent bg-accent-soft/40" : "border-border bg-surface-2/30")}>
        <UploadSimpleIcon size={26} className="text-accent" />
        <p className="text-[13.5px] font-medium">{t("Drop files here, or choose them")}</p>
        <p className="max-w-prose text-[12.5px] text-muted">{t("Pick the companies each file is for. Each company's heads of department are told who uploaded what.")}</p>
        <Button variant="outline" className="pointer-coarse:h-11" onClick={() => input.current?.click()}><FilePlusIcon size={16} /> {t("Choose files")}</Button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {picks.length ? (
        <Card>
          <CardBody className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid min-w-0 gap-1.5">
                <span className="text-[13px] font-medium">{t("Companies for every file")}</span>
                <MultiSelect value={all} onValueChange={(v) => { setAll(v); setPicks((p) => p.map((x) => ({ ...x, companies: v }))); }}
                  label={t("Companies for every file")} placeholder={t("Pick companies")} searchPlaceholder={t("Search companies")} options={options} />
                <p className="text-[12px] text-muted">{t("Sets every file below; change one file's companies after.")}</p>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <span className="text-[13px] font-medium">{t("Task that asked for it (optional)")}</span>
                <SearchSelect value={task || "none"} onValueChange={(v) => setTask(v === "none" ? "" : v)} label={t("Task that asked for it (optional)")}
                  searchPlaceholder={t("Search tasks")}
                  options={[{ value: "none", label: t("No task") }, ...(tasks.data?.items ?? []).map((x) => ({ value: x.id, label: x.title }))]} />
              </div>
            </div>
            <ul className="grid gap-3">
              {picks.map((p) => (
                <li key={p.key} className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium break-all">{p.file.name}</p>
                      <p className="text-[12px] text-muted tabular">{fileSize(p.file.size)}</p>
                    </div>
                    <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("Remove {name}", { name: p.file.name })}
                      onClick={() => setPicks((x) => x.filter((y) => y.key !== p.key))}><XIcon size={16} /></Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid min-w-0 gap-1.5">
                      <span className="text-[13px] font-medium">{t("Title")}</span>
                      <Input value={p.ai ? "" : p.title} disabled={p.ai} maxLength={200} aria-label={t("Title")}
                        placeholder={p.ai ? t("The AI writes it when it reads the file") : t("Type a title")} onChange={(e) => set(p.key, { title: e.target.value })} />
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={p.ai} onChange={(e) => set(p.key, { ai: e.target.checked })} className="size-4 accent-[var(--accent)]" />
                        <SparkleIcon size={14} className="text-accent" /> {t("Let AI describe it")}
                      </label>
                    </div>
                    <div className="grid min-w-0 content-start gap-1.5">
                      <span className="text-[13px] font-medium">{t("For")}</span>
                      <MultiSelect value={p.companies} onValueChange={(v) => set(p.key, { companies: v })} label={t("Companies for {name}", { name: p.file.name })}
                        placeholder={t("Pick companies")} searchPlaceholder={t("Search companies")} options={options} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={busy} disabled={!ready} className="pointer-coarse:h-11" onClick={() => void send()}>
                <UploadSimpleIcon size={16} /> {picks.length === 1 ? t("Upload 1 file") : t("Upload {n} files", { n: picks.length })}
              </Button>
              <Button variant="ghost" className="pointer-coarse:h-11" disabled={busy} onClick={() => setPicks([])}>{t("Clear")}</Button>
              {!ready ? <p className="text-[12.5px] text-muted">{t("Each file needs a company, and a title or Let AI describe it.")}</p> : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <p className="text-[12.5px] text-muted"><span className="font-medium text-fg">{label}:</span> {children}</p>;
}

/** One file waiting for the uploader's check. */
function CheckCard({ h, companies }: { h: Handoff; companies: { id: string; name: string }[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const approve = useMutation({
    mutationFn: () => approveHandoff(h.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: handoffKeys.all }); toast.success(t("Handed over to {company}.", { company: h.company_name ?? "" })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardBody className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold break-words">{h.title}</p>
            <p className="text-[12.5px] break-all text-muted">{h.file_name}{h.size ? ` · ${fileSize(h.size)}` : ""}</p>
          </div>
          <span className="flex flex-wrap gap-1">
            <Pill tone="info">{h.company_name ?? t("No company")}</Pill>
            {h.reading ? <Pill tone="warn">{t("Reading…")}</Pill> : null}
            {!h.typed_title ? <Pill tone="neutral"><SparkleIcon size={11} /> {t("Title by AI")}</Pill> : null}
          </span>
        </div>
        {h.summary ? <p className="text-[13px] text-muted">{h.summary}</p> : null}
        {h.task_title ? <Line label={t("Task")}>{h.task_title}</Line> : null}
        <Line label={t("Uploaded")}>{when(h.created_at)}</Line>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" asChild>
            <a href={handoffFileUrl(h.id)} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={14} /> {t("Preview")}</a>
          </Button>
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => setEditing(true)}><PencilSimpleIcon size={14} /> {t("Edit")}</Button>
          <Button size="sm" className="pointer-coarse:h-11" loading={approve.isPending} onClick={() => approve.mutate()}><CheckIcon size={14} weight="bold" /> {t("Approve")}</Button>
          <Button variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={() => setRemoving(true)}><TrashIcon size={14} /> {t("Take back")}</Button>
        </div>
      </CardBody>
      {editing ? <EditDialog h={h} companies={companies} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Take back {name}?", { name: h.file_name })}
        body={t("The file is removed from {company}. Nobody there has it in their Library yet.", { company: h.company_name ?? "" })}
        confirmLabel={t("Take back")} danger
        onConfirm={async () => { await takeBackHandoff(h.id); qc.invalidateQueries({ queryKey: handoffKeys.all }); }} />
    </Card>
  );
}

function EditDialog({ h, companies, onClose }: { h: Handoff; companies: { id: string; name: string }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(h.title);
  const [company, setCompany] = useState(h.company_id ?? "");
  const save = useMutation({
    mutationFn: () => editHandoff(h.id, { ...(title.trim() !== h.title ? { title: title.trim() } : {}), ...(company !== h.company_id ? { company_id: company } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: handoffKeys.all }); toast.success(t("Saved.")); onClose(); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Edit {name}", { name: h.file_name })}
      description={t("A new company's heads of department are told about it.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={save.isPending} disabled={!title.trim() || !company} onClick={() => save.mutate()}>{t("Save")}</Button></>}>
      <div className="grid gap-4">
        <Field label={t("Title")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("For")}</span>
          <SearchSelect value={company} onValueChange={setCompany} label={t("Company")} searchPlaceholder={t("Search companies")}
            options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** What came in for the companies this person answers for. */
function ReceivedCard({ h }: { h: Handoff }) {
  const t = useT();
  return (
    <Card>
      <CardBody className="grid gap-2">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold break-words">{h.title}</p>
            <p className="text-[12.5px] break-all text-muted">{h.file_name}</p>
          </div>
          <span className="flex flex-wrap gap-1">
            {h.new ? <Pill tone="accent">{t("New")}</Pill> : null}
            <Pill tone="info">{h.company_name ?? t("No company")}</Pill>
            {h.status === "pending" ? <Pill tone="warn">{t("Waiting for the uploader's check")}</Pill> : <Pill tone="ok">{t("In the Library")}</Pill>}
          </span>
        </div>
        {h.summary ? <p className="text-[13px] text-muted">{h.summary}</p> : null}
        <Line label={t("Uploaded by")}>{h.uploader_name ?? t("Someone who left")} · {when(h.created_at)}</Line>
        {h.file_id ? (
          <div>
            <Button variant="outline" size="sm" className="pointer-coarse:h-11" asChild>
              <a href={handoffFileUrl(h.id)} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={14} /> {t("Open")}</a>
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function HandoffsPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: HandoffTab };
  const me = useQuery(meQuery);
  const targets = useQuery(targetsQuery);
  const mine = useQuery(mineQuery);
  const incoming = useQuery(incomingQuery);
  const allowed = !!targets.data?.allowed;
  const pending = mine.data?.pending ?? [];
  const done = mine.data?.approved ?? [];
  const received = incoming.data ?? [];
  const tabs: HandoffTab[] = [
    ...(allowed ? (["upload"] as const) : []),
    ...(allowed || pending.length || done.length ? (["check", "done"] as const) : []),
    ...(received.length || me.data?.scope?.kind === "all" || !allowed ? (["received"] as const) : []),
  ];
  const tab: HandoffTab = search.tab && tabs.includes(search.tab) ? search.tab : (tabs[0] ?? "received");
  const go = (next: HandoffTab) => navigate({ to: "/handoffs", search: { tab: next }, replace: true });
  const labels: Record<HandoffTab, string> = {
    upload: t("Upload"),
    check: t("To check"),
    done: t("Handed over"),
    received: t("Received"),
  };
  const counts: Partial<Record<HandoffTab, number>> = { check: pending.length, received: received.filter((x) => x.new).length };
  const loading = targets.isLoading || mine.isLoading || incoming.isLoading;
  const companies = targets.data?.companies ?? [];
  return (
    <Page>
      <LibraryHeader tab="/handoffs" />
      {loading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
      ) : (
        <div className="grid gap-4">
          {tabs.length > 1 ? (
            <Segmented value={tab} onChange={go} label={t("For other companies")}
              options={tabs.map((x) => ({ value: x, label: labels[x], ...(counts[x] ? { count: counts[x] } : {}) }))} />
          ) : null}
          {tab === "upload" ? <UploadPanel companies={companies} onDone={() => go("check")} /> : null}
          {tab === "check" ? (
            pending.length ? (
              <div className="grid gap-3">
                <p className="text-[13px] text-muted">{t("Check each file, fix its title or company, then approve it. Once approved it goes to that company's Library and leaves this list.")}</p>
                {pending.map((h) => <CheckCard key={h.id} h={h} companies={companies} />)}
              </div>
            ) : <EmptyState icon={CheckIcon} title={t("Nothing to check")} body={t("Files you upload for other companies wait here for your check.")} />
          ) : null}
          {tab === "done" ? (
            done.length ? (
              <ul className="grid divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
                {done.map((h) => (
                  <li key={h.id} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                    <span className="min-w-0 break-words font-medium">{h.title}</span>
                    <span className="text-muted">{t("{company} · {date}", { company: h.company_name ?? "", date: when(h.approved_at ?? h.created_at) })}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={CheckIcon} title={t("Nothing handed over yet")} body={t("Approved files are listed here as a record. The file itself is the other company's.")} />
          ) : null}
          {tab === "received" ? (
            received.length ? (
              <div className="grid gap-3">{received.map((h) => <ReceivedCard key={h.id} h={h} />)}</div>
            ) : (
              <EmptyState icon={TrayArrowDownIcon} title={t("Nothing received")}
                body={allowed ? t("Files others upload for the companies you head show here.") : t("Files others upload for the companies you head show here. To upload files for other companies, ask your manager or an owner to switch it on for you.")} />
            )
          ) : null}
        </div>
      )}
    </Page>
  );
}
