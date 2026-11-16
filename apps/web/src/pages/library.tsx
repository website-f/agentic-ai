import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  BooksIcon,
  FileTextIcon,
  HourglassMediumIcon,
  MagnifyingGlassIcon,
  QuotesIcon,
  StackIcon,
  LockSimpleOpenIcon,
  BookOpenIcon,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FileDrop } from "@/components/file-drop";
import { LibraryStatusPill, parseScope, ScopeSelect, scopeOptions, WHOLE } from "@/components/library-toggle";
import { EmptyState, IconTile, Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DataTable, filterOf, RowMenu, TableFilter, useTableState, type BulkOutcome, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { bulkDelete } from "@/lib/bulk";
import { docKeys } from "@/lib/documents";
import {
  libraryKeys,
  libraryQuery,
  librarySearchQuery,
  reindexLibrary,
  setLibrary,
  setRestricted,
  type LibraryPassage,
  type LibrarySource,
} from "@/lib/library";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { workKeys } from "@/lib/work";
import { FileTile } from "./documents/visuals";
import { LibraryHeader } from "./library-hub/hub";
import { LinkedSources } from "./library-hub/linked-sources";

const STATUSES: { value: LibrarySource["status"]; label: string }[] = [
  { value: "indexed", label: msg("Indexed") },
  { value: "reading", label: msg("Reading…") },
  { value: "not_indexed", label: msg("Not indexed yet") },
  { value: "empty", label: msg("No text found") },
  { value: "failed", label: msg("Could not read") },
];

/** A row's id: files and SOPs can share an id, so the kind leads. */
const keyOf = (s: LibrarySource) => `${s.kind}:${s.id}`;

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
          <Pill tone="neutral">{p.source_kind === "sop" ? "SOP" : p.source_kind === "sharepoint" ? "SharePoint" : t("File")}</Pill>
        </div>
      </div>
      <p className="ml-8.5 line-clamp-6 text-[13px] leading-relaxed whitespace-pre-line text-fg/85 max-sm:ml-0">{p.text}</p>
      <div className="ml-8.5 flex flex-wrap items-center gap-2 max-sm:ml-0">
        <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-muted">
          <QuotesIcon size={12} /> {p.cite}
        </span>
        <Button size="sm" variant="ghost" asChild>
          {p.source_kind === "sharepoint" && p.url
            ? <a href={p.url} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={14} /> {t("Open in SharePoint")}</a>
            : p.source_kind === "file"
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
            <span className="sr-only">{t("Search the guidelines")}</span>
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("e.g. refund for damaged goods")} className="pl-9" />
          </label>
          <Button type="submit" loading={isFetching} disabled={draft.trim().length < 2}>{t("Search")}</Button>
        </form>
        {error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>
          : q && isFetched && !hits.length ? <p className="text-[13px] text-muted">{t("No guideline matches “{q}”. Try other words.", { q })}</p>
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
  const { data, isLoading, error, refetch } = useQuery(libraryQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const [removing, setRemoving] = useState<LibrarySource | null>(null);
  const sources = useMemo(() => data?.sources ?? [], [data]);
  const files = sources.filter((s) => s.kind === "file");
  const reading = files.filter((s) => s.status === "reading" || s.status === "not_indexed").length;
  const control = useTableState({ size: 25 }, { filters: ["kind", "status", "company", "restricted"] });
  const [kind] = filterOf(control, "kind");
  const [status] = filterOf(control, "status");
  const [company] = filterOf(control, "company");
  const [restricted] = filterOf(control, "restricted");
  const rows = useMemo(() => sources.filter((s) =>
    (!kind || s.kind === kind)
    && (!status || s.status === status)
    && (!company || (company === "none" ? !s.branch_id : s.branch_id === company))
    && (!restricted || !!s.restricted === (restricted === "yes"))), [sources, kind, status, company, restricted]);

  const reindex = useMutation({
    mutationFn: reindexLibrary,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(r.state === "done" ? tr("The library was indexed again.") : tr("Indexing again in the background."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const { data: me } = useQuery(meQuery);
  const canRestrict = !!data?.can_edit && !!me?.permissions.includes("office.view");
  const restrict = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setRestricted(id, on),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(v.on ? tr("Restricted: only its department's agents and managers read it now.") : tr("Open to every agent of the company now."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const takeOut = useMutation({
    mutationFn: (id: string) => setLibrary(id, false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.all });
      qc.invalidateQueries({ queryKey: docKeys.files });
      toast.success(tr("Taken out of the guidelines. The file itself is kept."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // P81: pick many and delete them: files for those who may change files, SOPs for those who
  // manage them (the server checks each one again).
  const canDeleteSops = !!me?.permissions.includes("org.manage");
  const pickableRow = (s: LibrarySource) => (s.kind === "file" ? !!data?.can_edit : canDeleteSops);
  const canPick = !!data?.can_edit || canDeleteSops;
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // P107: "Delete ticked" (the table's bulk bar and confirmation) deletes files and SOPs in one
  // call; what the server skips comes back as not done, with why.
  const deleteTicked = async (list: LibrarySource[]): Promise<BulkOutcome> => {
    try {
      const r = await bulkDelete({ files: list.filter((s) => s.kind === "file").map((s) => s.id), sops: list.filter((s) => s.kind === "sop").map((s) => s.id) });
      return {
        done: r.files + r.sops,
        failed: r.skipped.map((x) => ({ id: `${x.kind}:${x.id}`, message: x.reason === "not_found" ? tr("Already gone.") : tr("Not yours to delete.") })),
      };
    } finally {
      void qc.invalidateQueries({ queryKey: libraryKeys.all });
      void qc.invalidateQueries({ queryKey: docKeys.files });
      void qc.invalidateQueries({ queryKey: workKeys.sops });
    }
  };

  const open = (s: LibrarySource) =>
    s.kind === "file" ? navigate({ to: "/files", search: { f: s.id } }) : navigate({ to: "/sops", search: { sop: s.id } });

  const columns: Column<LibrarySource>[] = [
    {
      id: "title", header: t("Name"), card: "title", sortValue: (s) => s.title.toLowerCase(), exportValue: (s) => s.title,
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-3">
          {s.kind === "file" ? <FileTile mime={s.mime} name={s.name} /> : <IconTile icon={FileTextIcon} tone="violet" />}
          <span className="grid min-w-0">
            <span className="text-[13.5px] font-medium break-words">{s.title}</span>
            <span className="text-[12px] break-all text-muted">{s.kind === "sop" ? "SOP" : s.name !== s.title ? s.name : t("File")}</span>
          </span>
        </span>
      ),
    },
    { id: "scope", header: t("Who it is for"), sortValue: (s) => s.scope_label.toLowerCase(), exportValue: (s) => s.scope_label, cell: (s) => <ScopeText s={s} /> },
    {
      id: "pages", header: t("Pages"), kind: "number", align: "right", hideBelow: "xl", sortValue: (s) => s.pages || null,
      cell: (s) => (s.pages ? s.pages.toLocaleString(locale()) : <span className="text-muted">-</span>),
    },
    {
      id: "status", header: t("Status"), sortValue: (s) => s.status,
      exportValue: (s) => [t(STATUSES.find((x) => x.value === s.status)?.label ?? s.status), s.restricted ? t("Restricted") : ""].filter(Boolean).join(", "),
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-1">
          <LibraryStatusPill status={s.status} passages={s.passages} />
          {s.restricted ? <Pill tone="warn"><LockSimpleIcon size={12} weight="bold" /> {t("Restricted")}</Pill> : null}
        </span>
      ),
    },
    {
      id: "indexed", header: t("Indexed"), kind: "date", hideBelow: "lg", sortValue: (s) => s.indexed_at,
      cell: (s) => (s.indexed_at ? <span className="text-muted">{timeAgo(s.indexed_at)}</span> : <span className="text-muted">-</span>),
    },
  ];

  return (
    <Page>
      <LibraryHeader tab="/library"
        actions={<>
          {/* P24: a company's whole document set (zips, folders) goes in through Browse. */}
          <Button variant="ghost" asChild><Link to="/explorer">{t("Upload in Browse →")}</Link></Button>
          {data?.can_reindex ? (
            <Button variant="outline" loading={reindex.isPending} onClick={() => reindex.mutate()}>
              <ArrowClockwiseIcon size={16} /> {t("Index again")}
            </Button>
          ) : null}
        </>} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {data?.can_edit ? <AddGuidelines /> : null}
        <StatGrid className="grid-cols-2 content-start lg:grid-cols-2">
          <Stat label={t("Guidelines")} value={files.length} icon={BooksIcon} hint={t("Files agents search")} />
          <Stat label={t("SOPs")} value={sources.length - files.length} icon={FileTextIcon} tone="violet" hint={t("Searched by find_sop too")} />
          <Stat label={t("Passages")} value={data?.passages ?? 0} icon={StackIcon} tone="info" hint={t("What agents search")} />
          <Stat label={t("On the way")} value={reading} icon={HourglassMediumIcon} tone={reading ? "warn" : "neutral"} hint={t("Being read or indexed")} />
        </StatGrid>
      </div>

      {/* P80: SharePoint / OneDrive folders: the files stay there, only their text is kept. */}
      <LinkedSources />

      <TrySearch />

      {/* P107: guideline files and SOPs as one data table: search, kind / status / company
          filters, sortable columns, numbered pages; ticks for deleting many at once. */}
      <div data-guide="library.sources" className="grid min-w-0">
        <DataTable
          label={t("Guidelines and SOPs")}
          columns={columns}
          rows={rows}
          rowId={keyOf}
          rowLabel={(s) => s.title}
          control={control}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          searchText={(s) => `${s.title} ${s.name} ${s.scope_label}`}
          searchPlaceholder={t("Search guidelines and SOPs")}
          exportName={t("guidelines-and-sops")}
          onOpen={open}
          empty={<EmptyState icon={BooksIcon} title={t("No guidelines yet")} body={t("Upload SOPs, policies and manuals. Agents search them and cite the page.")} />}
          filters={
            <>
              <TableFilter control={control} id="kind" label={t("Show")} allLabel={t("Files and SOPs")}
                options={[{ value: "file", label: t("Files") }, { value: "sop", label: t("SOPs") }]} />
              <TableFilter control={control} id="status" label={t("Status")} allLabel={t("All statuses")}
                options={STATUSES.map((x) => ({ value: x.value, label: t(x.label) }))} />
              {branches.length > 1 ? (
                <TableFilter control={control} id="company" label={t("Company")} allLabel={t("All companies")}
                  options={[{ value: "none", label: t("Every company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
              ) : null}
              {sources.some((s) => s.restricted) ? (
                <TableFilter control={control} id="restricted" label={t("Who reads it")} allLabel={t("Restricted or open")}
                  options={[{ value: "yes", label: t("Restricted") }, { value: "no", label: t("Open to all agents") }]} />
              ) : null}
            </>
          }
          actions={(s) => (s.kind === "file" && (canRestrict || data?.can_edit) ? (
            <RowMenu label={t("Options for {name}", { name: s.title })}>
              {canRestrict ? (
                <MenuItem icon={s.restricted ? <LockSimpleOpenIcon /> : <LockSimpleIcon />} disabled={restrict.isPending}
                  onSelect={() => restrict.mutate({ id: s.id, on: !s.restricted })}>
                  {s.restricted ? t("Open to all agents") : t("Restrict")}
                </MenuItem>
              ) : null}
              {data?.can_edit ? <MenuItem icon={<BookOpenIcon />} onSelect={() => setRemoving(s)}>{t("Take out")}</MenuItem> : null}
            </RowMenu>
          ) : null)}
          selection={canPick ? { selected: ticked, onChange: setTicked, canSelect: pickableRow } : undefined}
          bulkRemove={canPick ? {
            run: (list) => deleteTicked(list),
            canRemove: pickableRow,
            title: (n) => (n === 1 ? t("Delete 1 item?") : t("Delete {n} items?", { n })),
            body: t("Files are deleted from Files and Browse too, and SOPs stop applying to every agent. Agents no longer find them. This cannot be undone."),
          } : undefined}
        />
      </div>

      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={t("Take this file out of the guidelines?")}
        confirmLabel={t("Take out")} body={t("Agents stop finding it in searches. The file stays in Files, and you can add it back any time.")}
        onConfirm={async () => { if (removing) await takeOut.mutateAsync(removing.id); }} />
    </Page>
  );
}
