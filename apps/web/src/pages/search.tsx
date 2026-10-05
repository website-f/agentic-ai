/** P25: search inside every document. One box; results grouped by type, each with the page
 * it is on and the words that matched; a click opens the file at that page. */
import { BuildingsIcon, ClockCounterClockwiseIcon, FileMagnifyingGlassIcon, FileTextIcon, MagnifyingGlassIcon, SparkleIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Marked, SearchField, TYPE_ICON, useOpenTarget } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { ListCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { KINDS } from "@/lib/intake";
import { HIT_TYPES, searchQuery, suggestQuery, type HitType, type SearchFilters, type SearchHit } from "@/lib/search";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { kindVisual } from "./documents/visuals";

const ANY = "__any";
type Search = { q?: string; type?: HitType; kind?: string; dept?: string; source?: "upload" | "agent" | "person" };

const GROUP_TITLE: Record<HitType, string> = {
  file: "Company files",
  sop: "SOPs",
  document: "Documents",
  template: "Templates",
  page: "Wiki pages",
};

function HitIcon({ h }: { h: SearchHit }) {
  if (h.type === "file") {
    const v = kindVisual(h.kind);
    return <IconTile icon={v.icon} tone={v.tone} size="sm" />;
  }
  return <IconTile icon={h.type === "sop" ? FileTextIcon : TYPE_ICON[h.type]} tone={h.type === "sop" ? "accent" : h.type === "page" ? "violet" : "info"} size="sm" />;
}

function HitRow({ h, more = 0 }: { h: SearchHit; more?: number }) {
  const t = useT();
  const open = useOpenTarget();
  const kind = h.type === "file" && h.kind ? KINDS.find((k) => k.key === h.kind.toLowerCase()) : undefined;
  const meta = [h.company, h.folder, h.department, kind ? (kind.key === "sop" ? "SOP" : t(kind.label)) : ""].filter(Boolean);
  if (h.type !== "file" && h.subtitle && !meta.length) meta.push(h.subtitle);
  return (
    <li>
      <button
        type="button"
        onClick={() => open(h.url, h.type, h.branch_id)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2/70 focus-visible:outline-none"
      >
        <HitIcon h={h} />
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-[14px] font-medium break-words [overflow-wrap:anywhere]">{h.title}</span>
            {h.page ? <Pill tone="accent" className="tabular">{t("p.{n}", { n: h.page })}</Pill> : null}
            {h.draft ? <Pill tone="warn">{t("Draft")}</Pill> : null}
            {more > 0 ? <span className="text-[12px] text-muted">{t("+{n} more pages", { n: more })}</span> : null}
          </span>
          {h.heading ? <Marked html={h.heading} className="text-[12.5px] font-medium text-muted" /> : null}
          {h.snippet ? <Marked html={h.snippet} className="line-clamp-3 text-[13px] leading-relaxed break-words [overflow-wrap:anywhere]" /> : null}
          {meta.length ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
              {meta.map((m, i) => (
                <Fragment key={i}>
                  {i ? <span aria-hidden>·</span> : null}
                  <span className="min-w-0 break-words">{m}</span>
                </Fragment>
              ))}
              {h.via.includes("meaning") && !h.via.some((v) => v === "and" || v === "text") ? (
                <span className="inline-flex items-center gap-1"><span aria-hidden>·</span><SparkleIcon size={12} /> {t("Similar meaning")}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function Recent({ onPick }: { onPick: (q: string) => void }) {
  const t = useT();
  const { data } = useQuery(suggestQuery("", undefined));
  const recent = (data?.suggestions ?? []).filter((s) => s.kind === "recent");
  if (!recent.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><ClockCounterClockwiseIcon size={14} /> {t("Recent")}</span>
      {recent.map((r) => (
        <button key={r.text} type="button" onClick={() => onPick(r.text)}
          className="rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] hover:border-accent/40 hover:bg-accent-soft hover:text-accent">
          {r.text}
        </button>
      ))}
    </div>
  );
}

export function SearchPage() {
  const t = useT();
  const search = useSearch({ from: "/app/search" }) as Search;
  const navigate = useNavigate({ from: "/search" });
  const co = useCompanies();
  const phone = useIsPhone();
  const q = (search.q ?? "").trim();
  const branch = co.isAll ? null : co.selected;
  const filters: SearchFilters = {
    q,
    branch_id: branch?.id,
    type: search.type,
    kind: search.kind,
    department_id: search.dept,
    source: search.source,
  };
  const res = useInfiniteQuery(searchQuery(filters));
  // Counts per type for the tabs come from the same search without the type.
  const all = useInfiniteQuery({ ...searchQuery({ ...filters, type: undefined }), enabled: !!q && !!search.type });
  const pages = res.data?.pages ?? [];
  const hits = pages.flatMap((p) => p.hits);
  const first = pages[0];
  const groups = (search.type ? all.data?.pages[0]?.groups : first?.groups) ?? {};
  const total = search.type ? (all.data?.pages[0]?.total ?? 0) : (first?.total ?? 0);
  const corrected = first?.corrected ?? [];

  const set = (patch: Partial<Search>) => void navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  // A file shows up to 3 of its pages; the first one says how many more matched.
  const more = useMemo(() => {
    const shown = new Map<string, number>();
    for (const h of hits) if (h.type === "file") shown.set(h.id, (shown.get(h.id) ?? 0) + 1);
    const first = new Map<string, number>();
    const seen = new Set<string>();
    for (const h of hits) {
      if (h.type !== "file" || seen.has(h.id)) continue;
      seen.add(h.id);
      first.set(`${h.id}:${h.page ?? ""}`, Math.max(0, h.pages_matched - (shown.get(h.id) ?? 1)));
    }
    return first;
  }, [hits]);
  const byType = useMemo(() => {
    const m = new Map<HitType, SearchHit[]>();
    for (const h of hits) m.set(h.type, [...(m.get(h.type) ?? []), h]);
    return HIT_TYPES.filter((ty) => m.has(ty)).map((ty) => ({ type: ty, hits: m.get(ty)! }));
  }, [hits]);

  const companyOptions = [...(co.canAll ? [{ value: ALL_COMPANIES, label: t("All companies") }] : []), ...co.branches.map((b) => ({ value: b.id, label: b.name }))];
  const kindOptions = [{ value: ANY, label: t("Any kind") }, ...KINDS.map((k) => ({ value: k.key, label: k.key === "sop" ? "SOP" : t(k.label) }))];
  const deptOptions = [
    { value: ANY, label: t("Any department") },
    { value: "none", label: t("No department") },
    ...(branch?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const sourceOptions = [
    { value: ANY, label: t("Made or uploaded") },
    { value: "upload", label: t("Uploaded") },
    { value: "agent", label: t("Made by AI") },
    { value: "person", label: t("Made by a person") },
  ];
  const typeOptions = [
    { value: "all" as const, label: t("All"), count: q ? total : undefined },
    ...HIT_TYPES.map((ty) => ({ value: ty, label: t(GROUP_TITLE[ty]), count: q ? (groups[ty] ?? 0) : undefined })),
  ];
  const filtered = !!(search.kind || search.dept || search.source || search.type);

  return (
    <Page>
      <PageHeader
        title={t("Search documents")}
        description={t("Search inside every document your company has: files page by page, SOPs, prepared documents, templates and wiki pages.")}
      />
      <div className="grid gap-3">
        {/* Phones: no auto focus (the keyboard would cover the page). */}
        <SearchField variant="page" initial={q} autoFocus={!q && !phone} />
        <div data-guide="search.filters" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {co.branches.length > 1 || co.canAll ? (
            <Select size="sm" value={branch?.id ?? ALL_COMPANIES} onValueChange={co.select} label={t("Company")} options={companyOptions} className="col-span-2 min-w-0 sm:w-56" />
          ) : null}
          <Select size="sm" value={search.kind ?? ANY} onValueChange={(v) => set({ kind: v === ANY ? undefined : v })} label={t("Kind")} options={kindOptions} className="min-w-0 sm:w-40" />
          <Select size="sm" value={search.dept ?? ANY} onValueChange={(v) => set({ dept: v === ANY ? undefined : v })} label={t("Department")} options={deptOptions}
            disabled={!branch} className="min-w-0 sm:w-44" />
          <Select size="sm" value={search.source ?? ANY} onValueChange={(v) => set({ source: v === ANY ? undefined : (v as Search["source"]) })} label={t("Made or uploaded")} options={sourceOptions} className="col-span-2 min-w-0 sm:col-span-1 sm:w-48" />
          {filtered ? (
            <Button size="sm" variant="ghost" className="col-span-2 sm:col-span-1" onClick={() => set({ kind: undefined, dept: undefined, source: undefined, type: undefined })}>
              {t("Clear filters")}
            </Button>
          ) : null}
        </div>
        {q ? (
          <Segmented size="sm" label={t("Show")} guide="search.types" value={search.type ?? "all"} options={typeOptions}
            onChange={(v) => set({ type: v === "all" ? undefined : (v as HitType) })} />
        ) : null}
      </div>

      {!q ? (
        <EmptyState icon={FileMagnifyingGlassIcon} title={t("Search inside every document")}
          body={t("A phrase from a handbook page, an amount like RM700, a form name or a job title. Put words in quotes for an exact phrase. You find what you are allowed to open, and nothing held back for review.")}
          action={<Recent onPick={(text) => set({ q: text })} />} />
      ) : res.isLoading ? (
        <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : res.error ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/6 px-4 py-3 text-[13.5px] text-danger">{errorMessage(res.error)}</p>
      ) : !hits.length ? (
        <EmptyState icon={MagnifyingGlassIcon} title={t("Nothing matches “{q}”", { q })}
          body={filtered || branch ? t("Try fewer words, another spelling, or clear the filters and company.") : t("Try fewer words or another spelling. Files still being read show up once they are read.")}
          action={filtered ? <Button variant="outline" onClick={() => set({ kind: undefined, dept: undefined, source: undefined, type: undefined })}>{t("Clear filters")}</Button> : undefined} />
      ) : (
        <div className="grid gap-5" data-guide="search.results">
          <p className="text-[13px] text-muted" aria-live="polite">
            {t("{n} results", { n: (first?.total ?? hits.length).toLocaleString() })}
            {branch ? <> · <BuildingsIcon size={13} className="inline align-[-2px]" /> {branch.name}</> : null}
            {corrected.length ? <> · {t("Also matching “{words}”", { words: corrected.join(", ") })}</> : null}
          </p>
          {(search.type ? [{ type: search.type, hits }] : byType).map((g) => (
            <section key={g.type} className="grid gap-2">
              {!search.type ? (
                <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                  {t(GROUP_TITLE[g.type])}
                  <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted tabular">{groups[g.type] ?? g.hits.length}</span>
                </h2>
              ) : null}
              <ListCard>
                {g.hits.map((h) => <HitRow key={`${h.type}:${h.id}:${h.page ?? ""}`} h={h} more={more.get(`${h.id}:${h.page ?? ""}`) ?? 0} />)}
              </ListCard>
            </section>
          ))}
          {res.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="outline" loading={res.isFetchingNextPage} onClick={() => void res.fetchNextPage()}>{t("Show more results")}</Button>
            </div>
          ) : null}
        </div>
      )}
      <p className={cn("text-[12px] text-muted", !q && "hidden")}>
        {t("Results open where you can read them: a file opens at its page in Company files.")}
      </p>
    </Page>
  );
}
