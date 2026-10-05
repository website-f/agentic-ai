import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  BooksIcon,
  FileTextIcon,
  HourglassMediumIcon,
  MagnifyingGlassIcon,
  QuotesIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FileDrop } from "@/components/file-drop";
import { LibraryStatusPill, parseScope, ScopeSelect, scopeOptions, WHOLE } from "@/components/library-toggle";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys } from "@/lib/documents";
import {
  libraryKeys,
  libraryQuery,
  librarySearchQuery,
  reindexLibrary,
  setLibrary,
  type LibraryPassage,
  type LibrarySource,
} from "@/lib/library";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { FileTile } from "./documents/visuals";

type Show = "all" | "file" | "sop";

function ScopeText({ s }: { s: LibrarySource }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span aria-hidden className={s.scope === "workspace" ? "size-1.5 rounded-full bg-accent" : s.scope === "branch" ? "size-1.5 rounded-full bg-info" : "size-1.5 rounded-full bg-warn"} />
      <span className="truncate">{s.scope_label}</span>
    </span>
  );
}

function Passage({ p }: { p: LibraryPassage }) {
  const t = useT();
  const where = [p.page ? t("p.{n}", { n: p.page }) : "", p.heading && p.heading !== p.title ? p.heading : ""].filter(Boolean).join(" — ");
  return (
    <li className="grid gap-2 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent tabular">{p.n}</span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium break-words">{p.title}</p>
            {where ? <p className="text-[12.5px] break-words text-muted">{where}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 max-sm:pl-8.5">
          {p.strong ? <Pill tone="ok">{t("Agents get this unasked")}</Pill> : null}
          <Pill tone="neutral">{p.source_kind === "sop" ? "SOP" : t("File")}</Pill>
        </div>
      </div>
      <p className="ml-8.5 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-line text-fg/85 max-sm:ml-0">{p.text}</p>
      <div className="ml-8.5 flex flex-wrap items-center gap-2 max-sm:ml-0">
        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted">
          <QuotesIcon size={12} /> {p.cite}
        </span>
        <Button size="sm" variant="ghost" asChild>
          {p.source_kind === "file"
            ? <Link to="/files" search={{ f: p.source_id }}><ArrowSquareOutIcon size={14} /> {t("Open the file")}</Link>
            : <Link to="/sops" search={{ sop: p.source_id }}><ArrowSquareOutIcon size={14} /> {t("Open the SOP")}</Link>}
        </Button>
      </div>
    </li>
  );
}

function TrySearch() {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const { data: hits = [], isFetching, error, isFetched } = useQuery(librarySearchQuery(q));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
  };
  return (
    <Card data-guide="library.search">
      <CardHeader icon={<IconTile icon={MagnifyingGlassIcon} size="sm" />} title={t("Try a search")}
        description={t("Ask the way an agent would. You see the passages it would find, with their page.")} />
      <CardBody className="grid gap-3">
        <form onSubmit={submit} className="flex flex-wrap gap-2 max-sm:[&>*]:w-full">
          <label className="relative min-w-0 flex-1 basis-60">
            <span className="sr-only">{t("Search the library")}</span>
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("e.g. refund for damaged goods")} className="pl-9" />
          </label>
          <Button type="submit" loading={isFetching} disabled={draft.trim().length < 2}>{t("Search")}</Button>
        </form>
        {error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>
          : q && isFetched && !hits.length ? <p className="text-[13px] text-muted">{t("Nothing in the library matches “{q}”. Try other words.", { q })}</p>
          : hits.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
              {hits.map((p) => <Passage key={`${p.source_id}-${p.n}`} p={p} />)}
            </ul>
          ) : null}
      </CardBody>
    </Card>
  );
}

function AddGuidelines() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const options = scopeOptions(me, branches);
  const [picked, setPicked] = useState<string | null>(null);
  const scope = picked && options.some((o) => o.value === picked) ? picked : (options[0]?.value ?? WHOLE);
  const target = parseScope(scope, branches);

  const onUploaded = async (files: { id: string; name: string }[]) => {
    let added = 0;
    for (const f of files) {
      try {
        await setLibrary(f.id, true, target);
        added += 1;
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    qc.invalidateQueries({ queryKey: libraryKeys.all });
    qc.invalidateQueries({ queryKey: docKeys.files });
    if (added) toast.success(added === 1 ? tr("Added to the library. It is indexed once it has been read.") : tr("{n} files added to the library.", { n: added }));
  };

  return (
    <Card data-guide="library.upload">
      <CardHeader icon={<IconTile icon={BooksIcon} size="sm" />} title={t("Add guidelines")}
        description={t("SOPs, policies, manuals, price rules. Pick who they are for, then drop the files.")} />
      <CardBody className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-[12.5px] font-medium text-muted">{t("Who it is for")}</span>
          <ScopeSelect value={scope} onChange={setPicked} className="w-full" />
        </label>
        <FileDrop compact branchId={target.branch_id} onUploaded={(fs) => void onUploaded(fs)} />
      </CardBody>
    </Card>
  );
}

export function LibraryPage() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery(libraryQuery);
  const [show, setShow] = useState<Show>("all");
  const [removing, setRemoving] = useState<LibrarySource | null>(null);
  const sources = data?.sources ?? [];
  const files = sources.filter((s) => s.kind === "file");
  const shown = show === "all" ? sources : sources.filter((s) => s.kind === show);
  const reading = files.filter((s) => s.status === "reading" || s.status === "not_indexed").length;

  const reindex = useMutation({
    mutationFn: reindexLibrary,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(r.state === "done" ? tr("The library was indexed again.") : tr("Indexing again in the background."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const takeOut = useMutation({
    mutationFn: (id: string) => setLibrary(id, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      qc.invalidateQueries({ queryKey: docKeys.files });
      toast.success(tr("Taken out of the library. The file itself is kept."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = (s: LibrarySource) =>
    s.kind === "file" ? navigate({ to: "/files", search: { f: s.id } }) : navigate({ to: "/sops", search: { sop: s.id } });

  return (
    <Page>
      <PageHeader title={t("Library")}
        description={t("The office's guidelines, manuals and policies, plus every SOP. Agents search them when the work needs it and cite the page they used.")}
        actions={<>
          {/* P24: a company's whole document set (zips, folders) goes in through Company files. */}
          <Button variant="ghost" asChild><Link to="/files">{t("Upload company documents →")}</Link></Button>
          {data?.can_reindex ? (
            <Button variant="outline" loading={reindex.isPending} onClick={() => reindex.mutate()}>
              <ArrowClockwiseIcon size={16} /> {t("Index again")}
            </Button>
          ) : null}
        </>} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {data?.can_edit ? <AddGuidelines /> : null}
        <StatGrid className="grid-cols-2 content-start lg:grid-cols-2">
          <Stat label={t("Guidelines")} value={files.length} icon={BooksIcon} hint={t("Files in the library")} />
          <Stat label={t("SOPs")} value={sources.length - files.length} icon={FileTextIcon} tone="violet" hint={t("Searched by find_sop too")} />
          <Stat label={t("Passages")} value={data?.passages ?? 0} icon={StackIcon} tone="info" hint={t("What agents search")} />
          <Stat label={t("On the way")} value={reading} icon={HourglassMediumIcon} tone={reading ? "warn" : "neutral"} hint={t("Being read or indexed")} />
        </StatGrid>
      </div>

      <TrySearch />

      <Toolbar>
        <Segmented<Show> label={t("Show")} value={show} onChange={setShow}
          options={[
            { value: "all", label: t("All"), count: sources.length },
            { value: "file", label: t("Files"), count: files.length },
            { value: "sop", label: t("SOPs"), count: sources.length - files.length },
          ]} />
      </Toolbar>

      {isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !shown.length ? (
          <EmptyState icon={BooksIcon} title={sources.length ? t("Nothing here") : t("The library is empty")}
            body={t("Upload SOPs, policies and manuals. Agents search them and cite the page.")} />
        ) : (
          <ListCard data-guide="library.sources">
            {shown.map((s) => (
              <ListRow key={`${s.kind}-${s.id}`}
                leading={s.kind === "file" ? <FileTile mime={s.mime} name={s.name} /> : <IconTile icon={FileTextIcon} tone="violet" />}
                title={
                  <button type="button" onClick={() => open(s)} className="max-w-full text-left break-words hover:text-accent hover:underline focus-visible:underline">
                    {s.title}
                  </button>
                }
                meta={<Meta items={[
                  s.kind === "sop" ? "SOP" : s.name !== s.title ? s.name : "",
                  <ScopeText key="scope" s={s} />,
                  s.pages ? (s.pages > 1 ? t("{n} pages", { n: s.pages }) : t("1 page")) : "",
                  s.indexed_at ? t("indexed {when}", { when: timeAgo(s.indexed_at).toLowerCase() }) : "",
                ]} />}
                trailing={<>
                  <LibraryStatusPill status={s.status} passages={s.passages} />
                  {s.kind === "file" && data?.can_edit ? (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(s)}>{t("Take out")}</Button>
                  ) : null}
                </>} />
            ))}
          </ListCard>
        )}

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={t("Take this file out of the library?")}
        confirmLabel={t("Take out")} body={t("Agents stop finding it in searches. The file stays in Files, and you can add it back any time.")}
        onConfirm={async () => { if (removing) await takeOut.mutateAsync(removing.id); }} />
    </Page>
  );
}
