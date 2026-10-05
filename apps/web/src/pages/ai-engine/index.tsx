import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { Page, PageHeader } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { meQuery } from "@/lib/queries";

import { groupsQuery, providersQuery } from "./data";
import { GroupsTab } from "./groups";
import { PlaygroundTab } from "./playground";
import { ProvidersTab } from "./providers";
import { SettingsTab } from "./settings";

// Charts (Recharts) load only when the Usage tab is opened.
const UsageTab = lazy(() => import("./usage").then((m) => ({ default: m.UsageTab })));

export const AI_TABS = ["providers", "groups", "usage", "playground", "settings"] as const;
export type AITab = (typeof AI_TABS)[number];

const LABELS: Record<AITab, string> = {
  providers: msg("Providers"),
  groups: msg("Model groups"),
  usage: msg("Usage"),
  playground: msg("Playground"),
  settings: msg("Settings"),
};

export function AIEnginePage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("engine.manage");
  const search = useSearch({ strict: false }) as { tab?: AITab };
  const tab: AITab = search.tab && AI_TABS.includes(search.tab) ? search.tab : "providers";
  const navigate = useNavigate();
  const { data: providers } = useQuery(providersQuery);
  const { data: groups } = useQuery(groupsQuery);
  const counts: Partial<Record<AITab, number | undefined>> = { providers: providers?.length, groups: groups?.length };

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title={t("AI Engine")}
        description={t("Connect the AI providers your agents use, decide which models answer first, and see what every call costs.")}
      />
      <Segmented
        guide="ai-engine.tabs"
        label={t("AI Engine sections")}
        value={tab}
        onChange={(v) => navigate({ to: "/ai-engine", search: { tab: v }, replace: true })}
        options={AI_TABS.map((k) => ({ value: k, label: t(LABELS[k]), count: counts[k] }))}
        className="w-fit"
      />
      <div role="tabpanel" aria-label={t(LABELS[tab])} className="min-w-0 outline-none">
        {tab === "providers" ? <ProvidersTab canManage={canManage} /> : null}
        {tab === "groups" ? <GroupsTab canManage={canManage} /> : null}
        {tab === "usage" ? (
          <Suspense fallback={<Skeleton className="h-72 rounded-[var(--radius-md)]" />}>
            <UsageTab />
          </Suspense>
        ) : null}
        {tab === "playground" ? <PlaygroundTab canRun={me.permissions.includes("work.write")} /> : null}
        {tab === "settings" ? <SettingsTab canManage={canManage} /> : null}
      </div>
    </Page>
  );
}
