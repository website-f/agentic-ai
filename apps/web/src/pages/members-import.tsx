/** Settings → Members → Import from Excel: template, the sheet, a preview to fix, then the
 * new accounts' one-time passwords (api/routers/member_import.py). */
import { CheckCircleIcon, CopyIcon, DownloadSimpleIcon, FileXlsIcon, SparkleIcon, UploadSimpleIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  downloadSignIns, downloadTemplate, FIELD_LABEL, mergeChecks, previewSheet, SHEET_ACCEPT, toImportRow,
  type ImportNote, type ImportPreview, type ImportResult, type PreviewRow,
} from "@/lib/member-import";
import { branchesQuery, keys } from "@/lib/queries";
import { ROLE_INFO, SCOPED_ROLES, type Branch, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const NONE = "none";
const STATUS_TONE = { ok: "ok", warn: "warn", error: "danger" } as const;
// The sheet's notes that a hand fix of each field makes stale.
const FIXES: Record<"role" | "company" | "department", string[]> = { role: ["role"], company: ["company", "department"], department: ["department"] };

const roleLabel = (r: Role) => (ROLE_INFO[r] ? tr(ROLE_INFO[r].label) : r);

function StatusPill({ status }: { status: PreviewRow["status"] }) {
  const t = useT();
  const label = { ok: t("Ready"), warn: t("Check"), error: t("Fix first") }[status];
  return <Pill tone={STATUS_TONE[status]}>{label}</Pill>;
}

/** One row of the preview; rows that need fixing get selects for role and place. */
function Row({ row, editable, roles, branches, lockBranch, onFix }: {
  row: PreviewRow;
  /** Rows that need fixing (or were fixed here) get selects; ready rows read as text. */
  editable: boolean;
  roles: Role[];
  branches: Branch[];
  lockBranch: string | null;
  onFix: (field: "role" | "company" | "department", patch: Partial<PreviewRow>) => void;
}) {
  const t = useT();
  const scoped = SCOPED_ROLES.includes(row.role);
  const list = lockBranch ? branches.filter((b) => b.id === lockBranch) : branches;
  const branch = list.find((b) => b.id === row.branch_id);
  const needsDept = row.role === "hod" || row.role === "supervisor";
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5 text-[12px] text-muted tabular">{row.row}</td>
      <td className="px-3 py-2.5">
        <span className="block text-[13px] font-medium break-words">{row.name || <span className="text-muted">{t("No name")}</span>}</span>
        <span className="block text-[12px] break-all text-muted">{row.email || "—"}</span>
        {row.existing_account ? <span className="mt-0.5 block text-[11.5px] text-info">{t("Has an account already")}</span> : null}
      </td>
      <td className="px-3 py-2.5">
        {editable ? (
          <Select size="sm" value={roles.includes(row.role) ? row.role : ""} placeholder={roleLabel(row.role)} label={t("Role for {name}", { name: row.name || row.email })}
            className="w-40" options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
            onValueChange={(v) => onFix("role", { role: v as Role, ...(SCOPED_ROLES.includes(v as Role) ? {} : { branch_id: null, department_id: null }) })} />
        ) : <span className="text-[13px]">{roleLabel(row.role)}</span>}
        {row.role_text && row.role_text.toLowerCase() !== roleLabel(row.role).toLowerCase() ? (
          <span className="mt-0.5 block text-[11.5px] text-muted">{t("Sheet: {text}", { text: row.role_text })}</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        {!scoped ? <span className="text-[12.5px] text-muted">{t("Whole workspace")}</span> : editable ? (
          <div className="grid gap-1.5">
            <Select size="sm" value={branch?.id ?? ""} placeholder={t("Pick a company")} label={t("Company for {name}", { name: row.name || row.email })} className="w-44"
              options={list.map((b) => ({ value: b.id, label: b.name }))}
              onValueChange={(v) => onFix("company", { branch_id: v, department_id: null })} />
            {row.role === "branch_manager" ? null : (
              <Select size="sm" value={row.department_id ?? (needsDept ? "" : NONE)} placeholder={t("Pick a department")} disabled={!branch}
                label={t("Department for {name}", { name: row.name || row.email })} className="w-44"
                options={[...(needsDept ? [] : [{ value: NONE, label: t("Any department") }]), ...(branch?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
                onValueChange={(v) => onFix("department", { department_id: v === NONE ? null : v })} />
            )}
          </div>
        ) : (
          <span className="text-[13px] break-words">{[row.branch_name, row.department_name].filter(Boolean).join(" · ") || "—"}</span>
        )}
        {row.company_text || row.department_text ? (
          <span className="mt-0.5 block text-[11.5px] break-words text-muted">{t("Sheet: {text}", { text: [row.company_text, row.department_text].filter(Boolean).join(" · ") })}</span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <StatusPill status={row.status} />
        {row.notes_found.length ? (
          <ul className="mt-1 grid max-w-72 gap-0.5">
            {row.notes_found.map((n, i) => (
              <li key={i} className={cn("text-[12px] break-words", n.level === "error" ? "text-danger" : "text-warn")}>{n.text}</li>
            ))}
          </ul>
        ) : null}
      </td>
    </tr>
  );
}

function Results({ results }: { results: ImportResult[] }) {
  const t = useT();
  const added = results.filter((r) => r.status === "added");
  const skipped = results.filter((r) => r.status === "skipped");
  const withPassword = added.filter((r) => r.temp_password);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Copied."));
    } catch {
      toast.error(t("Copy blocked by the browser. Select the password and copy it by hand."));
    }
  };
  return (
    <div className="grid gap-4">
      <p className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <CheckCircleIcon size={18} weight="fill" className="text-ok" />
        {added.length === 1 ? t("1 member added.") : t("{n} members added.", { n: added.length })}
        {skipped.length ? <span className="text-muted">{t("{n} skipped.", { n: skipped.length })}</span> : null}
      </p>
      {withPassword.length ? (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warn/40 bg-warn/8 px-3.5 py-3 text-[13px]">
          <WarningIcon size={17} weight="fill" className="mt-px shrink-0 text-warn" />
          <span className="min-w-0">{t("These temporary passwords are shown only once. Download or copy them now and give each person their own. Everyone picks a new password the first time they sign in.")}</span>
        </div>
      ) : null}
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
        {added.map((r) => (
          <li key={r.email} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium break-words">{r.name}</span>
              <span className="block text-[12px] break-all text-muted">{r.email} · {roleLabel(r.role)}{r.branch_name ? ` · ${r.branch_name}` : ""}</span>
            </span>
            {r.temp_password ? (
              <span className="flex items-center gap-1.5">
                <code className="rounded-sm bg-surface-2 px-2 py-1 font-mono text-[13px] tracking-wide select-all">{r.temp_password}</code>
                <Button size="icon" variant="ghost" aria-label={t("Copy the password for {name}", { name: r.name })} onClick={() => void copy(r.temp_password!)}><CopyIcon size={15} /></Button>
              </span>
            ) : <span className="text-[12px] text-muted">{t("Own password")}</span>}
          </li>
        ))}
        {skipped.map((r) => (
          <li key={`${r.row}-${r.email}`} className="grid gap-0.5 px-3.5 py-2.5">
            <span className="flex flex-wrap items-center gap-2 text-[13px]"><Pill tone="danger">{t("Skipped")}</Pill> <span className="min-w-0 break-all">{r.name || r.email}</span></span>
            {r.message ? <span className="text-[12px] break-words text-muted">{r.message}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportMembersDialog({ open, onOpenChange, roles, lockBranch }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The roles this person may give (members.tsx assignable). */
  roles: Role[];
  lockBranch: string | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [fetchingTemplate, setFetchingTemplate] = useState(false);
  const [edited, setEdited] = useState<Set<number>>(new Set());
  const seq = useRef(0); // only the latest check's answer is used

  const read = useMutation({
    mutationFn: previewSheet,
    onSuccess: (p) => { setPreview(p); setRows(p.rows); },
  });
  const check = useMutation({
    mutationFn: (next: PreviewRow[]) => api<{ rows: PreviewRow[] }>("/api/members/import/check", "POST", { rows: next.map(toImportRow) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => api<{ results: ImportResult[]; added: number }>("/api/members/import", "POST", { rows: rows.filter((r) => r.status !== "error").map(toImportRow) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: keys.status });
      setResults(r.results);
    },
  });

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) read.mutate(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files);
  };
  const template = async () => {
    setFetchingTemplate(true);
    try {
      await downloadTemplate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setFetchingTemplate(false);
    }
  };

  /** A hand fix: drop the sheet's notes it answers, then let the server check every row again. */
  const fix = (index: number, field: keyof typeof FIXES, patch: Partial<PreviewRow>) => {
    const keep: ImportNote[][] = rows.map((r, i) => r.notes_found.filter((n) => n.source === "match" && (i !== index || !FIXES[field].includes(n.field))));
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    const mine = ++seq.current;
    setEdited((s) => new Set(s).add(index));
    setRows(next.map((r, i) => (i === index ? { ...r, notes_found: keep[i]! } : r)));
    check.mutate(next, {
      onSuccess: (res) => {
        if (mine === seq.current) setRows(next.map((r, i) => (res.rows[i] ? mergeChecks(r, res.rows[i], keep[i]!) : r)));
      },
    });
  };

  const counts = { ok: 0, warn: 0, error: 0 };
  for (const r of rows) counts[r.status] += 1;
  const ready = counts.ok + counts.warn;

  if (results) {
    const anyPassword = results.some((r) => r.temp_password);
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Members added")} className="w-[min(96vw,40rem)]"
        footer={<>
          {anyPassword ? <Button variant="outline" onClick={() => downloadSignIns(results, roleLabel)}><DownloadSimpleIcon size={15} /> {t("Download sign-in details (CSV)")}</Button> : null}
          <Button onClick={() => onOpenChange(false)}>{t("Done")}</Button>
        </>}>
        <Results results={results} />
      </ResponsiveDialog>
    );
  }

  if (preview) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Check before adding")} className="w-[min(96vw,64rem)]"
        description={t("Nothing is saved yet. Rows marked Fix first are skipped unless you fix them here.")}
        footer={<>
          <Button variant="outline" onClick={() => { setPreview(null); setRows([]); setEdited(new Set()); read.reset(); }}>{t("Choose another file")}</Button>
          <Button loading={save.isPending} disabled={!ready || check.isPending} onClick={() => save.mutate()}>
            {ready === 1 ? t("Add 1 member") : t("Add {n} members", { n: ready })}
          </Button>
        </>}>
        <div className="grid min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-fg"><FileXlsIcon size={16} weight="duotone" className="shrink-0 text-ok" /><span className="truncate">{preview.file_name}</span></span>
            <span>{t("Header on row {n}", { n: preview.header_row })}</span>
            {preview.mapped_by === "ai" ? <span className="inline-flex items-center gap-1 text-accent"><SparkleIcon size={13} weight="fill" /> {t("Columns read by AI. Check them.")}</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {preview.columns.map((c) => (
              <Pill key={c.field} className="max-w-full">
                <span className="truncate">{t("{field} from column {letter}", { field: t(FIELD_LABEL[c.field] ?? c.field), letter: c.letter })}{c.header ? ` (${c.header})` : ""}</span>
              </Pill>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone="ok">{t("{n} ready", { n: counts.ok })}</Pill>
            {counts.warn ? <Pill tone="warn">{t("{n} to check", { n: counts.warn })}</Pill> : null}
            {counts.error ? <Pill tone="danger">{t("{n} to fix", { n: counts.error })}</Pill> : null}
            {check.isPending ? <span className="text-[12px] text-muted">{t("Checking…")}</span> : null}
          </div>
          {preview.capped ? <p className="text-[12.5px] text-warn">{t("Only the first {n} people are read. Split the sheet and import the rest after.", { n: rows.length })}</p> : null}
          <div data-scroll-x className="max-h-[52dvh] min-w-0 overflow-auto rounded-[var(--radius-md)] border border-border">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface-2 text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Row")}</th>
                  <th className="px-3 py-2 font-medium">{t("Person")}</th>
                  <th className="px-3 py-2 font-medium">{t("Role")}</th>
                  <th className="px-3 py-2 font-medium">{t("Company and department")}</th>
                  <th className="px-3 py-2 font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <Row key={`${r.row}-${i}`} row={r} editable={r.status !== "ok" || r.notes_found.length > 0 || edited.has(i)} roles={roles} branches={branches} lockBranch={lockBranch} onFix={(field, patch) => fix(i, field, patch)} />
                ))}
              </tbody>
            </table>
          </div>
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Import members from Excel")} className="w-[min(96vw,36rem)]"
      description={t("Add many people at once from an Excel or CSV sheet. You check every row before anyone is added.")}
      footer={<Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>}>
      <ol className="grid gap-4">
        <li className="grid gap-2">
          <p className="text-[13.5px] font-medium">{t("1. Get the template (optional)")}</p>
          <p className="text-[12.5px] text-muted">{t("One person per row: name, email, role, company and department. Your own sheet works too; the columns are found by their headers, in English or Malay.")}</p>
          <Button size="sm" variant="outline" className="w-fit" loading={fetchingTemplate} onClick={() => void template()}><DownloadSimpleIcon size={15} /> {t("Download template")}</Button>
        </li>
        <li className="grid gap-2">
          <p className="text-[13.5px] font-medium">{t("2. Choose the filled-in file")}</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={cn("grid place-items-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-6 text-center transition-colors", over ? "border-accent bg-accent-soft" : "border-border bg-surface-2/40")}
          >
            <input ref={input} type="file" accept={SHEET_ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            <UploadSimpleIcon size={26} weight="duotone" className="text-accent" />
            <p className="text-[13.5px] font-medium">{read.isPending ? t("Reading the sheet…") : t("Drop the file here")}</p>
            <p className="text-[12px] text-muted">{t("Excel (.xlsx) or CSV, up to {n} rows.", { n: 500 })}</p>
            <Button size="sm" variant="outline" loading={read.isPending} onClick={() => input.current?.click()}>{t("Choose file")}</Button>
          </div>
          {read.error ? (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-danger"><WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0" /><span className="min-w-0">{errorMessage(read.error)}</span></p>
          ) : null}
        </li>
      </ol>
    </ResponsiveDialog>
  );
}
