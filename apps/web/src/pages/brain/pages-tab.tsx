import {
  ArrowLeftIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  FolderSimpleIcon,
  LinkSimpleIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, KIND_INFO, pageQuery, pagesQuery, type BrainPage, type PageSummary } from "@/lib/brain";
import { cn, timeAgo } from "@/lib/utils";

import { linkName, WikiMarkdown } from "./wiki-markdown";

const PROTECTED = new Set(["AGENTS.md", "log.md", "index.md"]);
const FOLDERS = [
  { value: "wiki/entities", label: msg("wiki/entities: people, companies, products") },
  { value: "wiki/topics", label: msg("wiki/topics: how things work") },
  { value: "wiki/decisions", label: msg("wiki/decisions: what was decided and why") },
  { value: "wiki/howto", label: msg("wiki/howto: step-by-step guides") },
  { value: "raw", label: msg("raw: sources kept as they were") },
];

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function Tree({ pages, selected, onSelect }: { pages: PageSummary[]; selected: string | null; onSelect: (path: string) => void }) {
  const t = useT();
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
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2">
      <SearchInput guide="brain.search" value={filter} onChange={setFilter} placeholder={t("Filter pages")} className="basis-auto" />
      <nav aria-label={t("Vault pages")} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-1.5">
        {groups.map(([folder, items]) => (
          <details key={folder || "(top)"} open className="group min-w-0">
            <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-[12.5px] font-medium text-muted select-none hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
              <CaretRightIcon size={11} weight="bold" className="shrink-0 transition-transform group-open:rotate-90" />
              <FolderSimpleIcon size={15} weight="duotone" className="shrink-0" />
              <span className="min-w-0 truncate" title={folder || t("Vault")}>{folder || t("Vault")}</span>
              <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] tabular">{items.length}</span>
            </summary>
            <ul className="mt-0.5 ml-[13px] grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px border-l border-border pl-2">
              {items.map((p) => (
                <li key={p.path} className="min-w-0">
                  <button
                    type="button"
                    title={p.title}
                    onClick={() => onSelect(p.path)}
                    aria-current={p.path === selected ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2/70",
                      p.path === selected && "bg-accent-soft/70 font-medium text-fg",
                    )}
                  >
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: KIND_INFO[p.kind].color }} />
                    <span className="line-clamp-2 min-w-0 break-words">{p.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
        {!groups.length ? <p className="px-2 py-3 text-[13px] text-muted">{t("No page matches.")}</p> : null}
      </nav>
    </div>
  );
}

function NewPageDialog({ open, onOpenChange, onCreated, initialName }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: BrainPage) => void; initialName?: string }) {
  const t = useT();
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("New page")} description={t("One topic per page. Agents and people link to it with [[its-name]].")}
      footer={<Button loading={create.isPending} disabled={!slug} onClick={() => create.mutate()}>{t("Create page")}</Button>}>
      <div className="grid gap-4">
        <Select value={folder} onValueChange={setFolder} label={t("Folder")} options={FOLDERS.map((f) => ({ value: f.value, label: t(f.label) }))} />
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Maju Trading")} hint={slug ? t("Saved as {path}", { path: `${folder}/${slug}.md` }) : undefined} autoFocus />
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
  const t = useT();
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
      toast.success(tr("Saved. Agents see the change from their next search."));
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-28 rounded-[var(--radius-md)]" />
        <Skeleton className="h-72 rounded-[var(--radius-md)]" />
      </div>
    );
  }
  if (error || !page) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  const editable = canWrite && path !== "index.md";
  const tags = page.frontmatter.tags;

  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-9 w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg lg:hidden">
        <ArrowLeftIcon size={14} /> {t("All pages")}
      </button>
      <Card>
        <header className="grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
              <IconTile icon={FileTextIcon} size="md" tone="neutral" className="max-sm:hidden" />
              <div className="min-w-0">
                <h2 className="text-[20px] leading-tight font-semibold tracking-tight break-words">{page.title}</h2>
                <p className="mt-1 font-mono text-[12px] break-all text-muted">{page.path}</p>
              </div>
            </div>
            {editable ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {draft === null ? (
                  <Button size="sm" variant="outline" onClick={() => setDraft(page.body)}><PencilSimpleIcon size={14} /> {t("Edit")}</Button>
                ) : (
                  <>
                    <Button size="sm" loading={save.isPending} disabled={draft === page.body} onClick={() => save.mutate()}>{t("Save")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("Cancel")}</Button>
                  </>
                )}
                {!PROTECTED.has(page.path) && draft === null ? (
                  <Button size="icon-sm" variant="ghost" aria-label={t("Delete page")} onClick={() => setDeleting(true)}><TrashIcon size={15} /></Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Pill><span aria-hidden className="size-2 rounded-full" style={{ background: KIND_INFO[page.kind].color }} />{t(KIND_INFO[page.kind].label)}</Pill>
            {Array.isArray(tags) ? tags.map((tag) => <Pill key={tag} tone="neutral">#{tag}</Pill>) : null}
            <span className="min-w-0">{t("Edited by {name} {when}", { name: page.updated_by_name, when: timeAgo(page.updated_at).toLowerCase() })}</span>
          </div>
        </header>
        <div className="border-t border-border">
          {draft !== null ? (
            <div className="grid gap-2 p-4 sm:p-5">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={22} aria-label={t("Page (Markdown)")} spellCheck
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("What changed (optional, kept in the history)")} className="h-10 text-[13px]" />
              <p className="text-[12px] text-muted">{t("Markdown. Link pages with [[page-name]]; add tags in a --- frontmatter block.")}</p>
              <FormError message={save.error ? errorMessage(save.error) : null} />
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto px-4 py-4 sm:px-6 sm:py-5">
              <WikiMarkdown body={page.body || t("_Empty page_")} title={page.title} resolve={(n) => byName.get(n) ?? null}
                onOpen={(p, name) => (p ? onOpen(p) : canWrite ? onCreate(name) : toast(tr("There is no page called “{name}” yet.", { name })))} />
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Card>
          <CardHeader icon={<IconTile icon={LinkSimpleIcon} size="sm" tone="info" />} title={t("Links")}
            description={t("{in} in · {out} out", { in: page.backlinks.length, out: page.links.length })} />
          <CardBody className="grid gap-4">
            <section className="grid content-start gap-1.5">
              <h3 className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">{t("Linked from")}</h3>
              {page.backlinks.length ? (
                <ul className="grid gap-0.5">
                  {page.backlinks.map((b) => (
                    <li key={b.path} className="min-w-0">
                      <button type="button" onClick={() => b.path && onOpen(b.path)} className="min-h-8 text-left text-[13px] break-words text-accent hover:underline">{b.title ?? b.name}</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-muted">{t("No page links here yet.")}</p>}
            </section>
            {page.links.length ? (
              <section className="grid content-start gap-1.5">
                <h3 className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">{t("Links to")}</h3>
                <ul className="grid gap-0.5">
                  {page.links.map((l) => (
                    <li key={l.name} className="min-w-0 text-[13px]">
                      {l.path ? <button type="button" onClick={() => onOpen(l.path!)} className="min-h-8 text-left break-words text-accent hover:underline">{l.title ?? l.name}</button>
                        : <span className="break-words text-muted">{l.name} <span className="text-[11.5px]">{t("(no page yet)")}</span></span>}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<IconTile icon={ClockCounterClockwiseIcon} size="sm" tone="neutral" />} title={t("History")}
            description={page.history.length === 1 ? t("1 version in git") : t("{n} versions in git", { n: page.history.length })} />
          <ol className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
            {page.history.map((h) => (
              <li key={h.commit} className="grid min-w-0 gap-0.5 px-4 py-2.5 text-[12.5px] sm:px-5">
                <span className="break-words">{h.message}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-muted">
                  <Meta items={[h.author, timeAgo(new Date(h.ts * 1000).toISOString()).toLowerCase(), <span key="c" className="font-mono">{h.commit.slice(0, 7)}</span>]} />
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title={t("Delete {name}?", { name: page.title })} confirmLabel={t("Delete page")}
        body={t("Agents stop finding it. The page stays in the vault's git history, so it can be brought back.")}
        onConfirm={async () => {
          try {
            await api(`/api/brain/page?path=${encodeURIComponent(path)}`, "DELETE");
            qc.invalidateQueries({ queryKey: brainKeys.all });
            toast.success(tr("Page deleted."));
            onBack();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </article>
  );
}

export function PagesTab({ selected, onSelect, canWrite }: { selected: string | null; onSelect: (path: string | null) => void; canWrite: boolean }) {
  const t = useT();
  const { data: pages, isLoading, error } = useQuery(pagesQuery);
  const [creating, setCreating] = useState<{ n: number; name?: string } | null>(null);
  const knowledge = (pages ?? []).filter((p) => !["root", "log"].includes(p.kind)).length;

  if (isLoading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          <Skeleton className="h-10" />
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <Skeleton className="h-72 rounded-[var(--radius-md)] max-lg:hidden" />
      </div>
    );
  }
  if (error || !pages) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2", selected && "max-lg:hidden")}>
        {canWrite ? <Button variant="outline" onClick={() => setCreating({ n: Date.now() })}><PlusIcon size={15} weight="bold" /> {t("New page")}</Button> : null}
        <Tree pages={pages} selected={selected} onSelect={onSelect} />
      </aside>
      <div className={cn("min-w-0", !selected && "max-lg:hidden")}>
        {selected ? (
          <PageView key={selected} path={selected} pages={pages} canWrite={canWrite} onOpen={onSelect} onBack={() => onSelect(null)}
            onCreate={(name) => setCreating({ n: Date.now(), name })} />
        ) : (
          <EmptyState icon={FileTextIcon} title={knowledge ? t("Pick a page") : t("The wiki is empty")}
            body={knowledge ? t("Pages are plain markdown with [[links]]. Agents read them when they recall, and write them when they learn something the team should know.")
              : t("Agents add pages as they work. You can start one too: a supplier, a client, how month-end works.")}
            action={canWrite ? <Button onClick={() => setCreating({ n: Date.now() })}><PlusIcon size={15} weight="bold" /> {t("New page")}</Button> : undefined} />
        )}
      </div>
      {creating ? (
        <NewPageDialog key={creating.n} open initialName={creating.name} onOpenChange={(o) => !o && setCreating(null)}
          onCreated={(p) => { setCreating(null); onSelect(p.path); }} />
      ) : null}
    </div>
  );
}
