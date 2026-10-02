import {
  ArrowCounterClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon,
  FilePdfIcon, MagicWandIcon, PaperclipIcon, PlusIcon, SealCheckIcon, SparkleIcon, TextAaIcon, TrashIcon,
  WarningCircleIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FilePicker } from "@/components/file-drop";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input, TextareaField } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import {
  docKeys, documentQuery, exportUrl, fileUrl, kitQuery, STATUS_LABEL, versionsQuery,
  type Check, type DocDetail, type DocStatus, type FieldValue, type LineItem, type TemplateField,
} from "@/lib/documents";
import { meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

type Values = Record<string, FieldValue>;

const QUICK: { label: string; instruction: string }[] = [
  { label: "Shorter", instruction: "Make it shorter and clearer, keeping every fact." },
  { label: "More formal", instruction: "Make it more formal and professional, for a business letter in Malaysia." },
  { label: "Friendlier", instruction: "Make it warmer and friendlier while staying professional." },
  { label: "Fix grammar", instruction: "Fix grammar, spelling and punctuation only. Change nothing else." },
  { label: "To Bahasa Melayu", instruction: "Translate into formal business Bahasa Melayu." },
  { label: "To English", instruction: "Translate into clear business English." },
];

const money = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------- fields

function ItemsEditor({ value, onChange, disabled }: { value: LineItem[]; onChange: (v: LineItem[]) => void; disabled?: boolean }) {
  const rows = value.length ? value : [];
  const set = (i: number, p: Partial<LineItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="@container grid gap-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_3.75rem_4.25rem_6rem_6rem_2rem] gap-2 px-1 text-[11.5px] font-medium text-muted @xl:grid">
        <span>Description</span><span>Qty</span><span>Unit</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
      </div>
      {rows.map((r, i) => (
        // Narrow column: description on its own row, numbers below. Wide: one row per line.
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2 rounded-sm border border-border p-2 @xl:grid-cols-[minmax(0,1fr)_3.75rem_4.25rem_6rem_6rem_2rem] @xl:rounded-none @xl:border-0 @xl:p-0">
          <Input value={r.description} disabled={disabled} onChange={(e) => set(i, { description: e.target.value })} placeholder="What it is" aria-label="Description" className="col-span-4 h-9 @xl:col-span-1" />
          <Input value={String(r.qty ?? "")} disabled={disabled} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" aria-label="Quantity" className="h-9" />
          <Input value={r.unit ?? ""} disabled={disabled} onChange={(e) => set(i, { unit: e.target.value })} placeholder="unit" aria-label="Unit" className="h-9" />
          <Input value={String(r.unit_price ?? "")} disabled={disabled} onChange={(e) => set(i, { unit_price: e.target.value })} inputMode="decimal" aria-label="Unit price" className="h-9 text-right" />
          <span className="col-span-3 text-right text-[13px] tabular-nums @xl:col-span-1">{money(num(r.qty || 1) * num(r.unit_price))}</span>
          <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label="Remove line" onClick={() => onChange(rows.filter((_, j) => j !== i))}><XIcon size={14} /></Button>
        </div>
      ))}
      <Button size="sm" variant="outline" className="w-fit" disabled={disabled} onClick={() => onChange([...rows, { description: "", qty: 1, unit: "", unit_price: "" }])}>
        <PlusIcon size={14} /> Add a line
      </Button>
    </div>
  );
}

function FieldInput({ f, value, onChange, disabled }: { f: TemplateField; value: FieldValue | undefined; onChange: (v: FieldValue) => void; disabled?: boolean }) {
  const label = `${f.label}${f.required ? " *" : ""}`;
  if (f.type === "items") {
    return (
      <div className="grid gap-1.5 sm:col-span-2">
        <span className="text-[13px] font-medium">{label}</span>
        <ItemsEditor value={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />
      </div>
    );
  }
  const str = Array.isArray(value) ? "" : String(value ?? "");
  if (f.type === "longtext") {
    return <TextareaField label={label} hint={f.hint} rows={3} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="sm:col-span-2" />;
  }
  if (f.type === "choice" && f.options?.length) {
    return (
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{label}</span>
        <Select value={str} onValueChange={onChange} label={f.label} disabled={disabled} placeholder="Choose" options={f.options.map((o) => ({ value: o, label: o }))} />
      </div>
    );
  }
  return (
    <Field label={label} hint={f.hint} value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" || f.type === "money" ? "decimal" : undefined} />
  );
}

// ---------------------------------------------------------------- checks and paper

function Checks({ checks, review, reviewing, onReview }: { checks: Check[]; review: Check[] | null; reviewing: boolean; onReview: () => void }) {
  const errors = checks.filter((c) => c.level === "error");
  const warns = checks.filter((c) => c.level === "warn");
  return (
    <section aria-label="Checks" className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {errors.length ? <WarningCircleIcon size={17} weight="fill" className="text-danger" />
            : warns.length ? <WarningIcon size={17} weight="fill" className="text-warn" />
            : <CheckCircleIcon size={17} weight="fill" className="text-ok" />}
          {errors.length ? `${errors.length} to fix` : warns.length ? `${warns.length} to look at` : "All checks pass"}
        </span>
        <Button size="sm" variant="ghost" loading={reviewing} onClick={onReview}><SparkleIcon size={14} /> Review with AI</Button>
      </div>
      {checks.length ? (
        <ul className="grid gap-1 text-[12.5px]">
          {[...errors, ...warns].map((c) => (
            <li key={c.text} className={cn("flex gap-2", c.level === "error" ? "text-danger" : "text-warn")}>
              <span aria-hidden>•</span><span className="text-fg">{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {review ? (
        <div className="grid gap-1 border-t border-border pt-2">
          <span className="text-[12px] font-medium text-muted">AI review</span>
          {review.length ? (
            <ul className="grid gap-1 text-[12.5px]">
              {review.map((c) => <li key={c.text} className="flex gap-2"><span aria-hidden className={c.level === "error" ? "text-danger" : "text-warn"}>•</span>{c.text}</li>)}
            </ul>
          ) : <p className="text-[12.5px] text-ok">Nothing to improve found.</p>}
        </div>
      ) : null}
    </section>
  );
}

function Paper({ doc, preview }: { doc: DocDetail; preview: string }) {
  const { data: kit } = useQuery({ ...kitQuery(doc.branch_id ?? ""), enabled: !!doc.branch_id });
  const data = (kit?.data ?? {}) as Record<string, string>;
  const accent = /^#[0-9a-f]{6}$/i.test(data.accent ?? "") ? data.accent : "#13895f";
  // Gaps show as amber chips: [[Client name]] -> `Client name`.
  const md = useMemo(() => preview.replace(/\[\[([^\]\n]+)\]\]/g, "`$1`"), [preview]);
  const contact = [data.phone, data.email, data.website].filter(Boolean).join("  ·  ");
  return (
    <article aria-label="Preview" className="paper min-h-[40rem] rounded-[var(--radius-md)] border border-border bg-white px-[7%] py-8 text-[#191919] shadow-[var(--shadow-soft)]">
      {data.legal_name ? (
        <header className="mb-6">
          <div className="flex items-start gap-4">
            {kit?.logo_file_id ? <img src={fileUrl(kit.logo_file_id, true)} alt="" className="h-11 w-auto max-w-24 object-contain" /> : null}
            <div className="min-w-0">
              <p className="text-[16px] font-bold">{data.legal_name}</p>
              {data.reg_no ? <p className="text-[11px] text-[#5f5f5f]">Registration No. {data.reg_no}</p> : null}
              {data.address ? <p className="text-[11px] text-[#5f5f5f]">{data.address.split("\n").join(", ")}</p> : null}
              {contact ? <p className="text-[11px] text-[#5f5f5f]">{contact}</p> : null}
            </div>
          </div>
          <div className="mt-3 h-[2px]" style={{ background: accent }} />
        </header>
      ) : (
        <p className="mb-5 rounded-sm bg-[#fff6dd] px-3 py-2 text-[12px] text-[#8a5a00]">
          No letterhead yet — fill in the <Link to="/company-kit" search={{ b: doc.branch_id ?? undefined }} className="underline">company kit</Link>.
        </p>
      )}
      <Markdown className="text-[13.5px]">{md || "*Empty*"}</Markdown>
    </article>
  );
}

// ---------------------------------------------------------------- the editor

export function DocumentEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: doc, error } = useQuery(documentQuery(id));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [values, setValues] = useState<Values>({});
  const [dirty, setDirty] = useState(false);
  const [live, setLive] = useState<DocDetail | null>(null);
  const [tab, setTab] = useState<string>("");
  const [review, setReview] = useState<Check[] | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [suggestion, setSuggestion] = useState<{ a: number; b: number; from: string; to: string } | null>(null);
  const [custom, setCustom] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  const [fillText, setFillText] = useState("");
  const [fillFiles, setFillFiles] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef<string>("");

  // Load the server copy once per version (and after saves), never over unsaved edits.
  useEffect(() => {
    if (!doc) return;
    const stamp = `${doc.id}:${doc.version}:${doc.status}`;
    if (loaded.current === stamp || dirty) return;
    loaded.current = stamp;
    setTitle(doc.title);
    setBody(doc.body);
    setValues(doc.values);
    setLive(null);
    setTab((t) => t || (doc.fields.length ? "fields" : "text"));
  }, [doc, dirty]);

  // Live preview and checks for unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      api<DocDetail>(`/api/documents/${id}/preview`, "POST", { body, values }).then(setLive).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [body, values, dirty, id]);

  const locked = doc?.status === "approved";
  const canApprove = !!me?.permissions.includes("approvals.decide");
  const shown = live ?? doc;

  const save = useMutation({
    mutationFn: () => api<DocDetail>(`/api/documents/${id}`, "PATCH", { title, body, values }),
    onSuccess: (d) => {
      qc.setQueryData(docKeys.document(id), d);
      qc.invalidateQueries({ queryKey: docKeys.documents });
      qc.invalidateQueries({ queryKey: docKeys.versions(id) });
      setDirty(false);
      setLive(null);
      toast.success("Saved.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveNow = useCallback(() => { if (dirty && !locked) save.mutate(); }, [dirty, locked, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  const setStatus = useMutation({
    mutationFn: async (status: DocStatus) => {
      if (dirty && !locked) await api<DocDetail>(`/api/documents/${id}`, "PATCH", { title, body, values });
      return api<DocDetail>(`/api/documents/${id}/status`, "POST", { status });
    },
    onSuccess: (d) => {
      qc.setQueryData(docKeys.document(id), d);
      qc.invalidateQueries({ queryKey: docKeys.documents });
      setDirty(false);
      setLive(null);
      toast.success(d.status === "approved" ? "Approved — it is locked now." : d.status === "review" ? "Sent for review." : "Reopened for changes.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rewrite = useMutation({
    mutationFn: (instruction: string) => {
      const s = sel!;
      return api<{ text: string }>(`/api/documents/${id}/rewrite`, "POST", { text: body.slice(s.a, s.b), instruction })
        .then((r) => ({ ...s, from: body.slice(s.a, s.b), to: r.text }));
    },
    onSuccess: setSuggestion,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const aiFill = useMutation({
    mutationFn: () => api<{ values: Values }>(`/api/documents/${id}/ai-fill`, "POST", { request: fillText, file_ids: fillFiles.map((f) => f.id) }),
    onSuccess: ({ values: v }) => {
      const n = Object.keys(v).length;
      if (!n) { toast.info("Nothing in that description matched the fields."); return; }
      setValues((cur) => ({ ...cur, ...v }));
      setDirty(true);
      setFillOpen(false);
      toast.success(`Filled ${n} field${n > 1 ? "s" : ""}. Check them, then save.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const aiReview = useMutation({
    mutationFn: async () => {
      if (dirty && !locked) await save.mutateAsync();
      return api<{ issues: Check[] }>(`/api/documents/${id}/review`, "POST");
    },
    onSuccess: (r) => setReview(r.issues),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: (version: number) => api<DocDetail>(`/api/documents/${id}/restore`, "POST", { version }),
    onSuccess: (d) => {
      qc.setQueryData(docKeys.document(id), d);
      qc.invalidateQueries({ queryKey: docKeys.versions(id) });
      setDirty(false);
      toast.success("Restored. The version before it is kept too.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const del = useMutation({
    mutationFn: () => api(`/api/documents/${id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: docKeys.documents }); toast.success("Deleted."); window.history.back(); },
  });

  const { data: versions = [] } = useQuery({ ...versionsQuery(id), enabled: tab === "history" });

  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!doc || !shown) return <div className="grid gap-4"><Skeleton className="h-12" /><Skeleton className="h-96" /></div>;

  const setValue = (k: string, v: FieldValue) => { setValues((s) => ({ ...s, [k]: v })); setDirty(true); };
  const status = STATUS_LABEL[doc.status];
  const errors = shown.checks.filter((c) => c.level === "error").length;
  const tabs = [
    ...(doc.fields.length ? [{ id: "fields", label: "Fields" }] : []),
    ...(!doc.word_template ? [{ id: "text", label: "Text" }] : []),
    { id: "history", label: "History" },
  ];
  const onSelect = () => {
    const el = area.current;
    if (!el) return;
    setSel(el.selectionEnd > el.selectionStart ? { a: el.selectionStart, b: el.selectionEnd } : null);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to="/documents" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"><ArrowLeftIcon size={14} /> All documents</Link>
        <span className="flex-1" />
        {dirty ? <span className="text-[12px] text-muted">Unsaved changes</span> : null}
        {!locked ? <Button size="sm" variant="outline" disabled={!dirty} loading={save.isPending} onClick={saveNow}>Save</Button> : null}
        <Menu>
          <MenuTrigger asChild><Button size="sm" variant="outline"><DownloadSimpleIcon size={14} /> Export</Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<FilePdfIcon />} onSelect={() => window.open(exportUrl(id, "pdf", true), "_blank", "noopener")}>Open PDF</MenuItem>
            <MenuItem icon={<DownloadSimpleIcon />} onSelect={() => { window.location.href = exportUrl(id, "pdf"); }}>Download PDF</MenuItem>
            <MenuItem icon={<DownloadSimpleIcon />} onSelect={() => { window.location.href = exportUrl(id, "docx"); }}>Download Word</MenuItem>
            <MenuItem icon={<DownloadSimpleIcon />} onSelect={() => { window.location.href = exportUrl(id, "xlsx"); }}>Download Excel</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>Delete document</MenuItem>
          </MenuContent>
        </Menu>
        {doc.status === "draft" ? <Button size="sm" variant="secondary" loading={setStatus.isPending} onClick={() => setStatus.mutate("review")}>Send for review</Button> : null}
        {doc.status !== "approved" && canApprove ? (
          <Button size="sm" disabled={errors > 0} title={errors ? "Fix the checks first" : undefined} loading={setStatus.isPending} onClick={() => setStatus.mutate("approved")}>
            <SealCheckIcon size={15} /> Approve
          </Button>
        ) : null}
        {doc.status === "approved" ? <Button size="sm" variant="outline" loading={setStatus.isPending} onClick={() => setStatus.mutate("draft")}>Reopen</Button> : null}
      </div>

      <div className="grid gap-1">
        <input value={title} disabled={locked} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} aria-label="Title"
          className="w-full bg-transparent text-[22px] font-semibold tracking-tight outline-none disabled:opacity-100" />
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Pill tone={status.tone}>{status.label}</Pill>
          {doc.number ? <Pill>{doc.number}</Pill> : null}
          {doc.branch_name ? <span>{doc.branch_name}</span> : null}
          {doc.template_name ? <span>· {doc.template_name}</span> : null}
          <span>· {doc.agent_name ? `drafted by ${doc.agent_name}` : "by a person"}</span>
          <span>· v{doc.version}, {timeAgo(doc.updated_at)}</span>
          {doc.task_id ? <Link to="/tasks" search={{ task: doc.task_id }} className="text-accent underline-offset-2 hover:underline">· open the task</Link> : null}
        </div>
      </div>

      {locked ? <p className="flex items-center gap-2 rounded-sm bg-ok/10 px-3 py-2 text-[13px] text-ok"><SealCheckIcon size={16} weight="fill" /> Approved — locked. Reopen it to make changes.</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="grid min-w-0 content-start gap-3">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List aria-label="Edit" className="mb-3 flex gap-1 border-b border-border">
              {tabs.map((t) => (
                <Tabs.Trigger key={t.id} value={t.id}
                  className="-mb-px border-b-2 border-transparent px-3 py-2 text-[13.5px] text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="fields" className="grid gap-3 outline-none">
              {!locked ? (
                fillOpen ? (
                  <div className="grid gap-2 rounded-[var(--radius-md)] border border-accent/40 bg-accent-soft/40 p-3">
                    <TextareaField label="Describe it" rows={3} value={fillText} onChange={(e) => setFillText(e.target.value)} autoFocus
                      placeholder="e.g. Quote Syarikat Bina, attn Encik Rahim: 12 months cleaning at RM1,850, valid 30 days."
                      hint="Only what you write (and attached files) is used; nothing is invented." />
                    <div className="flex flex-wrap items-center gap-2">
                      {fillFiles.map((f) => <Pill key={f.id}>{f.name}</Pill>)}
                      <Button size="sm" variant="ghost" onClick={() => setPicking(true)}><PaperclipIcon size={14} /> From a file</Button>
                      <span className="flex-1" />
                      <Button size="sm" variant="ghost" onClick={() => setFillOpen(false)}>Cancel</Button>
                      <Button size="sm" disabled={fillText.trim().length < 3} loading={aiFill.isPending} onClick={() => aiFill.mutate()}><MagicWandIcon size={14} /> Fill fields</Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="w-fit" onClick={() => setFillOpen(true)}><MagicWandIcon size={14} /> Fill with AI</Button>
                )
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {doc.fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key]} disabled={locked} onChange={(v) => setValue(f.key, v)} />)}
              </div>
              {shown.totals ? (
                <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-[var(--radius-md)] border border-border p-3 text-[13px] tabular-nums">
                  <dt className="text-muted">Subtotal</dt><dd className="text-right">{money(shown.totals.subtotal)}</dd>
                  {shown.totals.tax ? <><dt className="text-muted">Tax</dt><dd className="text-right">{money(shown.totals.tax)}</dd></> : null}
                  <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{money(shown.totals.total)}</dd>
                </dl>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value="text" className="grid gap-2 outline-none">
              {!locked ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-2">
                  <TextAaIcon size={16} className="text-muted" aria-hidden />
                  <span className="mr-1 text-[12px] text-muted">{sel ? `Rewrite ${sel.b - sel.a} selected characters:` : "Select text to rewrite it:"}</span>
                  {QUICK.map((q) => (
                    <button key={q.label} type="button" disabled={!sel || rewrite.isPending} onClick={() => rewrite.mutate(q.instruction)}
                      className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12px] enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-50">
                      {q.label}
                    </button>
                  ))}
                  <form className="flex min-w-0 flex-1 basis-48 gap-1.5" onSubmit={(e) => { e.preventDefault(); if (sel && custom.trim()) rewrite.mutate(custom.trim()); }}>
                    <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="or say how…" disabled={!sel} className="h-7 text-[12px]" aria-label="Custom rewrite instruction" />
                    <Button size="sm" type="submit" className="h-7" disabled={!sel || !custom.trim()} loading={rewrite.isPending}>Go</Button>
                  </form>
                </div>
              ) : null}
              {suggestion ? (
                <div className="grid gap-2 rounded-[var(--radius-md)] border border-accent/40 bg-accent-soft/40 p-3 text-[13px]">
                  <span className="text-[12px] font-medium text-muted">Suggested rewrite</span>
                  <p className="whitespace-pre-wrap text-muted line-through decoration-danger/50">{suggestion.from}</p>
                  <p className="whitespace-pre-wrap">{suggestion.to}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => {
                      setBody((b) => b.slice(0, suggestion.a) + suggestion.to + b.slice(suggestion.b));
                      setDirty(true); setSuggestion(null); setSel(null);
                    }}>Use it</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>Discard</Button>
                  </div>
                </div>
              ) : null}
              <textarea ref={area} value={body} disabled={locked} onSelect={onSelect} onChange={(e) => { setBody(e.target.value); setDirty(true); }}
                rows={22} spellCheck aria-label="Document text"
                className="min-h-[28rem] w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-80" />
              <p className="text-[12px] text-muted"># heading · **bold** · - list · | table | · {"{{placeholders}}"} fill from the fields and the company kit · \pagebreak starts a new page.</p>
            </Tabs.Content>

            <Tabs.Content value="history" className="outline-none">
              {!versions.length ? <p className="text-[13px] text-muted">No earlier versions yet. Every save keeps the one before.</p> : (
                <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {versions.map((v) => (
                    <li key={v.version} className="flex items-center gap-3 px-3 py-2.5">
                      <ClockCounterClockwiseIcon size={16} className="text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">Version {v.version}{v.note ? ` — ${v.note}` : ""}</span>
                        <span className="block text-[12px] text-muted">{timeAgo(v.created_at)} · {v.author.startsWith("agent:") ? "an agent" : "a person"}</span>
                      </span>
                      {!locked ? <Button size="sm" variant="ghost" loading={restore.isPending} onClick={() => restore.mutate(v.version)}><ArrowCounterClockwiseIcon size={14} /> Restore</Button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <div className="grid min-w-0 content-start gap-3">
          <Checks checks={shown.checks} review={review} reviewing={aiReview.isPending} onReview={() => aiReview.mutate()} />
          <Paper doc={doc} preview={shown.preview} />
        </div>
      </div>

      <FilePicker open={picking} onOpenChange={setPicking} branchId={doc.branch_id} title="Fill from a file"
        onPick={(f) => setFillFiles((fs) => (fs.some((x) => x.id === f.id) ? fs : [...fs, { id: f.id, name: f.name }]))} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Delete this document?" danger confirmLabel="Delete"
        body="Its versions go too. Packs that use it will show the item as missing." onConfirm={async () => { await del.mutateAsync(); }} />
    </div>
  );
}
