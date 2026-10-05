import { CheckCircleIcon, FileIcon, MagicWandIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { docKeys, templatesQuery, type DocDetail, type DocTemplate, type FieldValue } from "@/lib/documents";
import { branchesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { KindTile } from "./visuals";

type Start = { kind: "template"; id: string } | { kind: "ai" } | { kind: "blank" };

export function NewDocumentDialog({ template, branchId, onClose, onCreated }: {
  template?: DocTemplate;
  branchId?: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: templates = [] } = useQuery(templatesQuery);
  const [start, setStart] = useState<Start>(template ? { kind: "template", id: template.id } : { kind: "template", id: "" });
  const [branch, setBranch] = useState(branchId ?? "");
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  // A document belongs to one company: the header's (or the last one picked), unless changed here.
  const { one } = useCompanies();
  const company = branch || one?.id || branches[0]?.id || "";
  const tpl = start.kind === "template" ? templates.find((x) => x.id === start.id) : undefined;

  const create = useMutation({
    mutationFn: async () => {
      const file_ids = files.map((f) => f.id);
      if (start.kind === "ai") {
        const { text } = await api<{ text: string }>("/api/documents/ai-write", "POST", { request, branch_id: company, file_ids });
        const heading = /^#\s+(.+)$/m.exec(text)?.[1];
        return api<DocDetail>("/api/documents", "POST", { branch_id: company, title: title || heading || "New document", body: text });
      }
      if (start.kind === "blank") {
        return api<DocDetail>("/api/documents", "POST", { branch_id: company, title: title || "New document", body: `# ${title || "Title"}\n\n` });
      }
      const doc = await api<DocDetail>("/api/documents", "POST", { branch_id: company, template_id: start.id, title });
      if (!request.trim()) return doc;
      const { values } = await api<{ values: Record<string, FieldValue> }>(`/api/documents/${doc.id}/ai-fill`, "POST", { request, file_ids });
      if (!Object.keys(values).length) return doc;
      return api<DocDetail>(`/api/documents/${doc.id}`, "PATCH", { values, note: "filled by AI from the request" });
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: docKeys.documents });
      toast.success(start.kind === "ai" ? tr("Drafted. Check every fact before you send it.") : tr("{name} created.", { name: d.title }));
      onCreated(d.id);
      onClose();
    },
  });

  const ready = !!company && (start.kind !== "template" || !!start.id) && (start.kind !== "ai" || request.trim().length > 5);
  const option = (on: boolean) => cn(
    "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
    on ? "border-accent bg-accent-soft/60 ring-2 ring-accent/15" : "border-border hover:border-accent/40 hover:bg-surface-2/60",
  );
  const tick = (on: boolean) => on ? <CheckCircleIcon size={18} weight="fill" className="absolute top-2.5 right-2.5 text-accent" /> : null;

  return (
    <>
      <ResponsiveDialog open={!picking} onOpenChange={(o) => !o && onClose()} title={t("New document")} className="w-[min(96vw,44rem)]"
        description={t("Pick the company and how to start. Company details fill in from its kit.")}
        footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
            {start.kind === "ai" ? <><MagicWandIcon size={15} /> {t("Draft it")}</> : request.trim() ? <><MagicWandIcon size={15} /> {t("Create and fill")}</> : t("Create")}
          </Button></>}>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Company")}</span>
              <Select value={company} onValueChange={setBranch} label={t("Company")} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            </div>
            <Field label={t("Title (optional)")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tpl ? t("{name} for …", { name: tpl.name }) : t("e.g. Proposal for Bina")} />
          </div>

          {!template ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t("Start from")}</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button type="button" className={option(start.kind === "ai")} onClick={() => setStart({ kind: "ai" })}>
                  <IconTile icon={MagicWandIcon} tone="violet" size="sm" />
                  <span className="grid min-w-0 gap-0.5 pr-5">
                    <span className="text-[13.5px] font-medium">{t("Write it with AI")}</span>
                    <span className="text-[12px] text-muted">{t("Describe the document; an agent writes the whole draft.")}</span>
                  </span>
                  {tick(start.kind === "ai")}
                </button>
                <button type="button" className={option(start.kind === "blank")} onClick={() => setStart({ kind: "blank" })}>
                  <IconTile icon={FileIcon} tone="neutral" size="sm" />
                  <span className="grid min-w-0 gap-0.5 pr-5">
                    <span className="text-[13.5px] font-medium">{t("Blank page")}</span>
                    <span className="text-[12px] text-muted">{t("Write it yourself on the letterhead.")}</span>
                  </span>
                  {tick(start.kind === "blank")}
                </button>
              </div>
              <p className="mt-1 text-[12px] font-medium text-muted">{t("Or a template")}</p>
              <div className="grid grid-cols-1 gap-2 p-0.5 sm:max-h-72 sm:grid-cols-2 sm:overflow-y-auto">
                {templates.map((x) => {
                  const on = start.kind === "template" && start.id === x.id;
                  return (
                    <button key={x.id} type="button" className={option(on)} onClick={() => setStart({ kind: "template", id: x.id })}>
                      <KindTile kind={x.kind} size="sm" />
                      <span className="grid min-w-0 gap-0.5 pr-5">
                        <span className="truncate text-[13.5px] font-medium">{x.name}</span>
                        <span className="line-clamp-2 text-[12px] text-muted">{x.description}</span>
                      </span>
                      {tick(on)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <TextareaField label={start.kind === "ai" ? t("What should it say?") : t("Describe it and let AI fill the fields (optional)")} rows={4}
            value={request} onChange={(e) => setRequest(e.target.value)}
            placeholder={start.kind === "ai"
              ? t("e.g. A one-page proposal to Syarikat Bina for monthly office cleaning, 3 visits a week, RM1,850 a month, starting January.")
              : t("e.g. Quote Syarikat Bina, Lot 5 Shah Alam, attn Encik Rahim: 12 months office cleaning at RM1,850 a month, valid 30 days.")}
            hint={start.kind === "blank" ? undefined : t("It uses only what you write and the files you attach — anything missing is left for you to fill, never invented.")} />

          {start.kind !== "blank" ? (
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {files.map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px]">
                    {f.name}
                    <button type="button" aria-label={t("Remove {name}", { name: f.name })} onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}><XIcon size={12} /></button>
                  </span>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setPicking(true)} disabled={files.length >= 5}>
                  <PaperclipIcon size={14} /> {t("Attach a file to work from")}
                </Button>
              </div>
            </div>
          ) : null}
          <FormError message={create.error ? errorMessage(create.error) : null} />
        </div>
      </ResponsiveDialog>
      <FilePicker open={picking} onOpenChange={setPicking} branchId={company || null} title={t("Attach a file to work from")}
        onPick={(f) => setFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
    </>
  );
}
