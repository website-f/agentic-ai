import {
  ArrowLeftIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  FolderSimpleIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, KIND_INFO, pageQuery, pagesQuery, type BrainPage, type PageSummary } from "@/lib/brain";
import { cn, timeAgo } from "@/lib/utils";

import { linkName, WikiMarkdown } from "./wiki-markdown";

const PROTECTED = new Set(["AGENTS.md", "log.md", "index.md"]);
const FOLDERS = [
  { value: "wiki/entities", label: "wiki/entities: people, companies, products" },
  { value: "wiki/topics", label: "wiki/topics: how things work" },
  { value: "wiki/decisions", label: "wiki/decisions: what was decided and why" },
  { value: "wiki/howto", label: "wiki/howto: step-by-step guides" },
  { value: "raw", label: "raw: sources kept as they were" },
];

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function Tree({ pages, selected, onSelect }: { pages: PageSummary[]; selected: string | null; onSelect: (path: string) => void }) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const m = new Map<string, PageSummary[]>();
    for (const p of pages) {
      if (f && !p.path.toLowerCase().includes(f) && !p.title.toLowerCase().includes(f)) continue;
      const k = folderOf(p.path);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [pages, filter]);

  return (
    <div className="grid content-start gap-2">
      <label className="relative block">
        <span className="sr-only">Filter pages</span>
        <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter pages" className="h-9 pl-8 text-[13px]" />
      </label>
      <nav aria-label="Vault pages" className="grid gap-1">
        {groups.map(([folder, items]) => (
          <details key={folder || "(top)"} open className="group">
            <summary className="flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-[12.5px] font-medium text-muted select-none hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
              <CaretRightIcon size={11} weight="bold" className="transition-transform group-open:rotate-90" />
              <FolderSimpleIcon size={14} />
              <span className="truncate">{folder || "Vault"}</span>
              <span className="ml-auto tabular">{items.length}</span>
            </summary>
            <ul className="mt-0.5 grid gap-px pl-4">
              {items.map((p) => (
                <li key={p.path}>
                  <button
                    onClick={() => onSelect(p.path)}
                    aria-current={p.path === selected ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2/70",
                      p.path === selected && "bg-accent-soft/70 font-medium text-fg",
                    )}
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: KIND_INFO[p.kind].color }} />
                    <span className="truncate">{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {!groups.length ? <p className="px-2 py-3 text-[13px] text-muted">No page matches.</p> : null}
      </nav>
    </div>
  );
}

function NewPageDialog({ open, onOpenChange, onCreated, initialName }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: BrainPage) => void; initialName?: string }) {
  const qc = useQueryClient();
  const [folder, setFolder] = useState("wiki/topics");
  const [name, setName] = useState(initialName ?? "");
  const slug = name.trim().replace(/[\\/]+/g, "-");
  const create = useMutation({
    mutationFn: () => api<BrainPage>("/api/brain/page", "PUT", { path: `${folder}/${slug}.md`, body: `# ${name.trim()}\n\n`, message: `Create ${name.trim()}` }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: brainKeys.all });
      onCreated(p);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="New page" description="One topic per page. Agents and people link to it with [[its-name]]."
      footer={<Button loading={create.isPending} disabled={!slug} onClick={() => create.mutate()}>Create page</Button>}>
      <div className="grid gap-4">
        <Select value={folder} onValueChange={setFolder} label="Folder" options={FOLDERS} />
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maju Trading" hint={slug ? `Saved as ${folder}/${slug}.md` : undefined} autoFocus />
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function PageView({ path, pages, canWrite, onOpen, onCreate, onBack }: {
  path: string;
  pages: PageSummary[];
  canWrite: boolean;
  onOpen: (path: string) => void;
  onCreate: (name: string) => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: page, isLoading, error } = useQuery(pageQuery(path));
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const byName = useMemo(() => {
    const m = new Map<string, { path: string; title: string }>();
    for (const p of pages) {
      const n = linkName(p.path);
      if (!m.has(n)) m.set(n, { path: p.path, title: p.title });
    }
    return m;
  }, [pages]);

  const save = useMutation({
    mutationFn: () => api<BrainPage>("/api/brain/page", "PUT", { path, body: draft ?? "", message: message.trim() || undefined }),
    onSuccess: (p) => {
      qc.setQueryData(brainKeys.page(path), p);
      qc.invalidateQueries({ queryKey: brainKeys.pages });
      qc.invalidateQueries({ queryKey: brainKeys.graph });
      setDraft(null);
      setMessage("");
      toast.success("Saved. Agents see the change from their next search.");
    },
  });

  if (isLoading) return <Skeleton className="h-80 rounded-[var(--radius-md)]" />;
  if (error || !page) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const editable = canWrite && path !== "index.md";
  const tags = page.frontmatter.tags;

  return (
    <article className="grid min-w-0 gap-5">
      <header className="grid gap-2">
        <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg lg:hidden">
          <ArrowLeftIcon size={14} /> All pages
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-tight">{page.title}</h2>
            <p className="mt-0.5 truncate font-mono text-[12px] text-muted">{page.path}</p>
          </div>
          {editable ? (
            <div className="flex gap-2">
              {draft === null ? (
                <Button size="sm" variant="outline" onClick={() => setDraft(page.body)}><PencilSimpleIcon size={14} /> Edit</Button>
              ) : (
                <>
                  <Button size="sm" loading={save.isPending} disabled={draft === page.body} onClick={() => save.mutate()}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                </>
              )}
              {!PROTECTED.has(page.path) && draft === null ? (
                <Button size="sm" variant="ghost" aria-label="Delete page" onClick={() => setDeleting(true)}><TrashIcon size={14} /></Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Pill><span aria-hidden className="size-2 rounded-full" style={{ background: KIND_INFO[page.kind].color }} />{KIND_INFO[page.kind].label}</Pill>
          {Array.isArray(tags) ? tags.map((t) => <Pill key={t} tone="neutral">#{t}</Pill>) : null}
          <span>Edited by {page.updated_by_name} {timeAgo(page.updated_at).toLowerCase()}</span>
        </div>
      </header>

      {draft !== null ? (
        <div className="grid gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={22} aria-label="Page (Markdown)" spellCheck
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed (optional, kept in the history)" className="h-9 text-[13px]" />
          <p className="text-[12px] text-muted">Markdown. Link pages with [[page-name]]; add tags in a --- frontmatter block.</p>
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4">
          <WikiMarkdown body={page.body || "_Empty page_"} title={page.title} resolve={(n) => byName.get(n) ?? null}
            onOpen={(p, name) => (p ? onOpen(p) : canWrite ? onCreate(name) : toast(`There is no page called “${name}” yet.`))} />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="grid content-start gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><LinkSimpleIcon size={14} /> Linked from <span className="font-normal text-muted">{page.backlinks.length}</span></h3>
          {page.backlinks.length ? (
            <ul className="grid gap-1">
              {page.backlinks.map((b) => (
                <li key={b.path}><button onClick={() => b.path && onOpen(b.path)} className="text-left text-[13px] text-accent hover:underline">{b.title ?? b.name}</button></li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-muted">No page links here yet.</p>}
          {page.links.length ? (
            <>
              <h3 className="mt-2 text-[13px] font-semibold">Links to</h3>
              <ul className="grid gap-1">
                {page.links.map((l) => (
                  <li key={l.name} className="text-[13px]">
                    {l.path ? <button onClick={() => onOpen(l.path!)} className="text-left text-accent hover:underline">{l.title ?? l.name}</button>
                      : <span className="text-muted">{l.name} <span className="text-[11.5px]">(no page yet)</span></span>}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section className="grid content-start gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><ClockCounterClockwiseIcon size={14} /> History</h3>
          <ol className="grid gap-1.5">
            {page.history.map((h) => (
              <li key={h.commit} className="grid text-[12.5px]">
                <span className="truncate">{h.message}</span>
                <span className="text-muted">{h.author} · {timeAgo(new Date(h.ts * 1000).toISOString()).toLowerCase()} · <span className="font-mono">{h.commit.slice(0, 7)}</span></span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title={`Delete ${page.title}?`} confirmLabel="Delete page"
        body="Agents stop finding it. The page stays in the vault's git history, so it can be brought back."
        onConfirm={async () => {
          try {
            await api(`/api/brain/page?path=${encodeURIComponent(path)}`, "DELETE");
            qc.invalidateQueries({ queryKey: brainKeys.all });
            toast.success("Page deleted.");
            onBack();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </article>
  );
}

export function PagesTab({ selected, onSelect, canWrite }: { selected: string | null; onSelect: (path: string | null) => void; canWrite: boolean }) {
  const { data: pages, isLoading, error } = useQuery(pagesQuery);
  const [creating, setCreating] = useState<{ n: number; name?: string } | null>(null);
  const knowledge = (pages ?? []).filter((p) => !["root", "log"].includes(p.kind)).length;

  if (isLoading) return <Skeleton className="h-96 rounded-[var(--radius-md)]" />;
  if (error || !pages) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={cn("grid content-start gap-3", selected && "max-lg:hidden")}>
        {canWrite ? <Button variant="outline" onClick={() => setCreating({ n: Date.now() })}><PlusIcon size={15} weight="bold" /> New page</Button> : null}
        <Tree pages={pages} selected={selected} onSelect={onSelect} />
      </aside>
      <div className={cn("min-w-0", !selected && "max-lg:hidden")}>
        {selected ? (
          <PageView key={selected} path={selected} pages={pages} canWrite={canWrite} onOpen={onSelect} onBack={() => onSelect(null)}
            onCreate={(name) => setCreating({ n: Date.now(), name })} />
        ) : (
          <EmptyState icon={FileTextIcon} title={knowledge ? "Pick a page" : "The wiki is empty"}
            body={knowledge ? "Pages are plain markdown with [[links]]. Agents read them when they recall, and write them when they learn something the team should know."
              : "Agents add pages as they work. You can start one too: a supplier, a client, how month-end works."}
            action={canWrite ? <Button onClick={() => setCreating({ n: Date.now() })}><PlusIcon size={15} weight="bold" /> New page</Button> : undefined} />
        )}
      </div>
      {creating ? (
        <NewPageDialog key={creating.n} open initialName={creating.name} onOpenChange={(o) => !o && setCreating(null)}
          onCreated={(p) => { setCreating(null); onSelect(p.path); }} />
      ) : null}
    </div>
  );
}
