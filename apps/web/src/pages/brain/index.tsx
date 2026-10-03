import { ArrowsClockwiseIcon, DownloadSimpleIcon, FileTextIcon, GraphIcon, LightbulbIcon, MoonStarsIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { brainKeys, overviewQuery } from "@/lib/brain";
import { meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";

import { DreamsTab } from "./dreams-tab";
import { FactsTab } from "./facts-tab";
import { GraphTab } from "./graph-tab";
import { PagesTab } from "./pages-tab";
import { SearchTab } from "./search-tab";

export const BRAIN_TABS = ["pages", "facts", "search", "graph", "dreams"] as const;
export type BrainTab = (typeof BRAIN_TABS)[number];
const LABELS: Record<BrainTab, string> = { pages: "Pages", facts: "Facts", search: "Search", graph: "Graph", dreams: "Dreams" };

export interface BrainSearch {
  tab?: BrainTab;
  path?: string;
  dream?: string;
  q?: string;
}

export function BrainPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canManage = me.permissions.includes("brain.manage");
  const search = useSearch({ strict: false }) as BrainSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: ov } = useQuery(overviewQuery);
  const tab: BrainTab = search.tab && BRAIN_TABS.includes(search.tab) ? search.tab : "pages";
  const go = (next: BrainSearch) => navigate({ to: "/brain", search: next, replace: next.tab === tab });

  const dream = useMutation({
    mutationFn: () => api<{ workflow_id: string }>("/api/brain/dreams/run", "POST"),
    onSuccess: () => {
      toast.success("Dreaming now. The diary appears under Dreams when it finishes.");
      go({ tab: "dreams" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sync = useMutation({
    mutationFn: () => api<{ imported: string[]; deleted: string[]; conflicts: string[] }>("/api/brain/sync", "POST"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: brainKeys.all });
      const n = r.imported.length + r.deleted.length;
      toast.success(n || r.conflicts.length
        ? `Vault synced: ${r.imported.length} imported, ${r.deleted.length} removed${r.conflicts.length ? `, ${r.conflicts.length} edited in both places (both copies kept)` : ""}.`
        : "Vault synced. Nothing changed outside the dashboard.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const counts: Partial<Record<BrainTab, number>> = ov ? { pages: ov.pages, facts: ov.facts } : {};

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Brain"
        description="What the office knows: facts agents learned, wiki pages, and a nightly dream that keeps it tidy. Stored as markdown in a git vault that also opens in Obsidian."
        actions={canManage ? (
          <>
            <Button variant="outline" size="sm" className="max-sm:h-9" loading={sync.isPending} onClick={() => sync.mutate()}><ArrowsClockwiseIcon size={15} /> Sync vault</Button>
            <Button variant="outline" size="sm" className="max-sm:h-9" asChild><a href="/api/brain/vault.zip" download><DownloadSimpleIcon size={15} /> Download</a></Button>
            <Button size="sm" className="max-sm:h-9" loading={dream.isPending} onClick={() => dream.mutate()}><MoonStarsIcon size={15} /> Dream now</Button>
          </>
        ) : null}
      />

      {ov ? (
        <StatGrid>
          <Stat label="Pages" value={ov.pages} icon={FileTextIcon} tone="accent" hint="Wiki pages in the vault" onClick={() => go({ tab: "pages" })} active={tab === "pages"} />
          <Stat label="Facts" value={ov.facts} icon={LightbulbIcon} tone="warn" hint="Agents recall these" onClick={() => go({ tab: "facts" })} active={tab === "facts"} />
          <Stat label="Links" value={ov.links} icon={GraphIcon} tone="info" hint="Between pages" onClick={() => go({ tab: "graph" })} active={tab === "graph"} />
          <Stat label="Last dream" icon={MoonStarsIcon} tone="violet"
            value={<span className="text-[19px] leading-tight">{ov.last_dream ? timeAgo(ov.last_dream.started_at) : "Never"}</span>}
            hint={`Nightly at ${String(ov.dream_hour).padStart(2, "0")}:00`} onClick={() => go({ tab: "dreams" })} active={tab === "dreams"} />
        </StatGrid>
      ) : null}

      {ov && !ov.search.vectors ? (
        <p role="status" className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
          <WarningIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span className="min-w-0">The embedding model is not loaded, so search matches words and links but not meaning. Check the api logs.</span>
        </p>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
        <Segmented<BrainTab>
          label="Brain sections"
          value={tab}
          onChange={(v) => go({ tab: v })}
          options={BRAIN_TABS.map((t) => ({ value: t, label: LABELS[t], count: counts[t] }))}
          className="w-fit"
        />
        <div role="tabpanel" aria-label={LABELS[tab]} className="min-w-0">
          {tab === "pages" ? (
            <PagesTab selected={search.path ?? null} canWrite={canWrite} onSelect={(path) => go({ tab: "pages", path: path ?? undefined })} />
          ) : tab === "facts" ? (
            <FactsTab canWrite={canWrite} />
          ) : tab === "search" ? (
            <SearchTab initial={search.q} onOpenPage={(path) => go({ tab: "pages", path })} />
          ) : tab === "graph" ? (
            <GraphTab onOpenPage={(path) => go({ tab: "pages", path })} />
          ) : (
            <DreamsTab selected={search.dream ?? null} onSelect={(id) => go({ tab: "dreams", dream: id })} canManage={canManage}
              hour={ov?.dream_hour ?? 2} timezone={ov?.timezone ?? ""} />
          )}
        </div>
      </div>
    </Page>
  );
}
