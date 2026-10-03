import {
  ArrowLeftIcon, CheckCircleIcon, CircleDashedIcon, DotsThreeIcon, DownloadSimpleIcon, FileTextIcon, FolderOpenIcon,
  ListChecksIcon, MagicWandIcon, MinusCircleIcon, PackageIcon, PlusIcon, RobotIcon, SealCheckIcon, StackIcon, TrashIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import {
  docKeys, documentsQuery, fileUrl, itemsIn, packQuery, packsQuery, STATUS_LABEL, templatesQuery,
  type DocDetail, type DocTemplate, type DraftItem, type Pack, type PackItem,
} from "@/lib/documents";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";
import { DocSteps } from "./visuals";

function Progress({ p }: { p: Pack["progress"] }) {
  const pct = p.required ? Math.round(((p.required - p.missing) / p.required) * 100) : 100;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-[12px] text-muted">
        <span>{p.missing ? `${p.missing} required item${p.missing > 1 ? "s" : ""} missing` : "Everything required is ready"}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full transition-[width]", p.missing ? "bg-accent" : "bg-ok")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Ring({ p, size = 44 }: { p: Pack["progress"]; size?: number }) {
  const pct = p.required ? Math.round(((p.required - p.missing) / p.required) * 100) : 100;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-label={`${pct}% ready`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} className="stroke-surface-2" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          className={cn("transition-[stroke-dashoffset] duration-500", p.missing ? "stroke-accent" : "stroke-ok")} />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular">{pct}%</span>
    </span>
  );
}

// ---------------------------------------------------------------- new pack

function ChecklistEditor({ items, onChange }: { items: DraftItem[]; onChange: (i: DraftItem[]) => void }) {
  const set = (i: number, p: Partial<DraftItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  return (
    <div className="grid gap-2">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input value={it.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Bank statement" aria-label="Item" className="h-9" />
          <Input value={it.hint ?? ""} onChange={(e) => set(i, { hint: e.target.value })} placeholder="What exactly (optional)" aria-label="Detail" className="h-9 max-sm:order-3 max-sm:col-span-2" />
          <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap">
            <input type="checkbox" checked={it.required ?? true} onChange={(e) => set(i, { required: e.target.checked })} className="accent-[var(--accent)]" /> Required
          </label>
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><XIcon size={14} /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit" onClick={() => onChange([...items, { label: "", hint: "", required: true }])}><PlusIcon size={14} /> Add an item</Button>
    </div>
  );
}

function NewPackDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: branches = [] } = useQuery(branchesQuery);
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const company = branch || branches[0]?.id || "";
  const draft = useMutation({
    mutationFn: () => api<{ items: DraftItem[] }>("/api/packs/draft-checklist", "POST", { description: description || title }),
    onSuccess: (r) => { setItems(r.items); toast.success(`${r.items.length} items proposed — edit them before creating.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => api<Pack>("/api/packs", "POST", { title, description, branch_id: company, items: items.filter((i) => i.label.trim()) }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: docKeys.packs }); onCreated(p.id); onClose(); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="New submission pack" className="w-[min(96vw,46rem)]"
      description="List what the submission needs. The office matches each item to the company's files and documents, then compiles one PDF for you to check and submit."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!title.trim() || !company} loading={create.isPending} onClick={() => create.mutate()}>Create pack</Button></>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cleaning services proposal — Agency X" autoFocus />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Company</span>
            <Select value={company} onValueChange={setBranch} label="Company" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </div>
        </div>
        <TextareaField label="What is it for?" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Proposal for 12 months of office cleaning for a government agency; they ask for company registration, 3 months bank statements, a company profile, a quotation and a cover letter." />
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium">Checklist</span>
            <Button size="sm" variant="outline" disabled={(description || title).trim().length < 5} loading={draft.isPending} onClick={() => draft.mutate()}>
              <MagicWandIcon size={14} /> Draft it with AI
            </Button>
          </div>
          <ChecklistEditor items={items} onChange={setItems} />
        </div>
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- pickers

function DocumentPicker({ open, onOpenChange, branchId, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; branchId: string | null; onPick: (id: string) => void }) {
  const { data: docs = [], isLoading } = useQuery({ ...documentsQuery(branchId ? { branch_id: branchId } : {}), enabled: open });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Choose a document" className="w-[min(96vw,38rem)]"
      description="A document prepared for this company.">
      <Link to="/documents" search={{ new: 1 }} className="mb-2 inline-block text-[13px] text-accent underline">Write a new one</Link>
      <ul className="grid max-h-[55dvh] gap-1 overflow-y-auto">
        {isLoading ? <li className="p-2 text-[13px] text-muted">Loading…</li> : !docs.length ? <li className="p-2 text-[13px] text-muted">No documents for this company yet.</li> : docs.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => { onPick(d.id); onOpenChange(false); }}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2">
              <FileTextIcon size={18} weight="duotone" className="text-accent" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{d.title}</span>
                <span className="block truncate text-[12px] text-muted">{[d.number, d.template_name, timeAgo(d.updated_at)].filter(Boolean).join(" · ")}</span>
              </span>
              <Pill tone={STATUS_LABEL[d.status].tone}>{STATUS_LABEL[d.status].label}</Pill>
            </button>
          </li>
        ))}
      </ul>
    </ResponsiveDialog>
  );
}

function AskAgentDialog({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: agents = [] } = useQuery(agentsQuery);
  const usable = agents.filter((a) => a.status === "active" && !a.clone_of);
  const here = usable.filter((a) => !pack.branch_id || a.branch_id === pack.branch_id);
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: () => api<{ task_id: string }>(`/api/packs/${pack.id}/delegate`, "POST", { agent_id: agentId, note }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: docKeys.pack(pack.id) });
      toast.success("On it. Follow along on the task.", { action: { label: "Open task", onClick: () => navigate({ to: "/tasks", search: { task: r.task_id } }) } });
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="Ask an agent to prepare it"
      description="The agent finds each missing item in the company's files, drafts the documents we write ourselves (cover letter, quotation, profile…), checks them, and asks you for anything only you can give. It never submits anything."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!agentId} loading={go.isPending} onClick={() => go.mutate()}><RobotIcon size={15} /> Start</Button></>}>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Agent</span>
          <Select value={agentId} onValueChange={setAgentId} label="Agent" placeholder="Pick an agent"
            options={(here.length ? here : usable).map((a) => ({ value: a.id, label: a.name, hint: `${a.role}, ${a.branch_name}` }))} />
        </div>
        <TextareaField label="Anything it should know (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Use the September bank statement. The quotation is 12 months at RM1,850." />
        <FormError message={go.error ? errorMessage(go.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- pack detail

/** Items that are documents we write ourselves map to a starter template. */
const WRITABLE: { re: RegExp; pick: (t: DocTemplate) => boolean }[] = [
  { re: /cover(ing)? letter|surat iringan/i, pick: (t) => /^cover letter/i.test(t.name) },
  { re: /company profile|profil syarikat/i, pick: (t) => t.kind === "profile" },
  { re: /quotation|sebut harga/i, pick: (t) => t.kind === "quotation" },
  { re: /invoice|invois/i, pick: (t) => t.kind === "invoice" },
  { re: /delivery order/i, pick: (t) => t.kind === "delivery" },
  { re: /minutes/i, pick: (t) => t.kind === "minutes" },
  { re: /proposal|scope of work|methodology/i, pick: (t) => t.kind === "proposal" },
];

function templateFor(label: string, templates: DocTemplate[]): DocTemplate | undefined {
  const rule = WRITABLE.find((w) => w.re.test(label));
  return rule ? templates.find(rule.pick) : undefined;
}

function ItemRow({ it, onChange, onPickFile, onPickDoc, draftWith, onDraft, drafting }: {
  it: PackItem;
  onChange: (p: Partial<PackItem> | null) => void;
  onPickFile: () => void;
  onPickDoc: () => void;
  draftWith?: DocTemplate;
  onDraft: () => void;
  drafting: boolean;
}) {
  const attached = it.file_name ?? it.document_title;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 max-sm:grid-cols-[auto_minmax(0,1fr)]">
      <span className="mt-0.5">
        {it.status === "ready" ? (it.expired ? <WarningIcon size={19} weight="fill" className="text-danger" /> : it.auto ? <CheckCircleIcon size={19} className="text-ok" /> : <CheckCircleIcon size={19} weight="fill" className="text-ok" />)
          : it.status === "waived" ? <MinusCircleIcon size={19} className="text-muted" />
          : <CircleDashedIcon size={19} className={it.required ? "text-warn" : "text-muted"} />}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <p className={cn("text-[13.5px] font-medium break-words", it.status === "waived" && "text-muted line-through")}>
          {it.label}{!it.required ? <span className="ml-1.5 text-[12px] font-normal text-muted">optional</span> : null}
        </p>
        {it.hint ? <p className="text-[12.5px] text-muted">{it.hint}</p> : null}
        {attached ? (
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="flex min-w-0 max-w-full items-center gap-1.5">
              {it.file_id ? <FolderOpenIcon size={13} className="shrink-0 text-muted" /> : <FileTextIcon size={13} className="shrink-0 text-muted" />}
              {it.file_id ? <a href={fileUrl(it.file_id, true)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-accent hover:underline">{attached}</a>
                : <Link to="/documents" search={{ d: it.document_id ?? undefined }} className="min-w-0 truncate text-accent hover:underline">{attached}</Link>}
            </span>
            {it.auto ? <Pill tone="info">matched — confirm</Pill> : null}
            {it.expired ? <Pill tone="danger">expired</Pill> : null}
          </p>
        ) : null}
        {it.note && (it.auto || it.expired) ? <p className={cn("text-[12px]", it.expired ? "text-danger" : "text-muted")}>{it.note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1 max-sm:col-start-2">
        {it.auto && it.status === "ready" ? <Button size="sm" variant="ghost" onClick={() => onChange({ auto: false, note: "" })}>Confirm</Button> : null}
        {it.status === "missing" && draftWith ? (
          <Button size="sm" variant="outline" loading={drafting} onClick={onDraft} title={`Start from the ${draftWith.name} template`}>
            <FileTextIcon size={14} /> Draft it
          </Button>
        ) : it.status === "missing" ? <Button size="sm" variant="outline" onClick={onPickFile}>Add file</Button> : null}
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Options for ${it.label}`}><DotsThreeIcon size={18} weight="bold" /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<FolderOpenIcon />} onSelect={onPickFile}>Choose a file</MenuItem>
            <MenuItem icon={<FileTextIcon />} onSelect={onPickDoc}>Choose a document</MenuItem>
            {attached ? <MenuItem icon={<XIcon />} onSelect={() => onChange({ file_id: null, document_id: null, auto: false, note: "", status: "missing" })}>Clear</MenuItem> : null}
            <MenuItem icon={<MinusCircleIcon />} onSelect={() => onChange({ status: it.status === "waived" ? "missing" : "waived" })}>
              {it.status === "waived" ? "Needed after all" : "Not needed"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<TrashIcon />} danger onSelect={() => onChange(null)}>Remove from checklist</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </li>
  );
}

function PackDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/packs" });
  const navigateAny = useNavigate();
  const { data: pack, error } = useQuery(packQuery(id));
  const { data: templates = [] } = useQuery(templatesQuery);
  const [fileFor, setFileFor] = useState<string | null>(null);
  const [docFor, setDocFor] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState("");
  const [removing, setRemoving] = useState(false);
  const put = (p: Pack) => { qc.setQueryData(docKeys.pack(id), p); qc.invalidateQueries({ queryKey: docKeys.packs }); };

  const update = useMutation({
    mutationFn: (items: DraftItem[]) => api<Pack>(`/api/packs/${id}`, "PATCH", { items }),
    onSuccess: put,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const match = useMutation({
    mutationFn: () => api<{ pack: Pack; matched: number }>(`/api/packs/${id}/auto-match`, "POST"),
    onSuccess: (r) => { put(r.pack); toast[r.matched ? "success" : "info"](r.matched ? `Matched ${r.matched} item${r.matched > 1 ? "s" : ""} — confirm each one.` : "No good matches. Upload the missing files, or ask an agent."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const compile = useMutation({
    mutationFn: () => api<{ pack: Pack; file_id: string; pages: number; skipped: string[] }>(`/api/packs/${id}/compile`, "POST"),
    onSuccess: (r) => {
      put(r.pack);
      qc.invalidateQueries({ queryKey: docKeys.files });
      toast.success(`Compiled: ${r.pages} pages.`, { action: { label: "Open", onClick: () => window.open(fileUrl(r.file_id, true), "_blank", "noopener") } });
      if (r.skipped.length) toast.warning(`Left out: ${r.skipped.join("; ")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const draft = useMutation({
    mutationFn: async ({ item, template }: { item: PackItem; template: DocTemplate }) => {
      const doc = await api<DocDetail>("/api/documents", "POST", {
        template_id: template.id, branch_id: pack!.branch_id, title: `${item.label} — ${pack!.title}`.slice(0, 200),
      });
      const items = itemsIn(pack!.items).map((i) => (i.id === item.id ? { ...i, document_id: doc.id, file_id: null, status: "ready", auto: false, note: "" } : i));
      await api<Pack>(`/api/packs/${id}`, "PATCH", { items });
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: docKeys.pack(id) });
      qc.invalidateQueries({ queryKey: docKeys.documents });
      toast.success(`${doc.title} started — fill it in, then come back.`);
      navigateAny({ to: "/documents", search: { d: doc.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/packs/${id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: docKeys.packs }); navigate({ search: {} }); },
  });

  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!pack) return <Skeleton className="h-96" />;

  const change = (itemId: string, p: Partial<PackItem> | null) =>
    update.mutate(itemsIn(p === null ? pack.items.filter((i) => i.id !== itemId) : pack.items.map((i) => (i.id === itemId ? { ...i, ...p } : i))));
  const missingAny = pack.items.some((i) => i.status === "missing");

  return (
    <div className="grid gap-5">
      <Link to="/packs" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeftIcon size={14} /> All packs</Link>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-3.5">
          <IconTile icon={PackageIcon} size="lg" className="hidden sm:grid" />
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words sm:text-[24px]">{pack.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
              <Meta items={[pack.branch_name, `${pack.progress.total} items`, `updated ${timeAgo(pack.updated_at)}`]} />
            </p>
            {pack.description ? <p className="mt-2 max-w-2xl text-[13.5px]">{pack.description}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>button:not([aria-label])]:flex-1">
          <Button variant="outline" disabled={!missingAny} loading={match.isPending} onClick={() => match.mutate()}><MagicWandIcon size={15} /> Auto-fill from files</Button>
          <Button variant="outline" onClick={() => setAsking(true)}><RobotIcon size={15} /> Ask an agent</Button>
          <Button loading={compile.isPending} onClick={() => compile.mutate()}><StackIcon size={15} /> Compile PDF</Button>
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><DotsThreeIcon size={20} weight="bold" /></Button></MenuTrigger>
            <MenuContent><MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete pack</MenuItem></MenuContent>
          </Menu>
        </div>
      </div>
      <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]">
        <Progress p={pack.progress} />
        {pack.compiled_file_id ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone={pack.status === "compiled" ? "ok" : "warn"}>{pack.status === "compiled" ? "Compiled" : "Changed since compiling"}</Pill>
            <span className="text-muted">{pack.compiled_at ? timeAgo(pack.compiled_at) : ""}</span>
            <Button size="sm" variant="outline" asChild><a href={fileUrl(pack.compiled_file_id, true)} target="_blank" rel="noreferrer">Open PDF</a></Button>
            <Button size="sm" variant="ghost" asChild><a href={fileUrl(pack.compiled_file_id)}><DownloadSimpleIcon size={14} /> Download</a></Button>
          </div>
        ) : null}
        {pack.task_id ? <Link to="/tasks" search={{ task: pack.task_id }} className="w-fit text-[12.5px] text-accent hover:underline">An agent is preparing this — open its task</Link> : null}
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        {pack.items.map((it) => (
          <ItemRow key={it.id} it={it} onChange={(p) => change(it.id, p)} onPickFile={() => setFileFor(it.id)} onPickDoc={() => setDocFor(it.id)}
            draftWith={templateFor(it.label, templates)} drafting={draft.isPending && draft.variables?.item.id === it.id}
            onDraft={() => { const t = templateFor(it.label, templates); if (t) draft.mutate({ item: it, template: t }); }} />
        ))}
        <li className="px-4 py-3">
          <form className="flex min-w-0 gap-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) { update.mutate([...itemsIn(pack.items), { label: adding.trim(), required: true }]); setAdding(""); } }}>
            <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add an item to the checklist" aria-label="New item" className="h-9" />
            <Button size="sm" type="submit" variant="outline" className="h-9" disabled={!adding.trim()}><PlusIcon size={14} /> Add</Button>
          </form>
        </li>
      </ul>
      <p className="text-[12.5px] text-muted">The office prepares the pack; a person checks it and submits it.</p>
      <FilePicker open={!!fileFor} onOpenChange={(o) => !o && setFileFor(null)} branchId={pack.branch_id}
        title={`File for "${pack.items.find((i) => i.id === fileFor)?.label ?? ""}"`}
        onPick={(f) => fileFor && change(fileFor, { file_id: f.id, document_id: null, auto: false, note: "", status: "ready" })} />
      <DocumentPicker open={!!docFor} onOpenChange={(o) => !o && setDocFor(null)} branchId={pack.branch_id}
        onPick={(d) => docFor && change(docFor, { document_id: d, file_id: null, auto: false, note: "", status: "ready" })} />
      {asking ? <AskAgentDialog pack={pack} onClose={() => setAsking(false)} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Delete this pack?" danger confirmLabel="Delete"
        body="The checklist goes; the files, documents and any compiled PDF stay." onConfirm={async () => { await del.mutateAsync(); }} />
    </div>
  );
}

export function PacksPage() {
  const search = useSearch({ from: "/app/packs" });
  const navigate = useNavigate({ from: "/packs" });
  const { data: packs = [], isLoading, error } = useQuery({ ...packsQuery, enabled: !search.p });
  const [creating, setCreating] = useState(false);
  if (search.p) return <Page><PackDetail key={search.p} id={search.p} /></Page>;
  return (
    <Page>
      <PageHeader title="Packs"
        description="Everything a submission needs, in one PDF. List the items, let the office match the company's files and documents (or ask an agent to prepare the rest), then compile it with a cover and contents for you to check and submit."
        actions={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New pack</Button>} />
      <DocSteps current="/packs" />
      {packs.length ? (
        <StatGrid className="lg:grid-cols-3">
          <Stat label="Packs" value={packs.length} icon={PackageIcon} hint="Checklists in progress" />
          <Stat label="Missing items" value={packs.reduce((n, p) => n + p.progress.missing, 0)} icon={ListChecksIcon}
            tone={packs.some((p) => p.progress.missing) ? "warn" : "neutral"} hint="Required, not attached yet" />
          <Stat label="Compiled" value={packs.filter((p) => p.status === "compiled").length} icon={SealCheckIcon} tone="ok" hint="PDF ready to check" className="max-lg:col-span-2" />
        </StatGrid>
      ) : null}
      {isLoading ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !packs.length ? (
          <EmptyState icon={PackageIcon} title="No packs yet"
            body="A pack is a checklist (registration certificate, bank statements, profile, quotation, cover letter) matched to real files and compiled into one PDF."
            action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New pack</Button>} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packs.map((p) => (
              <Card key={p.id} interactive className="p-0">
                <button type="button" onClick={() => navigate({ search: { p: p.id } })} className="grid h-full w-full content-start gap-4 p-4 text-left">
                  <div className="flex items-start gap-3">
                    <IconTile icon={PackageIcon} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[14px] font-semibold break-words">{p.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
                        <Meta items={[p.branch_name, `${p.progress.total} items`, timeAgo(p.updated_at)]} />
                      </span>
                    </span>
                    <Ring p={p.progress} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p.progress.missing ? <Pill tone="warn">{p.progress.missing} missing</Pill> : <Pill tone="ok">Everything required is ready</Pill>}
                    {p.status === "compiled" ? <Pill tone="ok"><SealCheckIcon size={12} weight="fill" /> Compiled</Pill> : null}
                    {p.task_id ? <Pill tone="info"><RobotIcon size={12} /> Agent on it</Pill> : null}
                  </div>
                </button>
              </Card>
            ))}
          </div>
        )}
      {creating ? <NewPackDialog onClose={() => setCreating(false)} onCreated={(id) => navigate({ search: { p: id } })} /> : null}
    </Page>
  );
}
