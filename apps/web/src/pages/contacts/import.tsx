/** Import contacts from Excel or CSV: upload, check which column fills which field (the server
 * suggests a mapping), import, and see how many were added, updated or skipped. */
import { CheckCircleIcon, FileXlsIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { cleanMapping, IMPORT_FIELDS, importCommit, importPreview, isMissingApi, partyKeys, type ImportPreview, type ImportResult } from "@/lib/crm";

import { MissingBusiness } from "./bits";

const SKIP = "__skip";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");

  const upload = useMutation({
    mutationFn: importPreview,
    onSuccess: (p) => {
      setPreview(p);
      setMapping(p.mapping);
    },
  });
  const commit = useMutation({
    mutationFn: () => importCommit(cleanMapping(preview?.columns ?? [], mapping), preview?.rows ?? []),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: partyKeys.all });
    },
  });

  const reset = () => {
    setPreview(null);
    setMapping({});
    setResult(null);
    setFileName("");
    upload.reset();
    commit.reset();
  };
  const close = (o: boolean) => {
    if (upload.isPending || commit.isPending) return;
    onOpenChange(o);
    if (!o) reset();
  };

  const columns = preview?.columns ?? [];
  const rows = preview?.rows ?? [];
  const known = new Set(IMPORT_FIELDS.map((f) => f.value));
  const extra = [...new Set(Object.values(preview?.mapping ?? {}).filter((f): f is string => !!f && !known.has(f)))];
  const fieldOptions = [{ value: SKIP, label: t("Don't import") }, ...IMPORT_FIELDS.map((f) => ({ value: f.value, label: t(f.label) })), ...extra.map((f) => ({ value: f, label: f }))];
  const mapped = columns.filter((c) => mapping[c]);
  const hasName = Object.values(mapping).includes("name");
  // Each field fills from one column: picking it again moves it.
  const pick = (col: string, field: string) => {
    setMapping((m) => {
      const next: Record<string, string | null> = { ...m };
      if (field !== SKIP) for (const c of Object.keys(next)) if (next[c] === field) next[c] = null;
      next[col] = field === SKIP ? null : field;
      return next;
    });
  };

  let footer = null;
  if (result) footer = <Button onClick={() => close(false)}>{t("Done")}</Button>;
  else if (preview) {
    footer = (
      <>
        <Button variant="outline" onClick={reset} disabled={commit.isPending}>{t("Choose another file")}</Button>
        <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={!hasName || !rows.length}>
          {rows.length === 1 ? t("Import 1 row") : t("Import {n} rows", { n: rows.length })}
        </Button>
      </>
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={close} className="w-[min(96vw,48rem)]" title={t("Import contacts")}
      description={result ? undefined : preview ? t("Check which column goes where. Rows that match an existing contact (same name, email or TIN) update it.") : t("From an Excel or CSV file: one contact per row, with a header row.")}
      footer={footer}>
      {result ? (
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <CheckCircleIcon size={36} weight="duotone" className="text-ok" />
          <p className="text-[15px] font-semibold">{t("Import finished")}</p>
          <dl className="grid w-full max-w-sm grid-cols-3 gap-2">
            {([["created", t("Added")], ["updated", t("Updated")], ["skipped", t("Skipped")]] as const).map(([k, label]) => (
              <div key={k} className="rounded-[var(--radius-sm)] border border-border bg-surface-2/50 px-2 py-3">
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd className="text-[20px] font-semibold tabular">{result[k]}</dd>
              </div>
            ))}
          </dl>
          {result.skipped ? <p className="text-[12.5px] text-muted">{t("Skipped rows had no name, or repeated a row above them.")}</p> : null}
        </div>
      ) : !preview ? (
        <div className="grid gap-3">
          {upload.error ? (isMissingApi(upload.error) ? <MissingBusiness /> : <FormError message={errorMessage(upload.error)} />) : null}
          <div className="grid place-items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
            <FileXlsIcon size={34} weight="duotone" className="text-ok" />
            <p className="max-w-sm text-[13px] text-muted">{t("Columns like Name, Email, Phone, TIN, SSM number, Address and Payment terms are matched for you. You can change any of them next.")}</p>
            <input ref={input} type="file" hidden accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setFileName(f.name);
                upload.mutate(f);
              }} />
            <Button loading={upload.isPending} onClick={() => input.current?.click()}><UploadSimpleIcon size={16} weight="bold" /> {t("Choose a file")}</Button>
            {upload.isPending && fileName ? <p className="text-[12.5px] text-muted">{t("Reading {name}…", { name: fileName })}</p> : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <FormError message={commit.error ? errorMessage(commit.error) : null} />
          <p className="text-[12.5px] text-muted">{t("{name}: {n} rows found.", { name: fileName, n: rows.length })}</p>
          {!hasName ? <p role="alert" className="rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[12.5px]">{t("Pick the column that holds the name. Every contact needs one.")}</p> : null}
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {columns.map((c) => (
              <li key={c} className="grid grid-cols-[minmax(0,1fr)] items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{c}</p>
                  <p className="truncate text-[12px] text-muted">{cell(rows[0]?.[c]) || t("(empty)")}</p>
                </div>
                <Select value={mapping[c] ?? SKIP} onValueChange={(v) => pick(c, v)} label={t("Field for {column}", { column: c })} options={fieldOptions} className="w-full" />
              </li>
            ))}
          </ul>
          {mapped.length ? (
            <div className="grid gap-1.5">
              <p className="text-[12.5px] font-medium">{t("First rows as they will be imported")}</p>
              {/* Wide sheets scroll inside this box; the dialog itself never scrolls sideways. */}
              <div className="max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-border">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-surface-2/60">
                    <tr>{mapped.map((c) => <th key={c} scope="col" className="px-2.5 py-1.5 font-medium whitespace-nowrap">{t(IMPORT_FIELDS.find((f) => f.value === mapping[c])?.label ?? mapping[c] ?? c)}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>{mapped.map((c) => <td key={c} className="max-w-48 truncate px-2.5 py-1.5">{cell(r[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </ResponsiveDialog>
  );
}
