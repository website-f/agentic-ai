/** The Browse tab's ready-made folders that are not files: documents, SOPs and templates. Each
 * lists what is there for the company in view, with search, sort and list or grid; opening one
 * goes to its own tab (the editor, the SOP, a new document from the template). */
import { ArrowRightIcon, FileTextIcon, FilesIcon, StackIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys, STATUS_LABEL, templatesQuery, type DocTemplate } from "@/lib/documents";
import { useDebounced, usePagedList } from "@/lib/paged";
import type { ReviewedDoc } from "@/lib/provenance";
import type { Branch } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { sopsQuery } from "@/lib/work";

import { DocRow } from "../documents/documents";
import { NewDocumentDialog } from "../documents/new-document";
import { KindTile } from "../documents/visuals";
import { BrowseControls, sortRows, Tile, TileGrid, useBrowsePrefs } from "./browse-bits";
import { sopScopeLabel, sopsForCompany, templatesForCompany } from "./views";

function Bar({ q, setQ, placeholder, prefs, open }: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  prefs: ReturnType<typeof useBrowsePrefs>;
  open: ReactNode;
}) {
  return (
    <Toolbar>
      <SearchInput value={q} onChange={setQ} placeholder={placeholder} className="sm:max-w-80" />
      <BrowseControls prefs={prefs} />
      <div className="flex sm:ml-auto">{open}</div>
    </Toolbar>
  );
}

function Loading() {
  return <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
}

// ---------------------------------------------------------------- documents

export function DocumentsFolder({ branch }: { branch: Branch | null }) {
  const t = useT();
  const navigate = useNavigate();
  const prefs = useBrowsePrefs();
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const list = usePagedList<ReviewedDoc>(docKeys.documents, "/api/documents", { branch_id: branch?.id, q: needle || undefined }, { pageSize: 50 });
  const docs = useMemo(() => sortRows(list.items, prefs.sort, (d) => d.title, (d) => d.updated_at), [list.items, prefs.sort]);
  const open = (id: string) => void navigate({ to: "/documents", search: { d: id } });
  return (
    <div className="grid min-w-0 content-start gap-3">
      <Bar q={q} setQ={setQ} placeholder={t("Search documents")} prefs={prefs}
        open={<Button size="sm" variant="ghost" asChild><Link to="/documents">{t("Open the Documents tab")} <ArrowRightIcon size={13} /></Link></Button>} />
      {list.isLoading ? <Loading />
        : list.error ? <p role="alert" className="text-danger">{errorMessage(list.error)}</p>
        : !docs.length ? (
          <EmptyState icon={FilesIcon} title={needle ? t("Nothing matches") : t("No documents yet")}
            body={t("Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one.")}
            action={<Button size="sm" asChild><Link to="/documents" search={{ new: 1 }}>{t("New document")}</Link></Button>} />
        ) : prefs.layout === "grid" ? (
          <TileGrid>
            {docs.map((d) => {
              const s = STATUS_LABEL[d.status];
              return (
                <Tile key={d.id} onClick={() => open(d.id)} leading={<KindTile kind={d.kind} size="lg" />} title={d.title}
                  meta={[d.number, d.branch_name, timeAgo(d.updated_at)].filter(Boolean).join(" · ")}
                  badge={<Pill tone={s.tone}>{t(s.label)}</Pill>} />
              );
            })}
          </TileGrid>
        ) : (
          <ListCard>{docs.map((d) => <DocRow key={d.id} d={d} onOpen={() => open(d.id)} />)}</ListCard>
        )}
      {docs.length ? <LoadMore noun="documents" shown={docs.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- SOPs

export function SopsFolder({ branch }: { branch: Branch | null }) {
  const t = useT();
  const navigate = useNavigate();
  const prefs = useBrowsePrefs();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery(sopsQuery);
  const needle = q.trim().toLowerCase();
  const sops = useMemo(() => sortRows(
    sopsForCompany(data ?? [], branch).filter((s) => !needle || `${s.title} ${sopScopeLabel(s)}`.toLowerCase().includes(needle)),
    prefs.sort, (s) => s.title, (s) => s.updated_at,
  ), [data, branch, needle, prefs.sort]);
  const open = (id: string) => void navigate({ to: "/sops", search: { sop: id } });
  return (
    <div className="grid min-w-0 content-start gap-3">
      <Bar q={q} setQ={setQ} placeholder={t("Search SOPs")} prefs={prefs}
        open={<Button size="sm" variant="ghost" asChild><Link to="/sops">{t("Open the SOPs tab")} <ArrowRightIcon size={13} /></Link></Button>} />
      {isLoading ? <Loading />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !sops.length ? (
          <EmptyState icon={FileTextIcon} title={needle ? t("No SOP matches") : t("No SOPs yet")}
            body={t("Write down how your company does things once (month-end close, quotation checks, report formats) and every agent in scope follows it.")} />
        ) : prefs.layout === "grid" ? (
          <TileGrid>
            {sops.map((s) => (
              <Tile key={s.id} onClick={() => open(s.id)} leading={<IconTile icon={FileTextIcon} tone="violet" size="lg" />} title={s.title}
                meta={[sopScopeLabel(s), `v${s.version}`].join(" · ")}
                badge={s.status === "draft" ? <Pill tone="warn">{t("Draft")}</Pill> : undefined} />
            ))}
          </TileGrid>
        ) : (
          <ListCard>
            {sops.map((s) => (
              <ListRow key={s.id} onClick={() => open(s.id)} leading={<IconTile icon={FileTextIcon} tone="violet" size="sm" />}
                title={<span className="block whitespace-normal break-words">{s.title}</span>}
                trailing={s.status === "draft" ? <Pill tone="warn">{t("Draft")}</Pill> : undefined}
                meta={<Meta items={[sopScopeLabel(s), <span key="v" className="tabular">v{s.version}</span>, t("updated {when}", { when: timeAgo(s.updated_at).toLowerCase() })]} />} />
            ))}
          </ListCard>
        )}
    </div>
  );
}

// ---------------------------------------------------------------- templates

export function TemplatesFolder({ branch }: { branch: Branch | null }) {
  const t = useT();
  const navigate = useNavigate();
  const prefs = useBrowsePrefs();
  const [q, setQ] = useState("");
  const [using, setUsing] = useState<DocTemplate | null>(null);
  const { data, isLoading, error } = useQuery(templatesQuery);
  const needle = q.trim().toLowerCase();
  // Templates have no date of their own: "newest" keeps the server's order (starters first).
  const rows = useMemo(() => {
    const mine = templatesForCompany(data ?? [], branch).filter((x) => !needle || `${x.name} ${x.kind} ${x.description}`.toLowerCase().includes(needle));
    if (prefs.sort === "name") return sortRows(mine, "name", (x) => x.name, () => null);
    return prefs.sort === "oldest" ? [...mine].reverse() : mine;
  }, [data, branch, needle, prefs.sort]);
  return (
    <div className="grid min-w-0 content-start gap-3">
      <Bar q={q} setQ={setQ} placeholder={t("Search templates")} prefs={prefs}
        open={<Button size="sm" variant="ghost" asChild><Link to="/templates">{t("Open the Templates tab")} <ArrowRightIcon size={13} /></Link></Button>} />
      {isLoading ? <Loading />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !rows.length ? (
          <EmptyState icon={StackIcon} title={needle ? t("Nothing matches") : t("No templates")} body={t("Create one, or upload a Word file with {{placeholders}}.")} />
        ) : prefs.layout === "grid" ? (
          <TileGrid>
            {rows.map((x) => (
              <Tile key={x.id} onClick={() => setUsing(x)} leading={<KindTile kind={x.kind} size="lg" />} title={x.name}
                meta={x.description || x.kind}
                badge={<>{x.builtin ? <Pill>{t("Starter")}</Pill> : null}{x.docx_file_id ? <Pill tone="info">Word</Pill> : null}</>} />
            ))}
          </TileGrid>
        ) : (
          <ListCard>
            {rows.map((x) => (
              <ListRow key={x.id} onClick={() => setUsing(x)} leading={<KindTile kind={x.kind} />}
                title={<span className="block whitespace-normal break-words">{x.name}</span>}
                meta={<Meta items={[x.kind, x.description, x.used ? t("used {n} times", { n: x.used }) : null]} />}
                trailing={<>{x.builtin ? <Pill>{t("Starter")}</Pill> : null}{x.docx_file_id ? <Pill tone="info">Word</Pill> : null}<Pill tone="accent">{t("Use")}</Pill></>} />
            ))}
          </ListCard>
        )}
      {using ? <NewDocumentDialog template={using} branchId={branch?.id ?? null} onClose={() => setUsing(null)}
        onCreated={(id) => void navigate({ to: "/documents", search: { d: id } })} /> : null}
    </div>
  );
}
