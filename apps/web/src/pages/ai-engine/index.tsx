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
import { PrivacyTab } from "./privacy";
import { ProvidersTab } from "./providers";
import { SettingsTab } from "./settings";

// Charts (Recharts) load only when the Usage tab is opened.
const UsageTab = lazy(() => import("./usage").then((m) => ({ default: m.UsageTab })));
// P113: AI usage per user (P115: owners, admins and the developer; the API refuses everyone else).
const PeopleUsageTab = lazy(() => import("./people-usage").then((m) => ({ default: m.PeopleUsageTab })));

export const AI_TABS = ["providers", "groups", "privacy", "usage", "people", "playground", "settings"] as const;
export type AITab = (typeof AI_TABS)[number];

const LABELS: Record<AITab, string> = {
  providers: msg("Providers"),
  groups: msg("Model groups"),
  privacy: msg("Privacy"),
  usage: msg("Usage"),
  people: msg("AI usage per user"),
  playground: msg("Playground"),
  settings: msg("Settings"),
};

export function AIEnginePage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("engine.manage");
  const search = useSearch({ strict: false }) as { tab?: AITab };
  // P115 (Fitri, 18 Nov 2026): owners, admins and the system's developer have AI usage per user.
  const usageReader = me.role === "owner" || me.role === "admin" || me.role === "it_support"; // the developer is always an owner
  const tabs = AI_TABS.filter((k) => k !== "people" || usageReader);
  const tab: AITab = search.tab && tabs.includes(search.tab) ? search.tab : "providers";
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
        options={tabs.map((k) => ({ value: k, label: t(LABELS[k]), count: counts[k] }))}
        className="w-fit"
      />
      <div role="tabpanel" aria-label={t(LABELS[tab])} className="min-w-0 outline-none">
        {tab === "providers" ? <ProvidersTab canManage={canManage} /> : null}
        {tab === "groups" ? <GroupsTab canManage={canManage} /> : null}
        {tab === "privacy" ? <PrivacyTab canManage={canManage} canSetLevels={me.permissions.includes("org.manage")} /> : null}
        {tab === "usage" ? (
          <Suspense fallback={<Skeleton className="h-72 rounded-[var(--radius-md)]" />}>
            <UsageTab />
          </Suspense>
        ) : null}
        {tab === "people" ? (
          <Suspense fallback={<Skeleton className="h-72 rounded-[var(--radius-md)]" />}>
            <PeopleUsageTab />
          </Suspense>
        ) : null}
        {tab === "playground" ? <PlaygroundTab canRun={me.permissions.includes("work.write")} /> : null}
        {tab === "settings" ? <SettingsTab canManage={canManage} /> : null}
      </div>
    </Page>
  );
}
