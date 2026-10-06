/** Home is one page with two tabs: today in the office (Command center, "/") and every
 * company side by side (Company overview, "/overview"). Each keeps its own address, so
 * links, the guide and the tutorial still open the right one. */
import { ChartBarIcon, GaugeIcon } from "@phosphor-icons/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useT } from "@/i18n";

import { PageTabs } from "./page-tabs";

export function HomeTabs() {
  const t = useT();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const value = pathname.startsWith("/overview") ? "companies" : "today";
  return (
    <PageTabs
      label={t("Home")}
      guide="home.tabs"
      value={value}
      onChange={(v) => void navigate({ to: v === "today" ? "/" : "/overview" })}
      tabs={[
        { value: "today", label: t("Today in the office"), icon: GaugeIcon },
        { value: "companies", label: t("All companies"), icon: ChartBarIcon },
      ]}
    />
  );
}
