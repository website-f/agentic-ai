import { ArrowsClockwiseIcon, DownloadSimpleIcon, MoonStarsIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { toast } from "sonner";

import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
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

  const summary = ov
    ? `${ov.pages} pages, ${ov.facts} facts, ${ov.links} links${ov.last_dream ? `. Last dream ${timeAgo(ov.last_dream.started_at).toLowerCase()}` : ""}.`
    : null;

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Brain"
        description={<>What the office knows: facts agents learned, wiki pages, and a nightly dream that keeps it tidy. Stored as markdown in a git vault that also opens in Obsidian. {summary}</>}
        actions={canManage ? (
          <>
            <Button variant="outline" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}><ArrowsClockwiseIcon size={15} /> Sync vault</Button>
            <Button variant="outline" size="sm" asChild><a href="/api/brain/vault.zip" download><DownloadSimpleIcon size={15} /> Download vault</a></Button>
            <Button size="sm" loading={dream.isPending} onClick={() => dream.mutate()}><MoonStarsIcon size={15} /> Dream now</Button>
          </>
        ) : null}
      />
      {ov && !ov.search.vectors ? (
        <p role="status" className="mb-4 rounded-sm border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          The embedding model is not loaded, so search matches words and links but not meaning. Check the api logs.
        </p>
      ) : null}
      <Tabs.Root value={tab} onValueChange={(v) => go({ tab: v as BrainTab })}>
        <Tabs.List aria-label="Brain sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {BRAIN_TABS.map((t) => (
            <Tabs.Trigger key={t} value={t} className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg">
              {LABELS[t]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="pages" className="outline-none">
          <PagesTab selected={search.path ?? null} canWrite={canWrite} onSelect={(path) => go({ tab: "pages", path: path ?? undefined })} />
        </Tabs.Content>
        <Tabs.Content value="facts" className="outline-none"><FactsTab canWrite={canWrite} /></Tabs.Content>
        <Tabs.Content value="search" className="outline-none">
          <SearchTab initial={search.q} onOpenPage={(path) => go({ tab: "pages", path })} />
        </Tabs.Content>
        <Tabs.Content value="graph" className="outline-none"><GraphTab onOpenPage={(path) => go({ tab: "pages", path })} /></Tabs.Content>
        <Tabs.Content value="dreams" className="outline-none">
          <DreamsTab selected={search.dream ?? null} onSelect={(id) => go({ tab: "dreams", dream: id })} canManage={canManage}
            hour={ov?.dream_hour ?? 2} timezone={ov?.timezone ?? ""} />
        </Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
