import { DotsThreeIcon, FileDocIcon, FilePlusIcon, NotePencilIcon, PencilSimpleIcon, PlusIcon, StackIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { BUILTIN_PLACEHOLDERS, docKeys, FIELD_TYPES, templatesQuery, type DocTemplate, type FieldType, type TemplateField } from "@/lib/documents";
import { NewDocumentDialog } from "./new-document";

interface Draft {
  name: string;
  kind: string;
  description: string;
  body: string;
  fields: TemplateField[];
  prefix: string;
}

const KINDS = ["quotation", "invoice", "letter", "proposal", "minutes", "profile", "delivery", "custom"];

function TemplateDialog({ editing, onClose }: { editing?: DocTemplate; onClose: () => void }) {
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
    const t = setTimeout(() => {
      api<TemplateField[]>("/api/doc-templates/detect", "POST", { body: d.body, fields: d.fields })
        .then((fields) => setD((s) => ({ ...s, fields })))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: docKeys.templates }); toast.success("Template saved."); onClose(); },
  });

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={editing ? `Edit ${editing.name}` : "New template"}
      description="Write the document once with {{placeholders}} where values go. Company details fill themselves in from the kit."
      className="w-[min(96vw,56rem)]"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} disabled={!d.name.trim()} onClick={() => save.mutate()}>Save template</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]">
          <Field label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Service agreement" autoFocus />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Kind</span>
            <Select value={d.kind} onValueChange={(kind) => set({ kind })} label="Kind" options={KINDS.map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }))} />
          </div>
          <Field label="Number prefix" value={d.prefix} onChange={(e) => set({ prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} placeholder="QT" hint="QT-2026-0001" />
        </div>
        <Field label="What it is for" value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="One line" />
        {!word ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Text</span>
            <div className="flex flex-wrap gap-1.5">
              {BUILTIN_PLACEHOLDERS.map((p) => (
                <button key={p.token} type="button" onClick={() => insert(p.token)} title={p.token}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[12px] hover:border-accent hover:text-accent">+ {p.label}</button>
              ))}
            </div>
            <textarea ref={area} value={d.body} onChange={(e) => set({ body: e.target.value })} rows={14} spellCheck
              className="min-h-64 w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              aria-label="Template text" />
            <p className="text-[12px] text-muted"># heading, **bold**, - list, | tables |. Type {"{{your_field}}"} for anything people or agents fill in; it appears below.</p>
          </div>
        ) : <p className="rounded-sm bg-surface-2 px-3 py-2 text-[13px]">This template is your own Word file ({editing?.docx_name}); its layout is kept. Change the text in Word and upload it again.</p>}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">Fields to fill</legend>
          {!d.fields.length ? <p className="text-[12.5px] text-muted">No fields yet — add a {"{{placeholder}}"} to the text.</p> : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {d.fields.map((f) => (
                <li key={f.key} className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-center gap-2 px-3 py-2 max-sm:grid-cols-1">
                  <span className="grid gap-0.5">
                    <Input value={f.label} onChange={(e) => setField(f.key, { label: e.target.value })} aria-label={`Label for ${f.key}`} className="h-8" />
                    <code className="text-[11px] text-muted">{`{{${f.key}}}`}</code>
                  </span>
                  <Select size="sm" value={f.type} onValueChange={(v) => setField(f.key, { type: v as FieldType })} label="Type" options={FIELD_TYPES} />
                  <label className="flex items-center gap-1.5 text-[12.5px]">
                    <input type="checkbox" checked={f.required} onChange={(e) => setField(f.key, { required: e.target.checked })} className="accent-[var(--accent)]" /> Required
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
  const qc = useQueryClient();
  const [picking, setPicking] = useState(true);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const make = useMutation({
    mutationFn: () => api<DocTemplate>("/api/doc-templates/from-docx", "POST", { file_id: file!.id, name, prefix }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: docKeys.templates }); toast.success(`"${t.name}" is ready with ${t.fields.length} field(s).`); onClose(); },
  });
  return (
    <>
      <ResponsiveDialog open={!picking} onOpenChange={(o) => !o && onClose()} title="Use your own Word file"
        description="Type {{placeholders}} into the Word file where values go (e.g. {{client_name}}, {{company.reg_no}}, a table row with {{item.description}} {{item.qty}} {{item.amount}}). Its layout, fonts and letterhead are kept."
        footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!file || !name.trim()} loading={make.isPending} onClick={() => make.mutate()}>Make template</Button></>}>
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-[13.5px]">
            <FileDocIcon size={18} weight="duotone" className="text-info" />
            <span className="min-w-0 flex-1 truncate">{file?.name ?? "No file chosen"}</span>
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}>Choose</Button>
          </div>
          <Field label="Template name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Our quotation" />
          <Field label="Number prefix (optional)" value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="QT" />
          <FormError message={make.error ? errorMessage(make.error) : null} />
        </div>
      </ResponsiveDialog>
      <FilePicker open={picking} onOpenChange={(o) => { setPicking(o); if (!o && !file) onClose(); }} title="Choose a Word file"
        filter={(f) => f.mime.includes("wordprocessingml")}
        onPick={(f) => { setFile({ id: f.id, name: f.name }); setName((n) => n || f.name.replace(/\.docx$/i, "")); setPicking(false); }} />
    </>
  );
}

function Card({ t, onUse }: { t: DocTemplate; onUse: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/api/doc-templates/${t.id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: docKeys.templates }); toast.success(`${t.name} deleted.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent">
          {t.docx_file_id ? <FileDocIcon size={18} weight="duotone" /> : <NotePencilIcon size={18} weight="duotone" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{t.name}</p>
          <p className="line-clamp-2 text-[12.5px] text-muted">{t.description || "No description"}</p>
        </div>
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Options for ${t.name}`}><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<FilePlusIcon />} onSelect={onUse}>New document from it</MenuItem>
            <MenuItem icon={<PencilSimpleIcon />} onSelect={() => setEditing(true)}>Edit</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {t.builtin ? <Pill>Starter</Pill> : null}
        {t.docx_file_id ? <Pill tone="info">Word layout</Pill> : null}
        <Pill>{t.fields.length} fields</Pill>
        {t.used ? <Pill tone="accent">used {t.used}×</Pill> : null}
      </div>
      <Button size="sm" variant="outline" className="w-fit" onClick={onUse}><FilePlusIcon size={14} /> Use it</Button>
      {editing ? <TemplateDialog editing={t} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Delete ${t.name}?`} danger confirmLabel="Delete"
        body="Documents already made from it keep their text." onConfirm={async () => { await del.mutateAsync(); }} />
    </div>
  );
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const { data: templates = [], isLoading, error } = useQuery(templatesQuery);
  const [creating, setCreating] = useState(false);
  const [word, setWord] = useState(false);
  const [using, setUsing] = useState<DocTemplate | null>(null);
  return (
    <Page>
      <PageHeader title="Templates"
        description="Step 2: the documents you write again and again. Start from the starters, write your own with {{placeholders}}, or upload your own Word file and keep its layout."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setWord(true)}><UploadSimpleIcon size={16} /> Word template</Button>
          <Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New template</Button>
        </div>} />
      {isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !templates.length ? <EmptyState icon={StackIcon} title="No templates" body="Create one, or upload a Word file with {{placeholders}}." />
        : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{templates.map((t) => <Card key={t.id} t={t} onUse={() => setUsing(t)} />)}</div>}
      {creating ? <TemplateDialog onClose={() => setCreating(false)} /> : null}
      {word ? <WordDialog onClose={() => setWord(false)} /> : null}
      {using ? <NewDocumentDialog template={using} onClose={() => setUsing(null)}
        onCreated={(id) => navigate({ to: "/documents", search: { d: id } })} /> : null}
    </Page>
  );
}
