import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs } from "radix-ui";
import { lazy, Suspense } from "react";

import { Page, PageHeader } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { meQuery } from "@/lib/queries";

import { GroupsTab } from "./groups";
import { PlaygroundTab } from "./playground";
import { ProvidersTab } from "./providers";

// Charts (Recharts) load only when the Usage tab is opened.
const UsageTab = lazy(() => import("./usage").then((m) => ({ default: m.UsageTab })));

export const AI_TABS = ["providers", "groups", "usage", "playground"] as const;
export type AITab = (typeof AI_TABS)[number];

const LABELS: Record<AITab, string> = {
  providers: "Providers",
  groups: "Model groups",
  usage: "Usage",
  playground: "Playground",
};

export function AIEnginePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("engine.manage");
  const search = useSearch({ strict: false }) as { tab?: AITab };
  const tab: AITab = search.tab && AI_TABS.includes(search.tab) ? search.tab : "providers";
  const navigate = useNavigate();

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="AI Engine"
        description="Connect the AI providers your agents use, decide which models answer first, and see what every call costs."
      />
      <Tabs.Root value={tab} onValueChange={(v) => navigate({ to: "/ai-engine", search: { tab: v as AITab }, replace: true })}>
        <Tabs.List aria-label="AI Engine sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {AI_TABS.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2.5 text-[13.5px] whitespace-nowrap text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg"
            >
              {LABELS[t]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="providers" className="outline-none">
          <ProvidersTab canManage={canManage} />
        </Tabs.Content>
        <Tabs.Content value="groups" className="outline-none">
          <GroupsTab canManage={canManage} />
        </Tabs.Content>
        <Tabs.Content value="usage" className="outline-none">
          <Suspense fallback={<Skeleton className="h-72 rounded-[var(--radius-md)]" />}>
            <UsageTab />
          </Suspense>
        </Tabs.Content>
        <Tabs.Content value="playground" className="outline-none">
          <PlaygroundTab canRun={me.permissions.includes("work.write")} />
        </Tabs.Content>
      </Tabs.Root>
    </Page>
  );
}
