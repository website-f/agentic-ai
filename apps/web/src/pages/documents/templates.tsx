import { FileDocIcon, FilePlusIcon, PlusIcon, StackIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { EmptyState, IconTile, Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { BUILTIN_PLACEHOLDERS, docKeys, FIELD_TYPES, templatesQuery, type DocTemplate, type FieldType, type TemplateField } from "@/lib/documents";
import { NewDocumentDialog } from "./new-document";
import { LibraryHeader } from "../library-hub/hub";
import { KindTile } from "./visuals";

interface Draft {
  name: string;
  kind: string;
  description: string;
  body: string;
  fields: TemplateField[];
  prefix: string;
}

const KINDS = ["quotation", "invoice", "letter", "proposal", "minutes", "profile", "delivery", "custom"];
const KIND_LABEL: Record<string, string> = {
  quotation: msg("Quotation"), invoice: msg("Invoice"), letter: msg("Letter"), proposal: msg("Proposal"),
  minutes: msg("Minutes"), profile: msg("Profile"), delivery: msg("Delivery"), custom: msg("Custom"),
};

function TemplateDialog({ editing, onClose }: { editing?: DocTemplate; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => editing
    ? { name: editing.name, kind: editing.kind, description: editing.description, body: editing.body, fields: editing.fields, prefix: editing.prefix }
    : { name: "", kind: "custom", description: "", body: "# Title\n\nDear {{client_name}},\n\n\n\nYours faithfully,\n{{signature}}\n", fields: [], prefix: "" });
  const area = useRef<HTMLTextAreaElement>(null);
  const word = !!editing?.docx_file_id;
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));

  // Fields follow the placeholders in the text (debounced), keeping the settings people chose.
  useEffect(() => {
    if (word) return;
    const timer = setTimeout(() => {
      api<TemplateField[]>("/api/doc-templates/detect", "POST", { body: d.body, fields: d.fields })
        .then((fields) => setD((s) => ({ ...s, fields })))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the text drives detection
  }, [d.body, word]);

  const insert = (token: string) => {
    const el = area.current;
    if (!el) { set({ body: d.body + token }); return; }
    const { selectionStart: a, selectionEnd: b } = el;
    const body = d.body.slice(0, a) + token + d.body.slice(b);
    set({ body });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };
  const setField = (key: string, p: Partial<TemplateField>) =>
    set({ fields: d.fields.map((f) => (f.key === key ? { ...f, ...p } : f)) });

  const save = useMutation({
    mutationFn: () => editing
      ? api<DocTemplate>(`/api/doc-templates/${editing.id}`, "PATCH", d)
      : api<DocTemplate>("/api/doc-templates", "POST", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: docKeys.templates }); toast.success(tr("Template saved.")); onClose(); },
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={editing ? t("Edit {name}", { name: editing.name }) : t("New template")}
      description={t("Write the document once with {{placeholders}} where values go. Company details fill themselves in from the kit.")}
      className="w-[min(96vw,56rem)]"
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        <Button loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>{t("Save template")}</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]">
          <Field label={t("Name")} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("e.g. Service agreement")} autoFocus />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Kind")}</span>
            <Select value={d.kind} onValueChange={(kind) => set({ kind })} label={t("Kind")} options={KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k] ?? k) }))} />
          </div>
          <Field label={t("Number prefix")} value={d.prefix} onChange={(e) => set({ prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} placeholder="QT" hint="QT-2026-0001" />
        </div>
        <Field label={t("What it is for")} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("One line")} />
        {!word ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Text")}</span>
            <div className="flex flex-wrap gap-1.5">
              {BUILTIN_PLACEHOLDERS.map((p) => (
                <button key={p.token} type="button" onClick={() => insert(p.token)} title={p.token}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[12px] hover:border-accent hover:text-accent">+ {t(p.label)}</button>
              ))}
            </div>
            <textarea ref={area} value={d.body} onChange={(e) => set({ body: e.target.value })} rows={14} spellCheck
              className="min-h-64 w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              aria-label={t("Template text")} />
            <p className="text-[12px] text-muted">{t("# heading, **bold**, - list, | tables |. Type {{your_field}} for anything people or agents fill in; it appears below.")}</p>
          </div>
        ) : <p className="rounded-sm bg-surface-2 px-3 py-2 text-[13px]">{t("This template is your own Word file ({name}); its layout is kept. Change the text in Word and upload it again.", { name: editing?.docx_name ?? "" })}</p>}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("Fields to fill")}</legend>
          {!d.fields.length ? <p className="text-[12.5px] text-muted">{t("No fields yet — add a {{placeholder}} to the text.")}</p> : (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {d.fields.map((f) => (
                <li key={f.key} className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-center gap-2 px-3 py-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="grid gap-0.5 max-sm:col-span-2">
                    <Input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} aria-label={t("Label for {key}", { key: f.key })} className="h-8" />
                    <code className="text-[11px] text-muted">{`{{${f.key}}}`}</code>
                  </span>
                  <Select size="sm" value={f.type} onValueChange={(v) => setField(f.key, { type: v as FieldType })} label={t("Type")} options={FIELD_TYPES.map((ft) => ({ value: ft.value, label: t(ft.label) }))} />
                  <label className="flex items-center gap-1.5 text-[12.5px]">
                    <input type="checkbox" checked={f.required} onChange={(e) => setField(f.key, { required: e.target.checked })} className="accent-[var(--accent)]" /> {t("Required")}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function WordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(true);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const make = useMutation({
    mutationFn: () => api<DocTemplate>("/api/doc-templates/from-docx", "POST", { file_id: file!.id, name, prefix }),
    onSuccess: (made) => { qc.invalidateQueries({ queryKey: docKeys.templates }); toast.success(made.fields.length === 1 ? tr("“{name}” is ready with 1 field.", { name: made.name }) : tr("“{name}” is ready with {n} fields.", { name: made.name, n: made.fields.length })); onClose(); },
  });
  return (
    <>
      <ResponsiveDialog open={!picking} onOpenChange={(o) => !o && onClose()} title={t("Use your own Word file")}
        description={t("Type {{placeholders}} into the Word file where values go (e.g. {{client_name}}, {{company.reg_no}}, a table row with {{item.description}} {{item.qty}} {{item.amount}}). Its layout, fonts and letterhead are kept.")}
        footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!file || !name.trim()} loading={make.isPending} onClick={() => make.mutate()}>{t("Make template")}</Button></>}>
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-[13.5px]">
            <FileDocIcon size={18} weight="duotone" className="text-info" />
            <span className="min-w-0 flex-1 truncate">{file?.name ?? t("No file chosen")}</span>
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>{t("Choose")}</Button>
          </div>
          <Field label={t("Template name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Our quotation")} />
          <Field label={t("Number prefix (optional)")} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="QT" />
          <FormError message={make.error ? errorMessage(make.error) : null} />
        </div>
      </ResponsiveDialog>
      <FilePicker open={picking} onOpenChange={(o) => { setPicking(o); if (!o && !file) onClose(); }} title={t("Choose a Word file")}
        filter={(f) => f.mime.includes("wordprocessingml")}
        onPick={(f) => { setFile({ id: f.id, name: f.name }); setName((n) => n || f.name.replace(/\.docx$/i, "")); setPicking(false); }} />
    </>
  );
}

type Show = "all" | "starter" | "yours" | "word";

export function TemplatesPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data: templates = [], isLoading, error } = useQuery(templatesQuery);
  const [creating, setCreating] = useState(false);
  const [word, setWord] = useState(false);
  const [using, setUsing] = useState<DocTemplate | null>(null);
  // P107: the row menu's Edit opens this; Delete is the table's own confirmation.
  const [editing, setEditing] = useState<DocTemplate | null>(null);
  const qc = useQueryClient();
  // P107: a data table; search, filters and page live in the address.
  const control = useTableState({ size: 25 }, { filters: ["kind", "show"] });
  const kind = control.state.f.kind ?? "";
  const show = (control.state.f.show ?? "") as Show | "";
  const shown = templates.filter((x) =>
    (!show || show === "all" || (show === "starter" ? x.builtin : show === "word" ? !!x.docx_file_id : !x.builtin))
    && (!kind || x.kind === kind));
  const kinds = [...new Set(templates.map((x) => x.kind))].map((k) => ({ value: k, label: KIND_LABEL[k] ? t(KIND_LABEL[k]) : k }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const columns: Column<DocTemplate>[] = [
    {
      id: "name", header: t("Template"), card: "title", sortValue: (x) => x.name.toLowerCase(), exportValue: (x) => x.name,
      cell: (x) => (
        <span className="flex min-w-0 items-start gap-3">
          {x.docx_file_id ? <IconTile icon={FileDocIcon} tone="info" size="sm" /> : <KindTile kind={x.kind} size="sm" />}
          <span className="grid min-w-0 gap-0.5">
            <span className="text-[13.5px] font-semibold break-words">{x.name}</span>
            <span className="line-clamp-2 text-[12.5px] text-muted">{x.description || t("No description")}</span>
          </span>
        </span>
      ),
    },
    { id: "kind", header: t("Kind"), sortValue: (x) => (KIND_LABEL[x.kind] ? t(KIND_LABEL[x.kind]!) : x.kind), cell: (x) => (KIND_LABEL[x.kind] ? t(KIND_LABEL[x.kind]!) : x.kind) },
    {
      id: "origin", header: t("Type"), sortValue: (x) => (x.builtin ? 1 : 0),
      exportValue: (x) => [x.builtin ? t("Starter") : t("Yours"), x.docx_file_id ? t("Word layout") : ""].filter(Boolean).join(", "),
      cell: (x) => (
        <span className="flex flex-wrap gap-1">
          {x.builtin ? <Pill>{t("Starter")}</Pill> : <Pill tone="accent">{t("Yours")}</Pill>}
          {x.docx_file_id ? <Pill tone="info">{t("Word layout")}</Pill> : null}
        </span>
      ),
    },
    { id: "fields", header: t("Fields"), kind: "number", align: "right", hideBelow: "lg", sortValue: (x) => x.fields.length, cell: (x) => x.fields.length },
    {
      id: "used", header: t("Used"), kind: "number", align: "right", sortValue: (x) => x.used,
      cell: (x) => (x.used ? <span className="text-ok">{t("used {n}×", { n: x.used })}</span> : <span className="text-muted">0</span>),
    },
  ];
  return (
    <Page>
      <LibraryHeader tab="/templates"
        actions={<>
          <Button variant="outline" onClick={() => setWord(true)}><UploadSimpleIcon size={16} /> {t("Word template")}</Button>
          <Button data-guide="templates.new" onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New template")}</Button>
        </>} />
      {!isLoading && !error && !templates.length ? (
        <EmptyState icon={StackIcon} title={t("No templates")} body={t("Create one, or upload a Word file with {{placeholders}}.")} />
      ) : (
        <div data-guide="templates.list" className="min-w-0">
          <DataTable
            label={t("Templates")}
            columns={columns}
            rows={shown}
            rowId={(x) => x.id}
            rowLabel={(x) => x.name}
            control={control}
            loading={isLoading}
            error={error}
            onOpen={(x) => setUsing(x)}
            searchText={(x) => `${x.name} ${x.kind} ${KIND_LABEL[x.kind] ? t(KIND_LABEL[x.kind]!) : ""} ${x.description}`}
            searchPlaceholder={t("Search templates")}
            filters={
              <>
                {kinds.length > 1 ? <TableFilter control={control} id="kind" label={t("Kind")} allLabel={t("All kinds")} options={kinds} /> : null}
                <TableFilter control={control} id="show" label={t("Type")} allLabel={t("All types")}
                  options={[{ value: "starter", label: t("Starters") }, { value: "yours", label: t("Yours") }, { value: "word", label: t("Word layout") }]} />
              </>
            }
            exportName={t("templates")}
            actions={(x) => <Button size="sm" variant="outline" className="max-sm:hidden" onClick={() => setUsing(x)}><FilePlusIcon size={14} /> {t("Use it")}</Button>}
            rowActions={{
              edit: (x) => setEditing(x),
              more: (x) => <MenuItem icon={<FilePlusIcon />} onSelect={() => setUsing(x)}>{t("New document from it")}</MenuItem>,
              remove: async (x) => {
                await api(`/api/doc-templates/${x.id}`, "DELETE");
                void qc.invalidateQueries({ queryKey: docKeys.templates });
              },
              removeBody: () => t("Documents already made from it keep their text."),
            }}
          />
        </div>
      )}
      {creating ? <TemplateDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <TemplateDialog key={editing.id} editing={editing} onClose={() => setEditing(null)} /> : null}
      {word ? <WordDialog onClose={() => setWord(false)} /> : null}
      {using ? <NewDocumentDialog template={using} onClose={() => setUsing(null)}
        onCreated={(id) => navigate({ to: "/documents", search: { d: id } })} /> : null}
    </Page>
  );
}
